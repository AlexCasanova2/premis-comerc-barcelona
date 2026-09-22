import { test } from "node:test";
import assert from "node:assert/strict";
import { blobSecurityStore } from "./blob-security.js";

function fakeBlob() {
  const records = new Map();
  let revision = 0;
  return {
    records,
    async get(path, options) {
      assert.equal(options.access, "private");
      assert.equal(options.useCache, false);
      const entry = records.get(path);
      if (!entry) return null;
      return {
        statusCode: 200,
        blob: { etag: entry.etag },
        stream: new Response(entry.text).body,
      };
    },
    async put(path, text, options) {
      assert.equal(options.access, "private");
      const current = records.get(path);
      if (
        options.allowOverwrite
          ? !current || current.etag !== options.ifMatch
          : current
      )
        throw new Error("CAS_CONFLICT");
      records.set(path, { text, etag: String(++revision) });
    },
    async del(path) {
      records.delete(path);
    },
  };
}

test("Blob counters do not lose concurrent increments from different instances", async () => {
  const sdk = fakeBlob();
  const first = blobSecurityStore({ sdk });
  const second = blobSecurityStore({ sdk });
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      (i % 2 ? first : second).increment("ip:private", 900),
    ),
  );
  assert.deepEqual(
    results.sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
  assert.equal(await first.increment("ip:private", 900), 6);
  assert.equal(sdk.records.size, 1);
  assert.ok(
    [...sdk.records.keys()].every((key) => !key.includes("ip:private")),
  );
});

test("Blob sessions expire, revoke across instances and counters reset after TTL", async () => {
  let clock = 10000;
  const sdk = fakeBlob();
  const first = blobSecurityStore({ sdk, now: () => clock });
  const second = blobSecurityStore({ sdk, now: () => clock });
  await first.set("session:random", "session-value", 60);
  assert.equal(await second.get("session:random"), "session-value");
  await second.del("session:random");
  assert.equal(await first.get("session:random"), null);
  await first.set("session:expires", "another-session", 60);
  assert.equal(await first.increment("counter", 60), 1);
  assert.equal(await first.increment("counter", 60), 2);
  clock += 61000;
  assert.equal(await second.get("session:expires"), null);
  assert.equal(await second.increment("counter", 60), 1);
});

test("persistent write failures never grant an uncommitted request", async () => {
  const store = blobSecurityStore({
    sdk: {
      async get() {
        return null;
      },
      async put() {
        throw new Error("DENIED");
      },
    },
  });
  await assert.rejects(store.increment("counter", 60), /DENIED/);
  await assert.rejects(store.set("session", "value", 60), /DENIED/);
});
