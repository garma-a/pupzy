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
