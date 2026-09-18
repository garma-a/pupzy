import { Module } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import type * as schema from '../database/schema';
import { ModerationReportQuotaManager } from './moderation-report-quota.manager';

/**
 * ModerationReportsModule exports the one shared moderation-report allowance.
 * Comment Reports, Post Reports, and future Pupzy Account Reports must import
 * this manager rather than creating a separate budget.
 */
@Module({
  providers: [
    {
      provide: ModerationReportQuotaManager,
      useFactory: (db: NodePgDatabase<typeof schema>) => new ModerationReportQuotaManager(db),
      inject: [DATABASE_TOKEN],
    },
  ],
  exports: [ModerationReportQuotaManager],
})
export class ModerationReportsModule {}
