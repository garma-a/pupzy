import { z } from 'zod';

const envSchema = z.object({
  // @ts-ignore: Deprecated warning for ZodString
  DATABASE_URL: z.string().url(),
  FIREBASE_PROJECT_ID: z.string().min(1),
  // @ts-ignore: Deprecated warning for ZodString
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Environment validation failed:\n${result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}
