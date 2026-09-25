import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for updating a post's lifecycle status.
 *
 * This is the transport-level allowlist of owner closure targets; the
 * per-type rule (including RESCUE's `ANIMAL_DECEASED` and LOST's direction)
 * is enforced by the shared lifecycle contract in the service and repository.
 */
const updatePostStatusSchema = z.object({
  postId: z.string().uuid('postId must be a valid UUID'),
  status: z.enum(['RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'ANIMAL_DECEASED']),
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
