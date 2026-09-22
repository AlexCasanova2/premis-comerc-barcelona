import { get, list, put } from "@vercel/blob";
import { createApp } from "../server/app.js";
import { blobSecurityStore } from "../server/blob-security.js";

const prefix = "inscripcions/";

function blobOptions() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return { token: process.env.BLOB_READ_WRITE_TOKEN };
  }
  if (process.env.BLOB_STORE_ID) {
    return { storeId: process.env.BLOB_STORE_ID };
  }
  const error = new Error("Vercel Blob is not connected to this deployment.");
  error.publicMessage =
    "El Blob no està disponible en aquest deployment. Comprova la connexió amb el projecte i crea un deployment nou.";
  throw error;
}

function blobError(error) {
  if (error.publicMessage) return error;
  const wrapped = new Error("Vercel Blob operation failed.", { cause: error });
  wrapped.publicMessage = `No s’ha pogut accedir al Blob (${error.name || "error desconegut"}). Revisa els Runtime Logs de Vercel.`;
  return wrapped;
}

const storage = {
  async save(entry) {
    try {
      await put(
        `${prefix}${entry.createdAt}-${entry.id}.json`,
        JSON.stringify(entry),
        {
          ...blobOptions(),
          access: "private",
          addRandomSuffix: false,
          contentType: "application/json",
        },
      );
    } catch (error) {
      throw blobError(error);
    }
  },

  async list() {
    try {
      const options = blobOptions();
      const blobs = [];
      let cursor;
      do {
        const page = await list({ ...options, prefix, cursor, limit: 1000 });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);

      return await Promise.all(
        blobs.map(async (blob) => {
          const response = await get(blob.pathname, {
            ...options,
            access: "private",
            useCache: false,
          });
          if (!response)
            throw new Error(`Registration blob not found: ${blob.pathname}`);
          return new Response(response.stream).json();
        }),
      );
    } catch (error) {
      throw blobError(error);
    }
  },
};

export default createApp({
  storage,
  securityStore: blobSecurityStore({ options: blobOptions }),
});
