import 'dotenv/config';
import express from 'express';
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import AdminJSExpress from '@adminjs/express';
import { createLogger, createHttpLoggingMiddleware } from './logging/logger.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAdminJs } from './adminjs/index.js';
import { buildAuthenticate } from './auth/authenticate.js';
import { validateEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { ipAllowlist } from './middleware/ip-allowlist.js';
import { buildCsrfProtection } from './middleware/csrf.js';
import { requireSameOrigin } from './middleware/same-origin.js';
import { buildRequestTriggeredSessionPruning } from './middleware/session-pruning.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const env = validateEnv(process.env);
const logger = createLogger(env);
const pool = createPool(env.DATABASE_URL);
const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
const { admin, sqlAdapterPool } = await buildAdminJs(env.DATABASE_URL, databaseName, pool);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(createHttpLoggingMiddleware(logger, { rootPath: admin.options.rootPath }));
app.use(
  `${admin.options.rootPath}/assets`,
  express.static(path.join(currentDirectory, 'adminjs', 'public')),
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.get('/health', (_request, response) => response.json({ ok: true }));
app.get('/favicon.ico', (_request, response) => response.status(204).end());

if (env.ADMIN_ALLOWED_IPS) {
  const allowedIps = env.ADMIN_ALLOWED_IPS.split(',').map((value) => value.trim());
  app.use(admin.options.rootPath, ipAllowlist(allowedIps));
}

app.use(admin.options.rootPath, requireSameOrigin);
app.use(
  admin.options.rootPath,
  buildCsrfProtection(`${env.ADMIN_COOKIE_PASSWORD}:${env.ADMIN_SESSION_SECRET}`, {
    secure: env.NODE_ENV === 'production',
  }),
);
app.use(
  `${admin.options.rootPath}/login`,
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (request) => request.method !== 'POST',
    skipSuccessfulRequests: true,
  }),
);
app.use(
  `${admin.options.rootPath}/api/dashboard`,
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  `${admin.options.rootPath}/api/resources`,
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (request) => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
  }),
);

const PgSession = connectPgSimple(session);
const sessionStore = new PgSession({
  pool,
  createTableIfMissing: false,
  pruneSessionInterval: false,
  tableName: 'admin_sessions',
});
app.use(admin.options.rootPath, buildRequestTriggeredSessionPruning(sessionStore, { logger }));
const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
  admin,
  {
    authenticate: buildAuthenticate(pool, {
      onFailure: ({ ip, email, invalidIdentifier, blocked, trackedFailures }) =>
        logger.warn({ ip, email, invalidIdentifier, blocked, trackedFailures }, 'failed admin login attempt'),
    }),
    cookiePassword: `${env.ADMIN_COOKIE_PASSWORD}:${env.ADMIN_SESSION_SECRET}`,
    cookieName: 'pupzy_admin',
  },
  null,
  {
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    secret: env.ADMIN_SESSION_SECRET,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  },
  {
    maxFileSize: 1024 * 1024,
    maxFieldsSize: 64 * 1024,
    maxFields: 100,
  },
);
app.use(admin.options.rootPath, adminRouter);

app.use((error, request, response, _next) => {
  request.log?.error({ err: error }, 'unhandled admin-service request error');
  if (response.headersSent) return;
  response.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(env.PORT, () => {
  logger.info(`Pupzy admin service on http://localhost:${env.PORT}${admin.options.rootPath}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([pool.end(), sqlAdapterPool.destroy()]);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
