import { get, list, put } from "@vercel/blob";
import { createApp } from "../server/app.js";

const prefix = "inscripcions/";

const storage = {
  async save(entry) {
    await put(
      `${prefix}${entry.createdAt}-${entry.id}.json`,
      JSON.stringify(entry),
      {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
      },
    );
  },

  async list() {
    const blobs = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return Promise.all(
      blobs.map(async (blob) => {
        const response = await get(blob.pathname, {
          access: "private",
          useCache: false,
        });
        if (!response)
          throw new Error(`Registration blob not found: ${blob.pathname}`);
        return new Response(response.stream).json();
      }),
    );
  },
};

export default createApp({ storage });
