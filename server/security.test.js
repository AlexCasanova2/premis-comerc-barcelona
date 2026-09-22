import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { memorySecurityStore } from "./security.js";

const password = "test-only-long-password:with-colon";
const valid = {
  nom: "Prova",
  cognom: "Seguretat",
  email: "test@example.com",
  telefon: "600000000",
  entitat: '=HYPERLINK("bad")',
  adreca: "Carrer 1",
  acompanyant: "No",
  assistencia: "Sí",
  mobilitat: "No",
  consentiment: true,
};

async function setup(t, options = {}) {
  const entries = [];
  const app = createApp({
    adminUsername: "admin",
    adminPassword: password,
    storage: {
      list: async () => entries,
      save: async (entry) => entries.push(entry),
    },
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const login = (headers) =>
    post("/api/admin/login", { username: "admin", password }, headers);
  return { base, post, login, entries };
}

test("opaque HttpOnly sessions, rotation, logout revocation and no Basic bypass", async (t) => {
  const { base, login, post } = await setup(t);
  assert.equal((await fetch(`${base}/api/admin/inscripcions.csv`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/admin/inscripcions`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`,
        },
      })
    ).status,
    401,
  );
  const response = await login();
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=3600/);
  const cookie = setCookie.split(";")[0];
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["expiresAt", "ok"]);
  assert.equal(
    (
      await fetch(`${base}/api/admin/inscripcions`, {
        headers: { Cookie: cookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/admin/session`, {
        headers: { Cookie: cookie + "tampered" },
      })
    ).status,
    401,
  );
  const rotated = await login({ Cookie: cookie });
  const newCookie = rotated.headers.get("set-cookie").split(";")[0];
  assert.notEqual(cookie, newCookie);
  assert.equal(
    (await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } }))
      .status,
    401,
  );
  assert.equal(
    (await post("/api/admin/logout", {}, { Cookie: newCookie })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/admin/inscripcions.csv`, {
        headers: { Cookie: newCookie },
      })
    ).status,
    401,
  );
});

test("cross-origin and missing-origin writes are rejected, including logout", async (t) => {
  const { post, entries, base } = await setup(t);
  for (const path of [
    "/api/inscripcions",
    "/api/admin/login",
    "/api/admin/logout",
  ]) {
    assert.equal(
      (await post(path, valid, { Origin: "https://attacker.example" })).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await post("/api/inscripcions", valid, { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.equal(entries.length, 0);
});

test("login limits are shared across instances and fail closed on storage failure", async (t) => {
  const store = memorySecurityStore();
  const first = await setup(t, { securityStore: store });
  const second = await setup(t, { securityStore: store });
  for (let i = 0; i < 8; i++) {
    assert.equal(
      (
        await first.post("/api/admin/login", {
          username: "admin",
          password: "wrong",
        })
      ).status,
      401,
    );
  }
  const blocked = await second.login();
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  const unavailable = await setup(t, {
    securityStore: {
      async increment() {
        throw new Error("STORE_UNAVAILABLE");
      },
    },
  });
  assert.equal((await unavailable.login()).status, 503);
  assert.equal(
    (await unavailable.post("/api/inscripcions", valid)).status,
    503,
  );
  assert.equal(unavailable.entries.length, 0);
});

test("honeypot, oversized payloads, control characters, email/IP limits and safe CSV", async (t) => {
  const { post, base, entries, login } = await setup(t);
  assert.equal(
    (await post("/api/inscripcions", { ...valid, website: "spam" })).status,
    400,
  );
  assert.equal(
    (await post("/api/inscripcions", { ...valid, nom: "bad\u0000name" }))
      .status,
    400,
  );
  assert.equal(
    (await post("/api/inscripcions", { ...valid, nom: "x".repeat(20000) }))
      .status,
    413,
  );
  assert.equal((await post("/api/inscripcions", valid)).status, 201);
  assert.equal(entries.length, 1);
  for (let i = 0; i < 2; i++)
    assert.equal((await post("/api/inscripcions", valid)).status, 201);
  assert.equal((await post("/api/inscripcions", valid)).status, 429);
  const session = await login();
  const response = await fetch(`${base}/api/admin/inscripcions.csv`, {
    headers: { Cookie: session.headers.get("set-cookie").split(";")[0] },
  });
  const csv = await response.text();
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const other = await setup(t);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await other.post("/api/inscripcions", {
          ...valid,
          email: `p${i}@example.com`,
        })
      ).status,
      201,
    );
  assert.equal(
    (
      await other.post("/api/inscripcions", {
        ...valid,
        email: "different@example.com",
      })
    ).status,
    429,
  );
});

test("production cookie policy, strong password requirement and credential rotation", async (t) => {
  const securityStore = memorySecurityStore();
  const first = await setup(t, { production: true, securityStore });
  const origin = "https://www.inscripcionspremicomercbarcelona.cat";
  const response = await first.login({ Origin: origin });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("set-cookie"),
    /^__Host-premi-session=.*;.*Secure/,
  );
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const rotated = await setup(t, {
    production: true,
    securityStore,
    adminPassword: "a-different-long-password",
  });
  assert.equal(
    (
      await fetch(`${rotated.base}/api/admin/session`, {
        headers: { Cookie: cookie },
      })
    ).status,
    401,
  );
  const weak = await setup(t, {
    production: true,
    securityStore: memorySecurityStore(),
    adminPassword: "short",
  });
  assert.equal((await weak.login({ Origin: origin })).status, 503);
});

test("expired server-side sessions cannot access administrative data", async (t) => {
  const memory = memorySecurityStore();
  let expired = false;
  const { base, login } = await setup(t, {
    securityStore: {
      ...memory,
      async get(key) {
        const value = await memory.get(key);
        return expired && value
          ? JSON.stringify({ ...JSON.parse(value), expiresAt: 0 })
          : value;
      },
    },
  });
  const response = await login();
  expired = true;
  assert.equal(
    (
      await fetch(`${base}/api/admin/inscripcions`, {
        headers: { Cookie: response.headers.get("set-cookie").split(";")[0] },
      })
    ).status,
    401,
  );
});
