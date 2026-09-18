import { Module } from '@nestjs/common';
import { AccountReportsRepository } from './account-reports.repository';
import { AccountReportsService } from './account-reports.service';
import { AccountReportsResolver } from './account-reports.resolver';
import { ModerationReportsModule } from '../moderation-reports/moderation-reports.module';

/**
 * AccountReportsModule — owns Pupzy Account Report submission.
 *
 * Imports `ModerationReportsModule` so account reports admit through the one
 * shared moderation-report allowance instead of creating a separate budget.
 */
@Module({
  imports: [ModerationReportsModule],
  providers: [AccountReportsRepository, AccountReportsService, AccountReportsResolver],
  exports: [AccountReportsService],
})
export class AccountReportsModule {}
