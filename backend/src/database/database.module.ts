import { Module, Global, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Pool } from 'pg';
import { databaseProvider, DATABASE_TOKEN } from './database.provider';

/**
 * DatabaseModule — global module that provides the Drizzle ORM database instance.
 *
 * ## Providers
 * - `DATABASE_URL` — raw connection string from ConfigService
 * - `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS` — pool config
 * - `databaseProvider` — creates the Drizzle `NodePgDatabase` instance
 *
 * ## Global scope
 * Decorated with `@Global()` so `DATABASE_TOKEN` is available to any module
 * without needing to import `DatabaseModule` explicitly.
 *
 * ## Graceful shutdown
 * Implements `OnApplicationShutdown` to cleanly close the connection pool
 * when the application stops, ensuring no connections are leaked.
 */
@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE_URL',
      useFactory: (config: ConfigService) => config.get<string>('DATABASE_URL'),
      inject: [ConfigService],
    },
    {
      provide: 'DB_POOL_MAX',
      useFactory: (config: ConfigService) => config.get<number>('DB_POOL_MAX') ?? 20,
      inject: [ConfigService],
    },
    {
      provide: 'DB_IDLE_TIMEOUT_MS',
      useFactory: (config: ConfigService) => config.get<number>('DB_IDLE_TIMEOUT_MS') ?? 30_000,
      inject: [ConfigService],
    },
    {
      provide: 'DB_CONNECTION_TIMEOUT_MS',
      useFactory: (config: ConfigService) => config.get<number>('DB_CONNECTION_TIMEOUT_MS') ?? 2_000,
      inject: [ConfigService],
    },
    databaseProvider,
  ],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Called by NestJS during graceful shutdown (SIGTERM, SIGINT, app.close()).
   * Ends the pg connection pool so in-flight queries complete before exit.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutting down pool on signal: ${signal ?? 'unknown'}`);
    try {
      const db: unknown = this.moduleRef.get(DATABASE_TOKEN, { strict: false });
      const pool = (db as { _pool?: Pool })._pool;
      if (pool) {
        await pool.end();
        this.logger.log('Connection pool closed gracefully.');
      }
    } catch (err) {
      this.logger.error('Error closing connection pool', err instanceof Error ? err.stack : String(err));
    }
  }
}
