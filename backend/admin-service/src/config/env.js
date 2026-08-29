import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().url(),
  ADMIN_COOKIE_PASSWORD: z
    .string()
    .min(32, "ADMIN_COOKIE_PASSWORD must be at least 32 characters"),
  ADMIN_SESSION_SECRET: z
    .string()
    .min(32, "ADMIN_SESSION_SECRET must be at least 32 characters"),
  ADMIN_ALLOWED_IPS: z.string().default(""),
  MAP_TILE_URL: z.string().default("https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
  MAP_ATTRIBUTION: z
    .string()
    .default(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    ),
  EGYPT_MIN_LAT: z.coerce.number().default(21.0),
  EGYPT_MAX_LAT: z.coerce.number().default(32.0),
  EGYPT_MIN_LNG: z.coerce.number().default(24.0),
  EGYPT_MAX_LNG: z.coerce.number().default(37.5),
  NOMINATIM_URL: z.string().url().default("https://nominatim.openstreetmap.org/search"),
  NOMINATIM_USER_AGENT: z.string().default("PupzyAdmin/1.0 (contact@pupzy.app)"),
  NOMINATIM_ATTRIBUTION: z
    .string()
    .default(
      'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0'
    ),
  NOMINATIM_ENABLED: z.coerce.boolean().default(true),
  NOMINATIM_TIMEOUT_MS: z.coerce.number().default(5000),
  NOMINATIM_RATE_LIMIT_MS: z.coerce.number().default(1000),
});

/** @returns {z.infer<typeof envSchema>} */
export function validateEnv(raw) {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`admin-service environment validation failed:\n${lines}`);
  }
  return result.data;
}
