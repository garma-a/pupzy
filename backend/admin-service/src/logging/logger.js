import { randomUUID } from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

/**
 * Paths and property names redacted in every environment.
 * Covers top-level properties, 1-level deep wildcards (*.key),
 * 2-levels deep wildcards (*.*.key), and standard request/response paths.
 */
export const REDACT_PATHS = [
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'headers["x-csrf-token"]',

  // Request body fields
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.passwordConfirmation',
  'req.body.phoneNumber',
  'req.body.phone',
  'req.body.secret',
  'req.body.sessionSecret',
  'req.body.cookiePassword',
  'req.body.adminSessionSecret',
  'req.body.adminCookiePassword',

  // Top-level sensitive properties
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'passwordConfirmation',
  'cookie',
  'cookies',
  'set-cookie',
  'pupzy_admin',
  'authorization',
  'token',
  'accessToken',
  'refreshToken',
  'bearer',
  'phoneNumber',
  'phone_number',
  'phone',
  'secret',
  'sessionSecret',
  'cookiePassword',
  'adminSessionSecret',
  'adminCookiePassword',
  'session',
  'sessionStore',
  'sessionID',

  // 1-level deep wildcard properties (*.key)
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordConfirmation',
  '*.cookie',
  '*.cookies',
  '*.set-cookie',
  '*.pupzy_admin',
  '*.authorization',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.bearer',
  '*.phone',
  '*.phoneNumber',
  '*.phone_number',
  '*.secret',
  '*.sessionSecret',
  '*.cookiePassword',
  '*.adminSessionSecret',
  '*.adminCookiePassword',
  '*.session',
  '*.sessionStore',
  '*.sessionID',

  // 2-levels deep wildcard properties (*.*.key)
  '*.*.password',
  '*.*.passwordHash',
  '*.*.password_hash',
  '*.*.currentPassword',
  '*.*.newPassword',
  '*.*.passwordConfirmation',
  '*.*.cookie',
  '*.*.cookies',
  '*.*.set-cookie',
  '*.*.pupzy_admin',
  '*.*.authorization',
  '*.*.token',
  '*.*.accessToken',
  '*.*.refreshToken',
  '*.*.bearer',
  '*.*.phone',
  '*.*.phoneNumber',
  '*.*.phone_number',
  '*.*.secret',
  '*.*.sessionSecret',
  '*.*.cookiePassword',
  '*.*.adminSessionSecret',
  '*.*.adminCookiePassword',
  '*.*.session',
];

export const REDACT_CONFIG = {
  paths: REDACT_PATHS,
  censor: '[REDACTED]',
};

/**
 * Compact request serializer that retains essential debugging context
 * (request ID, method, route/url, query, route params, client IP)
 * without dumping complete request headers or bodies.
 */
export function compactRequestSerializer(req) {
  if (!req) return req;
  const ip =
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    (req.headers && (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip']));

  return {
    id: req.id,
    method: req.method,
    url: req.url,
    query: req.query,
    params: req.params,
    ip: ip || undefined,
  };
}

/**
 * Compact response serializer that retains only status code
 * without dumping response headers.
 */
export function compactResponseSerializer(res) {
  if (!res) return res;
  return {
    statusCode: res.statusCode,
  };
}

/**
 * Checks whether the given URL is a health check endpoint.
 */
export function isHealthCheckUrl(url) {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === '/health' || path === '/healthz';
}

/**
 * Checks whether the given URL is a static asset endpoint.
 */
export function isStaticAssetUrl(url, rootPath = '/admin') {
  if (!url) return false;
  const path = url.split('?')[0];
  if (path === '/favicon.ico') return true;
  const normalizedRoot = rootPath.replace(/\/+$/, '');
  if (path.startsWith(`${normalizedRoot}/assets/`)) return true;
  if (path.startsWith(`${normalizedRoot}/frontend/assets/`)) return true;
  return false;
}

/**
 * Custom log level resolver:
 * - Errors (>= 500 or err object): 'error'
 * - Client errors (400 - 499): 'warn'
 * - Health checks and static assets with status < 400: 'silent' (suppressed)
 * - All other successful requests: 'info'
 */
export function determineLogLevel(req, res, err, rootPath = '/admin') {
  if (err || (res && res.statusCode >= 500)) {
    return 'error';
  }
  if (res && res.statusCode >= 400) {
    return 'warn';
  }
  const url = req?.url || '';
  if (isHealthCheckUrl(url) || isStaticAssetUrl(url, rootPath)) {
    return 'silent';
  }
  return 'info';
}

/**
 * Creates the base Pino logger configured with appropriate format,
 * redaction rules, level, and serializers.
 *
 * @param {object} env - Validated environment variables (NODE_ENV, LOG_LEVEL, etc.)
 * @param {object|WritableStream} [destinationStream] - Optional stream for capturing logs in tests
 * @returns {import('pino').Logger}
 */
export function createLogger(env = {}, destinationStream) {
  const isProduction = env.NODE_ENV === 'production';
  const level = env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

  const options = {
    level,
    redact: REDACT_CONFIG,
    serializers: {
      req: compactRequestSerializer,
      res: compactResponseSerializer,
      err: pino.stdSerializers.err,
    },
  };

  if (!isProduction && !destinationStream) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  }

  return destinationStream ? pino(options, destinationStream) : pino(options);
}

/**
 * Creates the pino-http middleware configured for admin-service.
 *
 * @param {import('pino').Logger} logger - Root Pino logger instance
 * @param {object} [options]
 * @param {string} [options.rootPath='/admin'] - AdminJS root path for static asset detection
 * @returns {import('express').RequestHandler}
 */
export function createHttpLoggingMiddleware(logger, { rootPath = '/admin' } = {}) {
  const httpMiddleware = pinoHttp({
    logger,
    genReqId: (req) => {
      const existing = req.headers['x-request-id'];
      if (existing) return Array.isArray(existing) ? existing[0] : existing;
      return randomUUID();
    },
    serializers: {
      req: compactRequestSerializer,
      res: compactResponseSerializer,
      err: pino.stdSerializers.err,
    },
    customLogLevel: (req, res, err) => determineLogLevel(req, res, err, rootPath),
  });

  return function adminHttpLogger(req, res, next) {
    httpMiddleware(req, res);
    if (req.id && !res.headersSent) {
      res.setHeader('x-request-id', req.id);
    }
    if (next) next();
  };
}
