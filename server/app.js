import express from "express";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export const consentText =
  "Accepto el tractament de les meves dades amb la finalitat d’inscriure’m a l’activitat indicada, d’acord amb el tractament 0459 de promoció del comerç de Barcelona.";

const csvColumns = [
  ["Nom", "nom"],
  ["Cognom", "cognom"],
  ["Correu electrònic", "email"],
  ["Telèfon", "telefon"],
  ["Portaràs acompanyant?", "acompanyant"],
  ["Nom de l'acompanyant", "nomAcompanyant"],
  ["Cognom de l'acompanyant", "cognomAcompanyant"],
  ["Nom de l’entitat i/o l’associació a la qual pertany", "entitat"],
  ["Adreça de l’entitat", "adreca"],
  ["Confirmació d’assistència", "assistencia"],
  ["Assistència per mobilitat reduïda", "mobilitat"],
  ["Consentiment", "consentText"],
  ["ID", "id"],
  ["Data d’inscripció", "createdAt"],
];

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function csvCell(value) {
  let safeValue = String(value ?? "");
  if (/^[=+\-@]/.test(safeValue)) safeValue = `'${safeValue}`;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function createApp({
  dataDir = resolve("data"),
  distDir = resolve("dist"),
  adminUsername = process.env.ADMIN_USERNAME || "admin",
  adminPassword = process.env.ADMIN_PASSWORD || "",
  storage,
} = {}) {
  const app = express();
  const registrationsFile = resolve(dataDir, "inscripcions.jsonl");

  const registrationStorage = storage || {
    async list() {
      try {
        const contents = await readFile(registrationsFile, "utf8");
        return contents
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    async save(entry) {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await appendFile(registrationsFile, JSON.stringify(entry) + "\n", {
        mode: 0o600,
      });
    },
  };

  async function registrations() {
    return (await registrationStorage.list()).sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  }

  function requireAdmin(req, res, next) {
    if (!adminPassword) {
      return res.status(503).json({
        error: "Configura ADMIN_PASSWORD al servidor per activar el CRM.",
      });
    }
    const [scheme, credentials] = (req.headers.authorization || "").split(" ");
    let username = "";
    let password = "";
    if (scheme === "Basic" && credentials) {
      const decoded = Buffer.from(credentials, "base64").toString();
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        username = decoded.slice(0, separator);
        password = decoded.slice(separator + 1);
      }
    }
    const validUsername = timingSafeEqual(
      hash(username || ""),
      hash(adminUsername),
    );
    const validPassword = timingSafeEqual(
      hash(password || ""),
      hash(adminPassword),
    );
    if (!validUsername || !validPassword) {
      return res
        .status(401)
        .json({ error: "Usuari o contrasenya incorrectes." });
    }
    next();
  }
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
      await registrationStorage.save(entry);
      return res.status(201).json({ ok: true, id: entry.id });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/inscripcions", requireAdmin, async (_req, res, next) => {
    try {
      res.json({ ok: true, registrations: await registrations() });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/admin/inscripcions.csv",
    requireAdmin,
    async (_req, res, next) => {
      try {
        const rows = await registrations();
        const csv = [
          csvColumns.map(([label]) => csvCell(label)).join(","),
          ...rows.map((entry) =>
            csvColumns.map(([, key]) => csvCell(entry[key])).join(","),
          ),
        ].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="inscripcions-premi-comerc-barcelona.csv"',
        );
        res.send(`\uFEFF${csv}`);
      } catch (error) {
        next(error);
      }
    },
  );

  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Ruta no trobada." }),
  );
  app.use(express.static(distDir));
  app.get("/admin", (_req, res) =>
    res.sendFile(resolve(distDir, "index.html")),
  );
  app.use((error, _req, res, _next) => {
    const status =
      error.status === 400 || error.status === 413 ? error.status : 500;
    if (status === 500)
      console.error("Registration storage failed:", error.code || error.name);
    res.status(status).json({
      error:
        status === 500
          ? "No s’ha pogut guardar la inscripció. Torna-ho a provar."
          : "El formulari no és vàlid o és massa gran.",
    });
  });
  return app;
}
