import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { accountReports, adoptionApplications, comments, contactRequests, posts, users } from '../database/schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/app.errors';
import { isUniqueViolation } from '../comments/comments.repository';
import type { ReportUserInput } from './dto/report-user.input';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export interface CreateAccountReportParams extends ReportUserInput {
  reporterId: string;
  quotaAdmissionId?: string;
}

/**
 * AccountReportsRepository — durable Pupzy Account Report persistence.
 *
 * ## Allowance
 * The caller reserves one slot of the shared moderation-report allowance
 * before calling in and passes the reservation id as `quotaAdmissionId`.
 * The inserted report row uses that id, which links the admission to its
 * committed report so the rolling count counts it exactly once.
 *
 * ## Blocks
 * Deliberately not consulted. Reporting is distinct from blocking, and a
 * Block must never hide evidence from administrators or make reporting fail.
 */
@Injectable()
export class AccountReportsRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Transactionally validates and records a Pupzy Account Report.
   * Rejects self-reports, missing targets, invalid source context, and a
   * duplicate open reporter/target pair. Never bans or suspends the target.
   */
  async createAccountReport(params: CreateAccountReportParams): Promise<boolean> {
    const { reporterId, userId, reason, details, sourceType, sourceId, quotaAdmissionId } = params;

    if (reporterId === userId) {
      throw new ForbiddenError('You cannot report your own Pupzy Account');
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        if (!target) {
          throw new NotFoundError('User', userId);
        }

        const [existingOpenReport] = await tx
          .select({ id: accountReports.id })
          .from(accountReports)
          .where(
            and(
              eq(accountReports.reporterId, reporterId),
              eq(accountReports.reportedUserId, userId),
              isNull(accountReports.reviewedAt),
            ),
          )
          .limit(1);
        if (existingOpenReport) {
          throw new ConflictError('You have already reported this Pupzy Account', 'ACCOUNT_ALREADY_REPORTED');
        }

        if (sourceType && sourceId) {
          await this.assertSourceContext(tx, { reporterId, reportedUserId: userId, sourceType, sourceId });
        }

        await tx.insert(accountReports).values({
          // The reservation id doubles as the report row id so the shared
          // allowance counts the committed report exactly once.
          ...(quotaAdmissionId ? { id: quotaAdmissionId } : {}),
          reporterId,
          reportedUserId: userId,
          reason,
          details: details ?? null,
          sourceType: sourceType ?? null,
          sourceId: sourceId ?? null,
        });

        return true;
      });
    } catch (error) {
      // The partial unique index is the concurrency authority for the
      // one-open-report rule; map its violation onto the same conflict.
      if (isUniqueViolation(error)) {
        throw new ConflictError('You have already reported this Pupzy Account', 'ACCOUNT_ALREADY_REPORTED');
      }
      throw error;
    }
  }

  /**
   * Proves that the optional source reference exists, is accessible to the
   * reporter, and involves the reported Pupzy Account.
   *
   * Every failure uses one uniform message so a reporter cannot probe whether
   * an arbitrary private interaction id exists.
   */
  private async assertSourceContext(
    tx: DbTransaction,
    params: {
      reporterId: string;
      reportedUserId: string;
      sourceType: NonNullable<ReportUserInput['sourceType']>;
      sourceId: string;
    },
  ): Promise<void> {
    const { reporterId, reportedUserId, sourceType, sourceId } = params;
    const invalid = () =>
      new ValidationError(
        'Source context does not exist, is inaccessible, or does not involve the reported Pupzy Account',
      );

    switch (sourceType) {
      case 'POST': {
        const [post] = await tx
          .select({ creatorId: posts.creatorId, status: posts.status })
          .from(posts)
          .where(eq(posts.id, sourceId))
          .limit(1);
        if (!post || post.status === 'REMOVED') throw invalid();
        if (post.creatorId !== reportedUserId) throw invalid();
        return;
      }

      case 'COMMENT': {
        const [comment] = await tx.select().from(comments).where(eq(comments.id, sourceId)).limit(1);
        if (!comment || (comment.status !== 'ACTIVE' && comment.status !== 'IMAGE_HIDDEN')) throw invalid();

        const [post] = await tx
          .select({ status: posts.status })
          .from(posts)
          .where(eq(posts.id, comment.postId))
          .limit(1);
        if (!post || post.status === 'REMOVED') throw invalid();

        if (comment.authorId !== reportedUserId) throw invalid();

        if (comment.parentId) {
          const [parent] = await tx
            .select({ status: comments.status, replyCount: comments.replyCount })
            .from(comments)
            .where(eq(comments.id, comment.parentId))
            .limit(1);
          if (!parent || parent.status === 'REMOVED') throw invalid();
          if ((parent.status === 'DELETED' || parent.status === 'HIDDEN') && parent.replyCount === 0) throw invalid();
        }
        return;
      }

      case 'CONTACT_REQUEST': {
        const [request] = await tx
          .select({ requesterId: contactRequests.requesterId, creatorId: posts.creatorId })
          .from(contactRequests)
          .innerJoin(posts, eq(contactRequests.postId, posts.id))
          .where(eq(contactRequests.id, sourceId))
          .limit(1);
        if (!request) throw invalid();

        const reporterIsRequester = request.requesterId === reporterId && request.creatorId === reportedUserId;
        const reporterIsOwner = request.creatorId === reporterId && request.requesterId === reportedUserId;
        if (!reporterIsRequester && !reporterIsOwner) throw invalid();
        return;
      }

      case 'ADOPTION_APPLICATION': {
        const [application] = await tx
          .select({ applicantId: adoptionApplications.applicantId, creatorId: posts.creatorId })
          .from(adoptionApplications)
          .innerJoin(posts, eq(adoptionApplications.targetPostId, posts.id))
          .where(eq(adoptionApplications.id, sourceId))
          .limit(1);
        if (!application) throw invalid();

        const reporterIsApplicant = application.applicantId === reporterId && application.creatorId === reportedUserId;
        const reporterIsOwner = application.creatorId === reporterId && application.applicantId === reportedUserId;
        if (!reporterIsApplicant && !reporterIsOwner) throw invalid();
        return;
      }
    }
  }
}
