import { Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { GqlExceptionFilter as NestGqlExceptionFilter, GqlContextType } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { AppError } from '../errors/app.errors';

/**
 * Global GraphQL exception filter for Pupzy backend.
 *
 * ## Responsibilities
 * 1. **Catch everything** — both expected domain errors and unexpected crashes
 * 2. **Log fully** — full stack trace and request context are logged server-side
 * 3. **Sanitize** — only safe, structured information reaches the client
 * 4. **Code mapping** — translates exception types to GraphQL `extensions.code` values
 *
 * ## Registration
 * Registered globally in app.module.ts via APP_FILTER.
 *
 * ## Error codes returned to clients
 * | Source exception         | extensions.code      |
 * |--------------------------|----------------------|
 * | NotFoundError            | NOT_FOUND            |
 * | ForbiddenError           | FORBIDDEN            |
 * | ValidationError          | VALIDATION_ERROR     |
 * | ConflictError            | CONFLICT             |
 * | UnauthorizedException    | UNAUTHENTICATED      |
 * | ForbiddenException       | FORBIDDEN            |
 * | BadRequestException      | BAD_USER_INPUT       |
 * | Any other exception      | INTERNAL_SERVER_ERROR|
 */
@Catch()
export class GqlExceptionFilter implements NestGqlExceptionFilter {
  private readonly logger = new Logger(GqlExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): GraphQLError {
    // Only handle GraphQL requests; let REST exceptions propagate normally
    if (host.getType<GqlContextType>() !== 'graphql') {
      throw exception;
    }

    // ── Domain errors (thrown by services/repositories) ──────────────────
    if (exception instanceof AppError) {
      this.logger.warn(`[Domain Error] ${exception.code}: ${exception.message}`, exception.stack);
      return new GraphQLError(exception.message, {
        extensions: { code: exception.code },
      });
    }

    // ── NestJS HTTP exceptions (thrown by guards, pipes, etc.) ───────────
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = this.httpStatusToGqlCode(status);
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as Record<string, unknown>).message?.toString() ?? exception.message);

      this.logger.warn(`[HTTP Exception] ${status} ${code}: ${message}`);
      return new GraphQLError(message, {
        extensions: { code, httpStatus: status },
      });
    }

    // ── Unexpected errors — log fully, hide details from client ──────────
    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`[Unhandled Exception] ${err.message}`, err.stack, 'GqlExceptionFilter');

    // Never expose internal details in production
    const message =
      process.env.NODE_ENV === 'production' ? 'An unexpected error occurred. Please try again later.' : err.message;

    return new GraphQLError(message, {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }

  /** Maps HTTP status codes to GraphQL error extension codes. */
  private httpStatusToGqlCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_USER_INPUT',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'RATE_LIMITED',
    };
    return map[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
