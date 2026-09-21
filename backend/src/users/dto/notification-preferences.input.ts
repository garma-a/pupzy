import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

const notificationsEnabledSchema = z.boolean({ message: 'notificationsEnabled must be a boolean' });

/**
 * Validates the push preference mutation argument. Disabling push never
 * deletes notifications: the in-app inbox and history stay intact and only
 * provider delivery is suppressed.
 */
export function validateNotificationsEnabledInput(raw: unknown): boolean {
  const result = notificationsEnabledSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}
