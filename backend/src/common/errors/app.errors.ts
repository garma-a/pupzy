/**
 * Domain-level error classes for Pupzy backend.
 *
 * Use these instead of raw NestJS HTTP exceptions in service/repository layers.
 * The GqlExceptionFilter maps them to appropriate GraphQL error extensions.
 *
 * @example
 *   throw new NotFoundError('User', userId);
 *   // → GraphQL error with extensions.code = 'NOT_FOUND'
 */

/** Base class for all application domain errors. */
export class AppError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code sent in GraphQL `extensions.code`. */
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Maintain proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when a requested resource does not exist.
 * Maps to HTTP 404 / GraphQL extensions.code = 'NOT_FOUND'.
 *
 * @example throw new NotFoundError('User', userId)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id "${id}" was not found` : `${resource} was not found`, 'NOT_FOUND');
  }
}

/**
 * Thrown when the authenticated user lacks permission for an action.
 * Maps to HTTP 403 / GraphQL extensions.code = 'FORBIDDEN'.
 *
 * @example throw new ForbiddenError('Only ADMIN users can delete listings')
 */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 'FORBIDDEN');
  }
}

/**
 * Thrown when input data fails business-logic validation (beyond schema validation).
 * Maps to HTTP 400 / GraphQL extensions.code = 'VALIDATION_ERROR'.
 *
 * @example throw new ValidationError('Phone number must be in E.164 format')
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

/**
 * Thrown for transient conflicts (e.g. duplicate email on a race condition).
 * Maps to HTTP 409 / GraphQL extensions.code = 'CONFLICT'.
 *
 * @example throw new ConflictError('A user with this email already exists')
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT');
  }
}
