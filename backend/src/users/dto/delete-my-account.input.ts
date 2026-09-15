import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

const deleteMyAccountSchema = z.object({
  confirm: z.literal(true),
  progressToken: z.string().min(16).max(128).optional(),
});

export type DeleteMyAccountInput = z.infer<typeof deleteMyAccountSchema>;

export function validateDeleteMyAccountInput(raw: unknown): DeleteMyAccountInput {
  const result = deleteMyAccountSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(message || 'Explicit confirmation is required to permanently delete your account.');
  }
  return result.data;
}
