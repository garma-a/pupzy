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

  /** Maximum connections in the pg pool. Defaults to 20. */
  DB_POOL_MAX: z.coerce.number().positive().default(20),
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
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `❌ Environment validation failed:\n${result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}
