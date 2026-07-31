import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable, tap } from 'rxjs';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

/**
 * GraphQL operation logging interceptor.
 *
 * ## What it does
 * - Logs the start and end of every GraphQL operation
 * - Includes operation name, type, and duration
 * - RequestId is automatically attached by pino-http (via AsyncLocalStorage)
 *   so ALL log lines within the same request share the same requestId
 *
 * ## Registration
 * Registered globally in app.module.ts via APP_INTERCEPTOR.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @InjectPinoLogger(LoggingInterceptor.name)
    private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const gqlCtx = GqlExecutionContext.create(context);
    const info = gqlCtx.getInfo<{
      operation: { operation: string };
      fieldName: string;
    }>();

    const operationType = info?.operation?.operation ?? 'unknown';
    const operationName = info?.fieldName ?? 'unknown';

    const start = Date.now();
    this.logger.info({ operationType, operationName }, 'GraphQL operation started');

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - start;
          this.logger.info(
            { operationType, operationName, durationMs },
            'GraphQL operation completed',
          );
        },
        error: (err: unknown) => {
          const durationMs = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            { operationType, operationName, durationMs, error: message },
            'GraphQL operation failed',
          );
        },
      }),
    );
  }
}
