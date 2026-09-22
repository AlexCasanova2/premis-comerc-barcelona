import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const sameSecret = (a, b) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export const sessionSeconds = 3600;

// Only for local development/tests. Production must share state across instances.
export function memorySecurityStore() {
  const values = new Map();
  function get(key) {
    const item = values.get(key);
    if (!item || item.until <= Date.now()) {
      values.delete(key);
      return null;
    }
    return item.value;
  }
  return {
    async get(key) {
      return get(key);
    },
    async set(key, value, ttl) {
      values.set(key, { value, until: Date.now() + ttl * 1000 });
    },
    async del(key) {
      values.delete(key);
    },
    async increment(key, ttl) {
      for (const [oldKey, value] of values)
        if (value.until <= Date.now()) values.delete(oldKey);
      const count = (get(key) || 0) + 1;
      if (count === 1)
        values.set(key, { value: count, until: Date.now() + ttl * 1000 });
      else values.get(key).value = count;
      return count;
    },
  };
}

export function installSecurity(
  app,
  { adminUsername, adminPassword, production, store },
) {
  const cookieName = production ? "__Host-premi-session" : "premi-session";
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/",
  };
  const credentialVersion = digest(`${adminUsername}:${adminPassword}`);
  const keyPrefix = `premi:${process.env.VERCEL_ENV || (production ? "production" : "local")}:`;
  const sessionKey = (token) => `${keyPrefix}session:${digest(token)}`;
  const clientKey = (req) =>
    digest(
      production && process.env.VERCEL
        ? String(
            req.headers["x-vercel-forwarded-for"] || req.socket.remoteAddress,
          )
            .split(",")[0]
            .trim()
        : req.socket.remoteAddress || "local",
    );

  function cookieToken(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .find((part) => part.trim().startsWith(`${cookieName}=`));
    const value = cookie?.trim().slice(cookieName.length + 1) || "";
    return /^[a-f0-9]{64}$/.test(value) ? value : "";
  }

  function validOrigin(req) {
    const origin = req.headers.origin;
    const allowed = production
      ? [
          process.env.APP_ORIGIN ||
            "https://www.inscripcionspremicomercbarcelona.cat",
          ...(process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
            ? [`https://${process.env.VERCEL_URL}`]
            : []),
        ]
      : [
          `http://${req.get("host")}`,
          "http://localhost:5173",
          "http://127.0.0.1:5173",
        ];
    return typeof origin === "string" && allowed.includes(origin);
  }

  app.use("/api", (req, res, next) => {
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin && !validOrigin(req))
    ) {
      return res
        .status(403)
        .json({ error: "Origen de la petició no autoritzat." });
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      if (!validOrigin(req))
        return res
          .status(403)
          .json({ error: "Origen de la petició no autoritzat." });
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Format de petició no admès." });
    }
    next();
  });

  function limit(scope, maximum, ttl = 900, identity = clientKey) {
    return async (req, res, next) => {
      try {
        const count = await store.increment(
          `${keyPrefix}limit:${scope}:${identity(req)}`,
          ttl,
        );
        if (count > maximum) {
          res.setHeader("Retry-After", String(ttl));
          return res
            .status(429)
            .json({
              error:
                "Massa intents. Espera uns minuts abans de tornar-ho a provar.",
            });
        }
        next();
      } catch {
        // Never fall back to per-instance state in production.
        res
          .status(503)
          .json({
            error:
              "Servei temporalment no disponible. Torna-ho a provar més tard.",
          });
      }
    };
  }

  async function requireAdmin(req, res, next) {
    try {
      const token = cookieToken(req);
      const stored = token ? await store.get(sessionKey(token)) : null;
      const session = stored ? JSON.parse(stored) : null;
      if (
        !adminPassword ||
        !session ||
        session.version !== credentialVersion ||
        session.expiresAt <= Date.now()
      ) {
        res.clearCookie(cookieName, cookieOptions);
        return res
          .status(401)
          .json({ error: "La sessió ha caducat. Torna a iniciar sessió." });
      }
      req.adminSession = session;
      next();
    } catch {
      res
        .status(503)
        .json({
          error:
            "No s’ha pogut verificar la sessió. Torna-ho a provar més tard.",
        });
    }
  }

  app.post(
    "/api/admin/login",
    limit("login-ip", 8),
    limit("login-account", 40, 900, () => digest(adminUsername)),
    async (req, res, next) => {
      try {
        if (
          !adminPassword ||
          (production &&
            (adminPassword.length < 16 ||
              adminPassword === "canvia-aquesta-contrasenya"))
        ) {
          return res
            .status(503)
            .json({
              error:
                "L’accés administratiu no està configurat. Contacta amb l’administrador.",
            });
        }
        const { username, password } = req.body || {};
        const validInput =
          typeof username === "string" &&
          typeof password === "string" &&
          username.length <= 150 &&
          password.length <= 1024;
        const userMatches = sameSecret(
          validInput ? username : "",
          adminUsername,
        );
        const passwordMatches = sameSecret(
          validInput ? password : "",
          adminPassword,
        );
        if (!validInput || !userMatches || !passwordMatches) {
          if (production)
            console.info(
              JSON.stringify({
                event: "admin.login.denied",
                at: new Date().toISOString(),
              }),
            );
          return res
            .status(401)
            .json({ error: "Usuari o contrasenya incorrectes." });
        }
        const previous = cookieToken(req);
        if (previous) await store.del(sessionKey(previous));
        const token = randomBytes(32).toString("hex");
        const expiresAt = Date.now() + sessionSeconds * 1000;
        await store.set(
          sessionKey(token),
          JSON.stringify({ version: credentialVersion, expiresAt }),
          sessionSeconds,
        );
        res.cookie(cookieName, token, {
          ...cookieOptions,
          maxAge: sessionSeconds * 1000,
        });
        if (production)
          console.info(
            JSON.stringify({
              event: "admin.login.success",
              at: new Date().toISOString(),
            }),
          );
        res.json({ ok: true, expiresAt });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/admin/session",
    limit("session-ip", 120),
    requireAdmin,
    (req, res) => res.json({ ok: true, expiresAt: req.adminSession.expiresAt }),
  );
  app.post("/api/admin/logout", async (req, res, next) => {
    try {
      const token = cookieToken(req);
      if (token) await store.del(sessionKey(token));
      res.clearCookie(cookieName, cookieOptions);
      if (production)
        console.info(
          JSON.stringify({
            event: "admin.logout",
            at: new Date().toISOString(),
          }),
        );
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  return { requireAdmin, limit };
}
