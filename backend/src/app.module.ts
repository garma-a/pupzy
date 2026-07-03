import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const depthLimit = require('graphql-depth-limit') as (n: number) => unknown;
import type { ValidationRule } from 'graphql';

import { validateEnv } from './config/env.config';
import { DatabaseModule } from './database/database.module';
import { FirebaseModule } from './auth/firebase.module';
import { FirebaseAuthGuard } from './auth/firebase.guard';
import { UsersModule } from './users/users.module';
import { CitiesModule } from './cities/cities.module';
import { CitiesService } from './cities/cities.service';
import { HealthModule } from './health/health.module';
import { GqlExceptionFilter } from './common/filters/gql-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import type { GqlContext } from './common/types/gql-context.type';

/**
 * AppModule — root module for the Pupzy backend.
 *
 * ## Module structure
 * ```
 * AppModule
 * ├── ConfigModule       — env validation (Zod), global scope
 * ├── GraphQLModule      — Apollo + schema-first SDL, depth limiting
 * ├── ThrottlerModule    — rate limiting (configurable via env)
 * ├── DatabaseModule     — Drizzle ORM + pg pool, global scope
 * ├── FirebaseModule     — Firebase Admin SDK init, global scope
 * ├── UsersModule        — User entity: resolver, service, repository
 * ├── CitiesModule       — City list for onboarding city picker (public)
 * └── HealthModule       — GET /health endpoint for probes
 * ```
 *
 * ## Global providers
 * | Token             | Class                | Purpose                               |
 * |-------------------|----------------------|---------------------------------------|
 * | APP_GUARD (1)     | ThrottlerGuard       | Rate limiting — runs first            |
 * | APP_GUARD (2)     | FirebaseAuthGuard    | Firebase token verification + user DI |
 * | APP_FILTER        | GqlExceptionFilter   | Sanitized error responses             |
 * | APP_INTERCEPTOR   | LoggingInterceptor   | Request/response logging + requestId  |
 */
@Module({
  imports: [
    // ── Config: validate .env at startup, fail fast on missing vars ──────
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // ── GraphQL: schema-first, reads SDL .graphql files ──────────────────
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [CitiesModule],
      inject: [ConfigService, CitiesService],
      useFactory: (config: ConfigService, citiesService: CitiesService) => ({
        /**
         * Schema-first: all type definitions live in `.graphql` files.
         * Drizzle-inferred TypeScript types are generated to src/graphql.ts.
         */
        typePaths: ['./**/*.graphql'],
        definitions: {
          path: join(process.cwd(), 'src/graphql.ts'),
        },

        /**
         * Passes the Express Request into the GQL context so guards and
         * resolvers can access headers, IP, etc.
         * Also creates fresh per-request DataLoader instances to batch
         * DB lookups and prevent N+1 queries.
         */
        context: ({ req }: { req: Express.Request }): GqlContext => ({
          req: req as GqlContext['req'],
          loaders: {
            cityById: citiesService.createCityByIdLoader(),
          },
        }),

        /**
         * Playground: enabled in development, disabled in production.
         * Introspection: also disabled in production to hide the schema.
         */
        playground: config.get('NODE_ENV') !== 'production',
        introspection: config.get('NODE_ENV') !== 'production',

        /**
         * Query depth limiting — protects against deeply nested query attacks.
         * Adjust maxDepth as the schema grows; 10 is a safe default.
         */
        validationRules: [depthLimit(10) as ValidationRule],

        /**
         * Format errors before they are sent to the client.
         * GqlExceptionFilter handles the primary sanitization;
         * this is a last-resort fallback for errors that bypass the filter.
         */
        formatError: (error) => {
          const code =
            (error.extensions?.code as string) ?? 'INTERNAL_SERVER_ERROR';
          return {
            message: error.message,
            extensions: { code },
          };
        },
      }),
    }),

    // ── Rate limiting: protects all endpoints from abuse ─────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          /**
           * Default throttle: THROTTLE_LIMIT requests per THROTTLE_TTL_MS window.
           * Defaults to 100 req / 60s. Configurable per environment.
           */
          ttl: config.get<number>('THROTTLE_TTL_MS') ?? 60_000,
          limit: config.get<number>('THROTTLE_LIMIT') ?? 100,
        },
      ],
    }),

    DatabaseModule,
    FirebaseModule,
    UsersModule,
    CitiesModule,
    HealthModule,
    CacheModule.register({
      max: 3600,
      isGlobal: true,
    }),
  ],

  providers: [
    // ── Rate limiting guard — runs before auth guard ──────────────────────
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },

    /**
     * Firebase auth guard — applied globally to all GraphQL resolvers.
     * Use @Public() decorator on specific resolvers to opt out.
     *
     * Note: REST endpoints (e.g., /health) are not affected by this guard
     * because `GqlExecutionContext.create()` only processes GQL requests.
     */
    {
      provide: APP_GUARD,
      useClass: FirebaseAuthGuard,
    },

    // ── Global exception filter — sanitized GraphQL error responses ───────
    {
      provide: APP_FILTER,
      useClass: GqlExceptionFilter,
    },

    // ── Global interceptor — request logging + correlation IDs ────────────
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
