import * as blob from "@vercel/blob";
import { createHash, randomUUID } from "node:crypto";

// Shared state in the existing private store, isolated from registrations.
// Conditional writes prevent lost increments when functions run concurrently.
export function blobSecurityStore({
  sdk = blob,
  options = () => ({}),
  now = Date.now,
} = {}) {
  const path = (key) =>
    `security/v1/${createHash("sha256").update(key).digest("hex")}.json`;
  async function read(pathname) {
    try {
      const response = await sdk.get(pathname, {
        ...options(),
        access: "private",
        useCache: false,
        abortSignal: AbortSignal.timeout(5000),
      });
      if (!response) return null;
      if (response.statusCode !== 200 || !response.blob.etag)
        throw new Error("SECURITY_STATE_INVALID");
      const record = await new Response(response.stream).json();
      if (!Number.isFinite(record.expiresAt))
        throw new Error("SECURITY_STATE_INVALID");
      return { ...record, etag: response.blob.etag };
    } catch (error) {
      if (error instanceof blob.BlobNotFoundError) return null;
      throw error;
    }
  }
  function write(pathname, record, existing) {
    return sdk.put(
      pathname,
      JSON.stringify({ ...record, revision: randomUUID() }),
      {
        ...options(),
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        allowOverwrite: Boolean(existing),
        ...(existing ? { ifMatch: existing.etag } : {}),
        abortSignal: AbortSignal.timeout(5000),
      },
    );
  }
  return {
    async get(key) {
      const record = await read(path(key));
      return record && record.expiresAt > now() ? record.value : null;
    },
    async set(key, value, ttl) {
      // Sessions have cryptographically random keys: never overwrite collisions.
      await write(path(key), { value, expiresAt: now() + ttl * 1000 }, null);
    },
    async del(key) {
      await sdk.del(path(key), {
        ...options(),
        abortSignal: AbortSignal.timeout(5000),
      });
    },
    async increment(key, ttl) {
      const pathname = path(key);
      for (let attempt = 0; attempt < 6; attempt++) {
        const existing = await read(pathname);
        const active = existing && existing.expiresAt > now();
        if (active && !Number.isSafeInteger(existing.value))
          throw new Error("SECURITY_STATE_INVALID");
        const value = active ? existing.value + 1 : 1;
        try {
          await write(
            pathname,
            {
              value,
              expiresAt: active ? existing.expiresAt : now() + ttl * 1000,
            },
            existing,
          );
          return value;
        } catch (error) {
          // A competing creation/update must be reread before retrying.
          // Any exhausted retry fails closed; never return an uncommitted count.
          if (attempt === 5) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 20 + Math.random() * 50),
          );
        }
      }
    },
  };
}
