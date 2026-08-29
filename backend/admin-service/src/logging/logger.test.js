import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import express from 'express';

import {
  createLogger,
  createHttpLoggingMiddleware,
  compactRequestSerializer,
  compactResponseSerializer,
  determineLogLevel,
  isHealthCheckUrl,
  isStaticAssetUrl,
  REDACT_PATHS,
} from './logger.js';

function createLogCapture() {
  const rawLogs = [];
  const parsedLogs = [];
  const stream = {
    write(chunk) {
      const text = chunk.toString();
      rawLogs.push(text);
      try {
        parsedLogs.push(JSON.parse(text));
      } catch {
        // Pretty or unparsed logs
      }
    },
  };
  return { stream, rawLogs, parsedLogs };
}

describe('admin-service logging', () => {
  describe('environment configuration & formats', () => {
    it('produces structured JSON logs in production mode', () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);

      logger.info({ testKey: 'testValue' }, 'production log message');

      assert.equal(parsedLogs.length, 1);
      const entry = parsedLogs[0];
      assert.equal(entry.level, 30);
      assert.equal(entry.testKey, 'testValue');
      assert.equal(entry.msg, 'production log message');
      assert.ok(typeof entry.time === 'number');
    });

    it('creates logger with debug level in development mode', () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'development' }, stream);

      logger.debug({ debugInfo: 'dev context' }, 'development debug line');

      assert.equal(parsedLogs.length, 1);
      assert.equal(parsedLogs[0].level, 20); // pino debug level = 20
      assert.equal(parsedLogs[0].msg, 'development debug line');
    });

    it('respects explicit LOG_LEVEL environment override', () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }, stream);

      logger.info('should be filtered out');
      logger.warn('should be captured');

      assert.equal(parsedLogs.length, 1);
      assert.equal(parsedLogs[0].level, 40); // pino warn level = 40
      assert.equal(parsedLogs[0].msg, 'should be captured');
    });
  });

  describe('compact serializers', () => {
    it('serializes request context with id, method, route, query, params, ip without headers or body', () => {
      const mockReq = {
        id: 'req-uuid-12345',
        method: 'POST',
        url: '/admin/resources/users/actions/new?tab=details',
        query: { tab: 'details' },
        params: { resourceId: 'users', action: 'new' },
        ip: '192.168.1.100',
        headers: {
          authorization: 'Bearer secret-admin-token',
          cookie: 'pupzy_admin=s%3Asession-token',
          'user-agent': 'Mozilla/5.0',
        },
        body: {
          email: 'admin@pupzy.org',
          password: 'SecretPassword123!',
          phoneNumber: '+201000000000',
        },
      };

      const serialized = compactRequestSerializer(mockReq);

      assert.equal(serialized.id, 'req-uuid-12345');
      assert.equal(serialized.method, 'POST');
      assert.equal(serialized.url, '/admin/resources/users/actions/new?tab=details');
      assert.deepEqual(serialized.query, { tab: 'details' });
      assert.deepEqual(serialized.params, { resourceId: 'users', action: 'new' });
      assert.equal(serialized.ip, '192.168.1.100');

      // Crucial: headers and body must NOT be present in serialized request
      assert.equal('headers' in serialized, false);
      assert.equal('body' in serialized, false);
    });

    it('serializes response with statusCode without dumping response headers', () => {
      const mockRes = {
        statusCode: 200,
        getHeaders: () => ({
          'set-cookie': ['pupzy_admin=s%3Asecret-session; Path=/'],
          'content-type': 'application/json',
        }),
      };

      const serialized = compactResponseSerializer(mockRes);

      assert.equal(serialized.statusCode, 200);
      assert.equal('headers' in serialized, false);
    });
  });

  describe('request correlation and propagation', () => {
    it('propagates incoming x-request-id and attaches it to response headers and log records', async () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);
      const httpMiddleware = createHttpLoggingMiddleware(logger);

      const app = express();
      app.use(httpMiddleware);
      app.get('/admin/test-correlation', (req, res) => {
        req.log.info({ insideRoute: true }, 'inside test route');
        res.status(200).json({ ok: true });
      });

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        const customReqId = 'custom-correlation-id-98765';
        const response = await fetch(`http://127.0.0.1:${port}/admin/test-correlation`, {
          headers: { 'x-request-id': customReqId },
        });

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-request-id'), customReqId);

        // Verify logs share the custom request id
        assert.ok(parsedLogs.length >= 2);
        for (const log of parsedLogs) {
          const reqId = log.req?.id || log.reqId;
          assert.equal(reqId, customReqId);
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('generates a consistent UUID when incoming x-request-id is missing', async () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);
      const httpMiddleware = createHttpLoggingMiddleware(logger);

      const app = express();
      app.use(httpMiddleware);
      app.get('/admin/test-generated-id', (req, res) => {
        req.log.info('handled request');
        res.status(200).json({ ok: true });
      });

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/admin/test-generated-id`);
        assert.equal(response.status, 200);

        const generatedId = response.headers.get('x-request-id');
        assert.ok(generatedId, 'Expected x-request-id response header');
        assert.match(
          generatedId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          'Generated ID must be a standard UUID',
        );

        for (const log of parsedLogs) {
          const reqId = log.req?.id || log.reqId;
          assert.equal(reqId, generatedId);
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('sensitive data redaction', () => {
    it('redacts cookies, authorization, passwords, phone numbers, and secrets in log payloads', () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);

      logger.info(
        {
          cookie: 'pupzy_admin=s%3Asupersecret',
          cookies: ['pupzy_admin=s%3Atoken'],
          authorization: 'Bearer jwt.token.here',
          token: 'sensitive-token-val',
          password: 'PlaintextPassword123',
          passwordHash: '$2a$12$e0MYbH5Q...',
          phoneNumber: '+201012345678',
          phone: '+201012345678',
          secret: 'top-secret-signing-key',
          sessionSecret: 'long-session-secret-32-chars',
          cookiePassword: 'long-cookie-password-32-chars',
          adminSessionSecret: 'admin-secret-material',
          adminCookiePassword: 'admin-cookie-material',
          session: { id: 'sess_123', store: 'pg' },
        },
        'redaction verification log',
      );

      assert.equal(parsedLogs.length, 1);
      const entry = parsedLogs[0];

      assert.equal(entry.cookie, '[REDACTED]');
      assert.equal(entry.cookies, '[REDACTED]');
      assert.equal(entry.authorization, '[REDACTED]');
      assert.equal(entry.token, '[REDACTED]');
      assert.equal(entry.password, '[REDACTED]');
      assert.equal(entry.passwordHash, '[REDACTED]');
      assert.equal(entry.phoneNumber, '[REDACTED]');
      assert.equal(entry.phone, '[REDACTED]');
      assert.equal(entry.secret, '[REDACTED]');
      assert.equal(entry.sessionSecret, '[REDACTED]');
      assert.equal(entry.cookiePassword, '[REDACTED]');
      assert.equal(entry.adminSessionSecret, '[REDACTED]');
      assert.equal(entry.adminCookiePassword, '[REDACTED]');
      assert.equal(entry.session, '[REDACTED]');
    });

    it('redacts nested fields matching sensitive patterns at multiple depths', () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);

      logger.info(
        {
          user: {
            id: 'usr_1',
            email: 'admin@pupzy.org',
            password: 'secretPassword',
            phoneNumber: '+201099999999',
            session: { sid: 'sess_abc' },
          },
          headers: {
            cookie: 'pupzy_admin=s%3Avalue',
            authorization: 'Bearer tok',
            'set-cookie': ['pupzy_admin=s%3Avalue'],
          },
          config: {
            secrets: {
              cookiePassword: 'secret-cookie-pw',
              adminSessionSecret: 'secret-sess-pw',
            },
          },
        },
        'nested redaction check',
      );

      assert.equal(parsedLogs.length, 1);
      const entry = parsedLogs[0];

      assert.equal(entry.user.id, 'usr_1');
      assert.equal(entry.user.email, 'admin@pupzy.org');
      assert.equal(entry.user.password, '[REDACTED]');
      assert.equal(entry.user.phoneNumber, '[REDACTED]');
      assert.equal(entry.user.session, '[REDACTED]');
      assert.equal(entry.headers.cookie, '[REDACTED]');
      assert.equal(entry.headers.authorization, '[REDACTED]');
      assert.equal(entry.config.secrets.cookiePassword, '[REDACTED]');
      assert.equal(entry.config.secrets.adminSessionSecret, '[REDACTED]');
    });
  });

  describe('structured error retention without leaking sensitive context', () => {
    it('preserves error type, message, and stack while withholding sensitive request context', () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);

      const testError = new Error('Database pool connection timeout');
      testError.code = 'ETIMEDOUT';

      logger.error(
        {
          err: testError,
          req: {
            id: 'req-err-123',
            method: 'POST',
            url: '/admin/api/resources/posts/records/1/edit',
            headers: { cookie: 'pupzy_admin=s%3Asensitive-cookie' },
            body: { password: 'PlainTextPassword' },
          },
        },
        'unhandled admin-service request error',
      );

      assert.equal(parsedLogs.length, 1);
      const entry = parsedLogs[0];

      assert.equal(entry.level, 50);
      assert.ok(entry.err);
      assert.equal(entry.err.type, 'Error');
      assert.equal(entry.err.message, 'Database pool connection timeout');
      assert.ok(entry.err.stack.includes('Database pool connection timeout'));

      // Request context must use compact serializer and redactor
      assert.equal(entry.req.id, 'req-err-123');
      assert.equal(entry.req.method, 'POST');
      assert.equal(entry.req.url, '/admin/api/resources/posts/records/1/edit');
      assert.equal('headers' in entry.req, false);
      assert.equal('body' in entry.req, false);
    });
  });

  describe('route suppression (health checks & static assets)', () => {
    it('identifies health check endpoints and static asset routes accurately', () => {
      assert.equal(isHealthCheckUrl('/health'), true);
      assert.equal(isHealthCheckUrl('/health?check=db'), true);
      assert.equal(isHealthCheckUrl('/healthz'), true);
      assert.equal(isHealthCheckUrl('/admin/resources'), false);

      assert.equal(isStaticAssetUrl('/favicon.ico'), true);
      assert.equal(isStaticAssetUrl('/admin/assets/pupzy-theme.css'), true);
      assert.equal(isStaticAssetUrl('/admin/assets/logo.png?v=2'), true);
      assert.equal(isStaticAssetUrl('/admin/frontend/assets/bundle.js'), true);
      assert.equal(isStaticAssetUrl('/admin/login'), false);
      assert.equal(isStaticAssetUrl('/admin/resources/users'), false);
    });

    it('determines log levels correctly: suppresses successful health/static while exposing failures', () => {
      // Successful health check (200) -> silent
      assert.equal(determineLogLevel({ url: '/health' }, { statusCode: 200 }, undefined), 'silent');
      // Failed health check (500) -> error
      assert.equal(determineLogLevel({ url: '/health' }, { statusCode: 500 }, undefined), 'error');
      // Thrown error on health check -> error
      assert.equal(determineLogLevel({ url: '/health' }, { statusCode: 500 }, new Error('DB down')), 'error');

      // Successful static asset (200 / 304 / 204) -> silent
      assert.equal(determineLogLevel({ url: '/admin/assets/logo.png' }, { statusCode: 200 }, undefined), 'silent');
      assert.equal(determineLogLevel({ url: '/admin/assets/logo.png' }, { statusCode: 304 }, undefined), 'silent');
      assert.equal(determineLogLevel({ url: '/favicon.ico' }, { statusCode: 204 }, undefined), 'silent');

      // Failed static asset (404 / 500) -> warn / error
      assert.equal(determineLogLevel({ url: '/admin/assets/missing.png' }, { statusCode: 404 }, undefined), 'warn');
      assert.equal(determineLogLevel({ url: '/admin/assets/broken.css' }, { statusCode: 500 }, undefined), 'error');

      // Normal application routes -> info / warn / error
      assert.equal(determineLogLevel({ url: '/admin/login' }, { statusCode: 200 }, undefined), 'info');
      assert.equal(determineLogLevel({ url: '/admin/resources/users' }, { statusCode: 200 }, undefined), 'info');
      assert.equal(determineLogLevel({ url: '/admin/login' }, { statusCode: 401 }, undefined), 'warn');
      assert.equal(determineLogLevel({ url: '/admin/api/dashboard' }, { statusCode: 500 }, undefined), 'error');
    });

    it('suppresses successful health checks and static assets over HTTP while logging failures', async () => {
      const { stream, parsedLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);
      const httpMiddleware = createHttpLoggingMiddleware(logger, { rootPath: '/admin' });

      const app = express();
      app.use(httpMiddleware);

      app.get('/health', (req, res) => res.status(200).json({ ok: true }));
      app.get('/health-failing', (req, res) => res.status(503).json({ error: 'DB unavailable' }));
      app.get('/favicon.ico', (req, res) => res.status(204).end());
      app.get('/admin/assets/theme.css', (req, res) => res.status(200).send('body { color: red }'));
      app.get('/admin/assets/missing.png', (req, res) => res.status(404).send('Not Found'));
      app.get('/admin/resources/posts', (req, res) => res.status(200).json({ records: [] }));

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        // 1. Successful health check -> should NOT be logged
        await fetch(`http://127.0.0.1:${port}/health`);
        // 2. Successful static asset -> should NOT be logged
        await fetch(`http://127.0.0.1:${port}/admin/assets/theme.css`);
        // 3. Favicon -> should NOT be logged
        await fetch(`http://127.0.0.1:${port}/favicon.ico`);

        assert.equal(parsedLogs.length, 0, 'Successful health and static assets must produce zero log lines');

        // 4. Failed health check (503) -> MUST be logged as error
        await fetch(`http://127.0.0.1:${port}/health-failing`);
        assert.equal(parsedLogs.length, 1);
        assert.equal(parsedLogs[0].req.url, '/health-failing');
        assert.equal(parsedLogs[0].res.statusCode, 503);
        assert.equal(parsedLogs[0].level, 50); // error level

        // 5. Missing static asset (404) -> MUST be logged as warn
        await fetch(`http://127.0.0.1:${port}/admin/assets/missing.png`);
        assert.equal(parsedLogs.length, 2);
        assert.equal(parsedLogs[1].req.url, '/admin/assets/missing.png');
        assert.equal(parsedLogs[1].res.statusCode, 404);
        assert.equal(parsedLogs[1].level, 40); // warn level

        // 6. Normal resource request (200) -> MUST be logged as info
        await fetch(`http://127.0.0.1:${port}/admin/resources/posts`);
        assert.equal(parsedLogs.length, 3);
        assert.equal(parsedLogs[2].req.url, '/admin/resources/posts');
        assert.equal(parsedLogs[2].res.statusCode, 200);
        assert.equal(parsedLogs[2].level, 30); // info level
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('signed AdminJS session cookie leakage protection', () => {
    it('proves that a signed AdminJS session cookie can NEVER appear in serialized log output', async () => {
      const { stream, rawLogs } = createLogCapture();
      const logger = createLogger({ NODE_ENV: 'production' }, stream);
      const httpMiddleware = createHttpLoggingMiddleware(logger, { rootPath: '/admin' });

      const signedSessionCookieSecret = 's%3A_b2W8Z_example_signed_cookie_payload.signature_hash_1234567890abcdef';
      const rawSessionCookieHeader = `pupzy_admin=${signedSessionCookieSecret}`;

      const app = express();
      app.use(httpMiddleware);

      // Route that receives the cookie, logs context, and sets a session cookie header on response
      app.post('/admin/api/resources/users/actions/edit', express.json(), (req, res) => {
        // Intentionally log various objects that might try to leak the cookie or session
        req.log.info({ cookie: req.headers.cookie }, 'route logging cookie parameter');
        req.log.info({ pupzy_admin: signedSessionCookieSecret }, 'route logging pupzy_admin parameter');
        req.log.info({ session: { cookie: signedSessionCookieSecret } }, 'route logging session object');
        req.log.warn({ headers: req.headers }, 'route logging raw headers');

        res.setHeader('Set-Cookie', `pupzy_admin=${signedSessionCookieSecret}; Path=/; HttpOnly`);
        res.status(200).json({ notice: { type: 'success', message: 'Updated' } });
      });

      // Route that throws an error while handling a request with a session cookie
      app.get('/admin/api/error-with-cookie', (req, res) => {
        const err = new Error('Simulated operation failure with cookie context');
        err.cookie = signedSessionCookieSecret;
        req.log.error({ err }, 'error handler log');
        res.status(500).json({ error: 'Failed' });
      });

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        // Execute POST with signed session cookie
        await fetch(`http://127.0.0.1:${port}/admin/api/resources/users/actions/edit`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: rawSessionCookieHeader,
            Authorization: 'Bearer signed-admin-auth-token-12345',
          },
          body: JSON.stringify({
            name: 'Updated Admin',
            password: 'NewSuperPassword123!',
            phoneNumber: '+201011112222',
          }),
        });

        // Execute GET with signed session cookie that triggers error
        await fetch(`http://127.0.0.1:${port}/admin/api/error-with-cookie`, {
          headers: {
            Cookie: rawSessionCookieHeader,
          },
        });

        assert.ok(rawLogs.length > 0, 'Logs must have been generated');

        // Concatenate all raw serialized output (every single character emitted)
        const combinedOutput = rawLogs.join('\n');

        // Absolute proof: neither the signed cookie secret nor the raw header appears anywhere in the output!
        assert.equal(
          combinedOutput.includes(signedSessionCookieSecret),
          false,
          `CRITICAL SAFETY VIOLATION: Signed session cookie secret "${signedSessionCookieSecret}" was found in serialized log output!`,
        );

        assert.equal(
          combinedOutput.includes(rawSessionCookieHeader),
          false,
          `CRITICAL SAFETY VIOLATION: Cookie header string "${rawSessionCookieHeader}" was found in serialized log output!`,
        );

        assert.equal(
          combinedOutput.includes('signed-admin-auth-token-12345'),
          false,
          'Authorization token must not appear in log output',
        );

        assert.equal(
          combinedOutput.includes('NewSuperPassword123!'),
          false,
          'Plaintext password must not appear in log output',
        );

        assert.equal(
          combinedOutput.includes('+201011112222'),
          false,
          'Phone number must not appear in log output',
        );
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
