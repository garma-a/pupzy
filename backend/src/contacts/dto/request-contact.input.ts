import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for the requestContact mutation input.
 * Validates postId format and message length.
 */
const requestContactSchema = z.object({
  postId: z.string().uuid('postId must be a valid UUID'),
  message: z
    .string()
    .min(10, 'Message must be at least 10 characters')
    .max(1000, 'Message must be at most 1000 characters'),
});

export type RequestContactInput = z.infer<typeof requestContactSchema>;

export function validateRequestContactInput(raw: unknown): RequestContactInput {
  const result = requestContactSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(msg);
  }
  return result.data;
}
