import { test } from "node:test";
import assert from "node:assert/strict";
import { blobRegistrationReader } from "./blob-registration-reader.js";
import { createApp } from "./app.js";

function fixture(options = {}) {
  const calls = [];
  const read = blobRegistrationReader({
    options: () => ({ token: "test-only-token" }),
    sdk: {
      async get(pathname, options) {
        calls.push(pathname);
        assert.equal(options.access, "private");
        assert.equal(options.useCache, true);
        assert.equal(options.token, "test-only-token");
        assert.ok(options.abortSignal instanceof AbortSignal);
        return {
          statusCode: 200,
          stream: new Response(JSON.stringify({ id: pathname })).body,
        };
      },
    },
    ...options,
  });
  return { read, calls };
}

test("repeated and concurrent reads reuse immutable registrations without sharing mutable data", async () => {
  const { read, calls } = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => read("one")));
  results[0].id = "changed";
  assert.equal(results[1].id, "one");
  assert.deepEqual(await read("one"), { id: "one" });
  assert.equal(calls.length, 1);
});

test("each fresh selection includes new entries and omits deleted entries without downloading known content again", async () => {
  const { read, calls } = fixture();
  const list = (paths) => Promise.all(paths.map(read));
  assert.deepEqual(await list(["one", "two"]), [{ id: "one" }, { id: "two" }]);
  assert.deepEqual(await list(["two", "three"]), [{ id: "two" }, { id: "three" }]);
  assert.deepEqual(calls, ["one", "two", "three"]);
});

test("cache entries expire and each instance has a bounded independent cache", async () => {
  let clock = 0;
  const { read, calls } = fixture({ now: () => clock, ttlMs: 100, maxEntries: 2 });
  await read("one");
  await read("one");
  clock = 100;
  await read("one");
  assert.deepEqual(calls, ["one", "one"]);
  await read("two");
  await read("three");
  await read("one");
  assert.deepEqual(calls, ["one", "one", "two", "three", "one"]);
  const other = fixture();
  await other.read("one");
  assert.equal(other.calls.length, 1);
});

test("missing, unavailable and malformed blobs are never cached as successes", async () => {
  for (const response of [
    null,
    { statusCode: 503 },
    { statusCode: 200, text: "invalid" },
  ]) {
    let calls = 0;
    const read = blobRegistrationReader({
      sdk: {
        async get() {
          calls++;
          return response && {
            ...response,
            stream: new Response(response.text || "{}").body,
          };
        },
      },
    });
    await assert.rejects(read("one"));
    await assert.rejects(read("one"));
    assert.equal(calls, 2);
  }
});

test("a rejected download can be retried successfully", async () => {
  let calls = 0;
  const read = blobRegistrationReader({
    sdk: {
      async get() {
        if (++calls === 1) throw new Error("UNAVAILABLE");
        return { statusCode: 200, stream: new Response('{"id":"one"}').body };
      },
    },
  });
  await assert.rejects(read("one"), /UNAVAILABLE/);
  assert.deepEqual(await read("one"), { id: "one" });
  assert.equal(calls, 2);
});

test("HTTP list, export and soft delete reuse content only after authentication", async (t) => {
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  let active = [first];
  const { read, calls } = fixture();
  const app = createApp({
    production: false,
    adminPassword: "test-only-password",
    storage: {
      list: () => Promise.all(active.map(read)),
      softDelete: async (id) => {
        active = active.filter((item) => item !== id);
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = `${base}/api/admin/inscripcions`;
  assert.equal((await fetch(path)).status, 401);
  assert.equal(calls.length, 0);
  const login = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-only-password" }),
  });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
  const initial = await (await fetch(path, { headers })).json();
  assert.equal(initial.registrations.length, 1);
  const csv = await fetch(`${path}.csv`, { headers });
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes(first));
  assert.equal(calls.length, 1);
  active.push(second);
  const expanded = await (await fetch(path, { headers })).json();
  assert.equal(expanded.registrations.length, 2);
  assert.equal(calls.length, 2);
  const deleted = await fetch(`${path}/${first}`, {
    method: "DELETE",
    headers: { ...headers, Origin: base, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(deleted.status, 200);
  const remaining = await (await fetch(path, { headers })).json();
  assert.deepEqual(remaining.registrations, [{ id: second }]);
  const updatedCsv = await (await fetch(`${path}.csv`, { headers })).text();
  assert.ok(!updatedCsv.includes(first));
  assert.equal(calls.length, 2);
});
