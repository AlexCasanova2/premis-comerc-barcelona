import express from "express";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const consentText =
  "Accepto el tractament de les meves dades amb la finalitat d’inscriure’m a l’activitat indicada, d’acord amb el tractament 0459 de promoció del comerç de Barcelona.";

export function createApp({
  dataDir = resolve("data"),
  distDir = resolve("dist"),
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  app.post("/api/inscripcions", async (req, res, next) => {
    try {
      const input = req.body;
      if (!input || typeof input !== "object" || Array.isArray(input))
        return res.status(400).json({ error: "El formulari no és vàlid." });
      const fields = {
        nom: 150,
        cognom: 150,
        email: 254,
        telefon: 25,
        entitat: 300,
        adreca: 500,
      };
      if (input.acompanyant === "Sí")
        Object.assign(fields, { nomAcompanyant: 150, cognomAcompanyant: 150 });
      const entry = {};
      for (const [key, max] of Object.entries(fields)) {
        if (
          typeof input[key] !== "string" ||
          !input[key].trim() ||
          input[key].trim().length > max
        ) {
          return res
            .status(400)
            .json({ error: "Revisa els camps obligatoris del formulari." });
        }
        entry[key] = input[key].trim();
      }
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email) ||
        !/^[+0-9() .\-]{6,25}$/.test(entry.telefon) ||
        (entry.telefon.match(/\d/g) || []).length < 6
      ) {
        return res
          .status(400)
          .json({ error: "Revisa el correu electrònic i el telèfon." });
      }
      for (const key of ["acompanyant", "assistencia", "mobilitat"]) {
        if (!["Sí", "No"].includes(input[key]))
          return res
            .status(400)
            .json({ error: "Respon totes les preguntes d’assistència." });
        entry[key] = input[key];
      }
      if (input.consentiment !== true)
        return res
          .status(400)
          .json({ error: "Cal acceptar el tractament de les dades." });
      if (entry.acompanyant === "No")
        Object.assign(entry, { nomAcompanyant: "", cognomAcompanyant: "" });
      Object.assign(entry, {
        consentiment: true,
        consentText,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      });
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await appendFile(
        resolve(dataDir, "inscripcions.jsonl"),
        JSON.stringify(entry) + "\n",
        { mode: 0o600 },
      );
      return res.status(201).json({ ok: true, id: entry.id });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Ruta no trobada." }),
  );
  app.use(express.static(distDir));
  app.use((error, _req, res, _next) => {
    const status =
      error.status === 400 || error.status === 413 ? error.status : 500;
    if (status === 500)
      console.error("Registration storage failed:", error.code || error.name);
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "No s’ha pogut guardar la inscripció. Torna-ho a provar."
            : "El formulari no és vàlid o és massa gran.",
      });
  });
  return app;
}
