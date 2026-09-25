import express from "express";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { digest, installSecurity, memorySecurityStore } from "./security.js";
import { blobSecurityStore } from "./blob-security.js";

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
  ["Interès en el butlletí de comerç", "butlletiComerc"],
  ["ID", "id"],
  ["Data d’inscripció", "createdAt"],
];

function csvCell(value) {
  let safeValue = String(value ?? "");
  if (
    /^[\s\u0000-\u001f]*[=+\-@]/.test(safeValue) ||
    /^[\t\r\n]/.test(safeValue)
  )
    safeValue = `'${safeValue}`;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function createApp({
  dataDir = resolve("data"),
  distDir = resolve("dist"),
  adminUsername = process.env.ADMIN_USERNAME || "admin",
  adminPassword = process.env.ADMIN_PASSWORD || "",
  storage,
  production = process.env.NODE_ENV === "production" ||
    Boolean(process.env.VERCEL),
  securityStore,
} = {}) {
  const app = express();
  const registrationsFile = resolve(dataDir, "inscripcions.jsonl");

  const registrationStorage = storage || {
    async list() {
      try {
        const contents = await readFile(registrationsFile, "utf8");
        const entries = new Map();
        for (const line of contents.split("\n").filter(Boolean)) {
          const item = JSON.parse(line);
          if (item.deletedAt) {
            const entry = entries.get(item.id);
            if (entry) entry.deletedAt = item.deletedAt;
          } else {
            entries.set(item.id, item);
          }
        }
        return [...entries.values()];
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
    async softDelete(id, deletedAt) {
      await appendFile(registrationsFile, JSON.stringify({ id, deletedAt }) + "\n", {
        mode: 0o600,
      });
    },
  };

  async function registrations() {
    return (await registrationStorage.list())
      .filter((entry) => !entry.deletedAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    if (production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
      );
    }
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const { requireAdmin, limit } = installSecurity(app, {
    adminUsername,
    adminPassword,
    production,
    store:
      securityStore ||
      (production ? blobSecurityStore() : memorySecurityStore()),
  });

  app.post(
    "/api/inscripcions",
    limit("form-ip", 20),
    limit("form-email", 5, 3600, (req) =>
      digest(
        String(req.body?.email || "")
          .trim()
          .toLowerCase(),
      ),
    ),
    async (req, res, next) => {
      try {
        const input = req.body;
        if (!input || typeof input !== "object" || Array.isArray(input))
          return res.status(400).json({ error: "El formulari no és vàlid." });
        if (input.website)
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
          Object.assign(fields, {
            nomAcompanyant: 150,
            cognomAcompanyant: 150,
          });
        const entry = {};
        for (const [key, max] of Object.entries(fields)) {
          if (
            typeof input[key] !== "string" ||
            !input[key].trim() ||
            input[key].trim().length > max ||
            /[\u0000-\u001f\u007f]/.test(input[key])
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
        if (
          input.butlletiComerc !== undefined &&
          typeof input.butlletiComerc !== "boolean"
        )
          return res.status(400).json({ error: "El formulari no és vàlid." });
        if (entry.acompanyant === "No")
          Object.assign(entry, { nomAcompanyant: "", cognomAcompanyant: "" });
        Object.assign(entry, {
          consentiment: true,
          butlletiComerc: input.butlletiComerc === true,
          consentText,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });
        await registrationStorage.save(entry);
        return res.status(201).json({ ok: true, id: entry.id });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/admin/inscripcions",
    requireAdmin,
    limit("admin-list", 60),
    async (_req, res, next) => {
      try {
        res.json({ ok: true, registrations: await registrations() });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/admin/inscripcions.csv",
    requireAdmin,
    limit("admin-export", 10),
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
        if (production)
          console.info(
            JSON.stringify({
              event: "admin.csv.export",
              at: new Date().toISOString(),
            }),
          );
        res.send(`\uFEFF${csv}`);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/admin/inscripcions/:id",
    requireAdmin,
    limit("admin-delete", 20),
    async (req, res, next) => {
      try {
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(req.params.id))
          return res.status(400).json({ error: "Identificador no vàlid." });
        const entry = (await registrations()).find(
          (item) => item.id === req.params.id,
        );
        if (!entry)
          return res.status(404).json({ error: "Inscripció no trobada." });
        await registrationStorage.softDelete(entry.id, new Date().toISOString());
        res.json({ ok: true });
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
  app.use((error, req, res, _next) => {
    const status =
      error.status === 400 || error.status === 413 ? error.status : 500;
    if (status === 500)
      console.error("Registration storage failed:", error.code || error.name);
    res.status(status).json({
      error:
        status === 500
          ? req.path.startsWith("/api/admin")
            ? "No s’ha pogut completar l’operació. Contacta amb l’administrador."
            : "No s’ha pogut guardar la inscripció. Torna-ho a provar."
          : "El formulari no és vàlid o és massa gran.",
    });
  });
  return app;
}
