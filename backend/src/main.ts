import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Application bootstrap — entry point for the Pupzy backend.
 *
 * ## Security headers
 * `helmet` sets HTTP security headers (X-Frame-Options, CSP, HSTS, etc.)
 * to protect against common web vulnerabilities.
 *
 * ## CORS
 * Origins are read from the `ALLOWED_ORIGINS` environment variable
 * (comma-separated). Empty string = block all cross-origin requests.
 *
 * ## Graceful shutdown
 * Enables NestJS shutdown hooks so `OnApplicationShutdown` lifecycle methods
 * (e.g., database pool teardown) are called on SIGTERM / SIGINT.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Use NestJS built-in logger with timestamps
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // ── Security: HTTP headers ────────────────────────────────────────────────
  // helmet sets X-Frame-Options, X-Content-Type-Options, HSTS, CSP, etc.
  // GraphQL Playground served at /graphql in development needs relaxed CSP.
  app.use(
    helmet({
      // Allow GraphQL Playground iframes in development
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? undefined // strict CSP in production
          : false, // relaxed CSP so Playground loads in development
      crossOriginEmbedderPolicy: process.env.NODE_ENV !== 'production' ? false : true,
    }),
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Reads ALLOWED_ORIGINS from env — comma-separated list of allowed origins.
  // Example: "https://app.pupzy.com,http://localhost:3000"
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Calls OnApplicationShutdown lifecycle hooks on SIGTERM / SIGINT.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`🚀 Pupzy backend running on http://localhost:${port}`);
  logger.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`);
  logger.log(`❤️  Health check: http://localhost:${port}/health`);
}

void bootstrap();
