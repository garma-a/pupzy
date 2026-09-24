import { z } from 'zod';

/**
 * Zod schema for all required environment variables.
 *
 * Called by NestJS ConfigModule at startup — the app refuses to start
 * if any required variable is missing or invalid.
 */
const envSchema = z.object({
  // ─── Database ────────────────────────────────────────────────────────────
  /** Full PostgreSQL connection string. */
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL' }),

  /** Maximum connections in the pg pool. Defaults to 10. */
  DB_POOL_MAX: z.coerce.number().positive().default(10),
  /** Milliseconds before idle connections are released. Defaults to 30s. */
  DB_IDLE_TIMEOUT_MS: z.coerce.number().positive().default(30_000),
  /** Milliseconds to wait for a connection. Defaults to 2s. */
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().positive().default(2_000),

  /**
   * Required for encrypting phone numbers (AES-256-GCM).
   * Must be exactly 32 bytes encoded as base64.
   */
  PHONE_ENCRYPTION_KEY: z.string().length(44, 'Key must be exactly 44 chars (32 bytes base64)'),

  // ─── Firebase Admin SDK ──────────────────────────────────────────────────
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email({ message: 'FIREBASE_CLIENT_EMAIL must be a valid email' }),
  FIREBASE_PRIVATE_KEY: z.string().min(1),

  // ─── Cloudflare R2 (S3-compatible object storage) ─────────────────────
  /** Cloudflare account ID — found in the R2 dashboard URL. */
  R2_ACCOUNT_ID: z.string().min(1),
  /** R2 API token access key ID. */
  R2_ACCESS_KEY_ID: z.string().min(1),
  /** R2 API token secret access key. */
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  /** R2 bucket name, e.g. 'pupzy-media'. */
  R2_BUCKET_NAME: z.string().min(1),
  /** Public URL for the R2 bucket, e.g. 'https://pub-xxx.r2.dev'. */
  R2_PUBLIC_URL: z.string().url({ message: 'R2_PUBLIC_URL must be a valid URL' }),
  /**
   * Optional S3 endpoint override for local end-to-end runs against an
   * S3-compatible fake. Unset in every real deployment, which keeps the
   * derived `https://<account>.r2.cloudflarestorage.com` endpoint.
   */
  R2_ENDPOINT: z.string().url({ message: 'R2_ENDPOINT must be a valid URL' }).optional(),

  // ─── Application ─────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // ─── CORS ────────────────────────────────────────────────────────────────
  /**
   * Comma-separated list of allowed origins.
   * Example: "https://app.pupzy.com,http://localhost:3000"
   * Leave empty to block all cross-origin requests.
   */
  ALLOWED_ORIGINS: z.string().default(''),

  // ─── Rate Limiting ───────────────────────────────────────────────────────
  /** Max requests per window per IP. Defaults to 100. */
  THROTTLE_LIMIT: z.coerce.number().positive().default(100),
  /** Rate-limit window in milliseconds. Defaults to 60s. */
  THROTTLE_TTL_MS: z.coerce.number().positive().default(60_000),

  // ─── Feature Flags ──────────────────────────────────────────────────────
  /** Feature toggle for account deletion. Defaults to true in dev/test. */
  ACCOUNT_DELETION_ENABLED: z.coerce.boolean().default(true),

  // ─── Terms Acceptance ───────────────────────────────────────────────────
  /**
   * Public URL of the currently published Terms.
   * Configure together with TERMS_VERSION. While both are unset the terms
   * acceptance gate is inactive because no published document exists; when
   * both are set every protected publication/submission operation requires
   * acceptance of this exact version.
   */
  TERMS_URL: z.string().url({ message: 'TERMS_URL must be a valid URL' }).optional(),
  /**
   * Version identifier of the currently published Terms.
   * Never invented by the backend: the release owner supplies the actual
   * published version together with TERMS_URL.
   */
  TERMS_VERSION: z.string().min(1).max(64).optional(),
});

/**
 * Environment schema with cross-field rules.
 *
 * Terms Acceptance is configured as a pair: `TERMS_URL` and `TERMS_VERSION`
 * must be set together or left unset together, so a half-configured release
 * can never run with a partially active gate.
 */
const validatedEnvSchema = envSchema.refine((env) => (env.TERMS_VERSION ? Boolean(env.TERMS_URL) : !env.TERMS_URL), {
  message: 'TERMS_URL and TERMS_VERSION must be configured together (set both or neither)',
  path: ['TERMS_URL'],
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates the environment at application startup.
 * Throws a descriptive error listing every invalid field if validation fails.
 *
 * @param config - Raw environment variables from process.env
 * @returns Parsed, type-safe environment object
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = validatedEnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `❌ Environment validation failed:\n${result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}
