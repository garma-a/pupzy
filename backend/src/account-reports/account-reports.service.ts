import { Injectable } from '@nestjs/common';
import { AccountReportsRepository } from './account-reports.repository';
import { ModerationReportQuotaManager } from '../moderation-reports/moderation-report-quota.manager';
import type { ReportUserInput } from './dto/report-user.input';

/**
 * AccountReportsService — admission and validation for Pupzy Account Reports.
 *
 * A report first reserves one slot of the shared moderation-report allowance,
 * then commits the report row in a transaction. Any rejection, validation
 * failure, duplicate, or error rolls the reservation back, so invalid reports
 * consume nothing. Account Reports never automatically ban or suspend the
 * reported account and never consult Blocks.
 */
@Injectable()
export class AccountReportsService {
  constructor(
    private readonly accountReportsRepository: AccountReportsRepository,
    private readonly reportQuotaManager: ModerationReportQuotaManager,
  ) {}

  async reportUser(reporterId: string, input: ReportUserInput): Promise<boolean> {
    const reservation = await this.reportQuotaManager.reserveReportAllowance(reporterId);

    try {
      return await this.accountReportsRepository.createAccountReport({
        ...input,
        reporterId,
        quotaAdmissionId: reservation.admissionId,
      });
    } catch (error) {
      await reservation.rollback().catch(() => {});
      throw error;
    }
  }
}
