import { ValidationError } from '../errors/app.errors';

/**
 * UUID v4/v7 format regex.
 * Accepts lowercase hex with standard 8-4-4-4-12 grouping.
 * Case-insensitive to handle both lowercase and uppercase UUIDs.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asserts that a string is a valid UUID format.
 * Throws ValidationError (BAD_USER_INPUT) instead of letting invalid
 * UUIDs reach Postgres where they'd cause an INTERNAL_SERVER_ERROR.
 *
 * @param value - The string to validate
 * @param name  - Human-readable name for error messages (e.g., 'postId')
 * @throws {ValidationError} if the value is not a valid UUID
 */
export function assertUuid(value: string, name: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }
}
