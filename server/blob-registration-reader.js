import { get } from "@vercel/blob";

// Solo para inscripciones inmutables; nunca para sesiones, límites o bajas.
export function blobRegistrationReader({
  sdk = { get },
  options = () => ({}),
  now = Date.now,
  ttlMs = 300_000,
  maxEntries = 500,
} = {}) {
  const entries = new Map();

  return async function read(pathname) {
    let entry = entries.get(pathname);
    if (!entry || entry.expiresAt <= now()) {
      entries.delete(pathname);
      const promise = (async () => {
        const response = await sdk.get(pathname, {
          ...options(),
          access: "private",
          useCache: true,
          abortSignal: AbortSignal.timeout(5000),
        });
        if (!response || response.statusCode !== 200)
          throw new Error("REGISTRATION_BLOB_UNAVAILABLE");
        return new Response(response.stream).json();
      })();
      entry = { promise, expiresAt: now() + ttlMs };
      entries.set(pathname, entry);
      while (entries.size > maxEntries)
        entries.delete(entries.keys().next().value);
    }

    try {
      // No compartir objetos mutables entre peticiones administrativas.
      return structuredClone(await entry.promise);
    } catch (error) {
      if (entries.get(pathname) === entry) entries.delete(pathname);
      throw error;
    }
  };
}
