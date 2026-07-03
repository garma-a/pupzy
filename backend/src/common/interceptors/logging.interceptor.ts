import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';

/**
 * Logging interceptor for GraphQL operations.
 *
 * ## What it does
 * - Generates a unique `requestId` (UUID v4) per request
 * - Attaches the `requestId` to the GraphQL context so resolvers can log it
 * - Logs operation start with operation name and type
 * - Logs operation completion with duration in milliseconds
 * - Logs failures (the actual error is handled by GqlExceptionFilter)
 *
 * ## Registration
 * Registered globally in app.module.ts via APP_INTERCEPTOR.
 *
 * ## Log format (structured JSON in production via pino)
 * ```json
 * { "level": "log", "msg": "[GraphQL] query me +0ms", "requestId": "abc-123" }
 * { "level": "log", "msg": "[GraphQL] query me +45ms", "requestId": "abc-123" }
 * ```
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const gqlCtx = GqlExecutionContext.create(context);
    const info = gqlCtx.getInfo<{
      operation: { operation: string };
      fieldName: string;
    }>();

    // Generate a unique ID for this request for log correlation
    const requestId = randomUUID();
    const operationType = info?.operation?.operation ?? 'unknown';
    const operationName = info?.fieldName ?? 'unknown';

    // Attach requestId to GQL context so resolvers/services can reference it
    const ctx = gqlCtx.getContext<{ requestId?: string }>();
    ctx.requestId = requestId;

    const start = Date.now();
    this.logger.log(`[GraphQL] ${operationType} ${operationName} started`, `requestId=${requestId}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(`[GraphQL] ${operationType} ${operationName} completed in ${ms}ms`, `requestId=${requestId}`);
        },
        error: (err: unknown) => {
          const ms = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `[GraphQL] ${operationType} ${operationName} failed in ${ms}ms: ${message}`,
            `requestId=${requestId}`,
          );
        },
      }),
    );
  }
}
