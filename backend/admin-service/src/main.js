import "dotenv/config";
import express from "express";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import AdminJSExpress from "@adminjs/express";
import pino from "pino";
import pinoHttp from "pino-http";

import { buildAdminJs } from "./adminjs/index.js";
import { buildAuthenticate } from "./auth/authenticate.js";
import { validateEnv } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { ipAllowlist } from "./middleware/ip-allowlist.js";
import { requireSameOrigin } from "./middleware/same-origin.js";

const env = validateEnv(process.env);
const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
});
const pool = createPool(env.DATABASE_URL);
const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, "");
const { admin, sqlAdapterPool } = await buildAdminJs(
  env.DATABASE_URL,
  databaseName,
  pool,
);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(pinoHttp({ logger }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.get("/health", (_request, response) => response.json({ ok: true }));
app.get("/favicon.ico", (_request, response) => response.status(204).end());

if (env.ADMIN_ALLOWED_IPS) {
  const allowedIps = env.ADMIN_ALLOWED_IPS.split(",").map((value) =>
    value.trim(),
  );
  app.use(admin.options.rootPath, ipAllowlist(allowedIps));
}

app.use(admin.options.rootPath, requireSameOrigin);
app.use(
  `${admin.options.rootPath}/login`,
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const PgSession = connectPgSimple(session);
const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
  admin,
  {
    authenticate: buildAuthenticate(pool),
    cookiePassword: `${env.ADMIN_COOKIE_PASSWORD}:${env.ADMIN_SESSION_SECRET}`,
    cookieName: "pupzy_admin",
  },
  null,
  {
    store: new PgSession({
      pool,
      createTableIfMissing: false,
      tableName: "admin_sessions",
    }),
    resave: false,
    saveUninitialized: false,
    secret: env.ADMIN_SESSION_SECRET,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    },
  },
);
app.use(admin.options.rootPath, adminRouter);

app.use((error, request, response, _next) => {
  request.log?.error({ err: error }, "unhandled admin-service request error");
  if (response.headersSent) return;
  response.status(500).json({ error: "Internal server error" });
});

const server = app.listen(env.PORT, () => {
  logger.info(
    `Pupzy admin service on http://localhost:${env.PORT}${admin.options.rootPath}`,
  );
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([pool.end(), sqlAdapterPool.destroy()]);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
