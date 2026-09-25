import { z } from 'zod';
import { COMPLETED_POST_OUTCOMES } from '../../common/contracts/post-lifecycle.contract';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for updating a post's lifecycle status.
 *
 * The transport-level allowlist is the shared `COMPLETED_POST_OUTCOMES` list,
 * so it cannot drift from the contract; the per-type rule (including RESCUE's
 * `ANIMAL_DECEASED` and LOST's direction) is enforced by that contract in the
 * service and repository.
 */
const updatePostStatusSchema = z.object({
  postId: z.string().uuid('postId must be a valid UUID'),
  status: z.enum(COMPLETED_POST_OUTCOMES),
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
