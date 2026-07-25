import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for updating a post's lifecycle status.
 */
const updatePostStatusSchema = z.object({
  postId: z.string().uuid('postId must be a valid UUID'),
  status: z.enum(['RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD']),
});

export type UpdatePostStatusInput = z.infer<typeof updatePostStatusSchema>;

export function validateUpdatePostStatusInput(raw: unknown): UpdatePostStatusInput {
  const result = updatePostStatusSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}
