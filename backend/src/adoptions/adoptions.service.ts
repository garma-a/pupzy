import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AdoptionsRepository } from './adoptions.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import { clampFirst } from '../common/utils/pagination.util';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import type { AdoptionApplication } from '../database/schema';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import type { SubmitAdoptionApplicationInput } from './dto/submit-adoption-application.input';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

const ADOPTION_APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

function assertStatusFilter(status: string | null | undefined): void {
  if (status && !(ADOPTION_APPLICATION_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError('status must be one of PENDING, APPROVED, REJECTED');
  }
}

/**
 * AdoptionsService — business logic for adoption application flows.
 *
 * ## Flow:
 * 1. Applicant submits questionnaire → creates PENDING application + notification
 * 2. Post owner reviews → approves or rejects
 * 3. On APPROVE: applicant gets notification + WhatsApp link unlocked
 * 4. On REJECT: applicant gets notification
 *
 * ## Design note on approval:
 * Approving does NOT auto-set the post to ADOPTED status.
 * The owner might approve multiple applicants before deciding.
 * The owner calls updatePostStatus(ADOPTED) separately when ready.
 */
@Injectable()
export class AdoptionsService {
  private readonly logger = new Logger(AdoptionsService.name);

  constructor(
    private readonly adoptionsRepository: AdoptionsRepository,
    private readonly postsRepository: PostsRepository,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly isolationPolicy: AccountIsolationPolicy,
  ) {}

  /**
   * Submits a new adoption application.
   *
   * ## Business rules
   * - Target post must be ADOPTION type and ACTIVE
   * - Applicant cannot be the post owner
   * - One application per (applicant, post)
   * - Applicant and post creator must not be isolated: the viewer-aware Post
   *   lookup hides a Blocked post like any inaccessible content, and the insert
   *   rechecks isolation under the canonical pair lock before committing
   */
  async submitApplication(applicantId: string, input: SubmitAdoptionApplicationInput): Promise<AdoptionApplication> {
    const { targetPostId, ...questionnaire } = input;
    assertUuid(targetPostId, 'targetPostId');

    const post = await this.postsRepository.findById(targetPostId, applicantId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', targetPostId);
    }
    if (post.postType !== 'ADOPTION') {
      throw new ValidationError('Applications can only be submitted for ADOPTION posts');
    }
    if (post.status !== 'ACTIVE') {
      throw new ValidationError('Cannot apply to an inactive adoption listing');
    }
    if (post.creatorId === applicantId) {
      throw new ForbiddenError('You cannot apply to your own adoption post');
    }

    // Pre-check for duplicate
    const existing = await this.adoptionsRepository.findExisting(targetPostId, applicantId);
    if (existing) {
      throw new ConflictError('You have already submitted an application for this post');
    }

    const outcome = await this.db.transaction(async (tx) => {
      // Pair lock before the insert: a Block committing first makes this fail
      // neutrally, and a Block committing second rejects the pending row.
      if (await this.isolationPolicy.lockPairAndRecheck(tx, applicantId, post.creatorId)) {
        return { kind: 'unavailable' as const };
      }
      // Re-read under a share lock so an owner closure committing after the
      // preflight above cannot leave a PENDING application on a closed listing.
      const lockedPost = await this.postsRepository.lockPostForInteraction(tx, targetPostId);
      if (!lockedPost || lockedPost.status === 'REMOVED') {
        return { kind: 'unavailable' as const };
      }
      if (lockedPost.status !== 'ACTIVE') {
        return { kind: 'inactive' as const };
      }
      return {
        kind: 'created' as const,
        application: await this.adoptionsRepository.create({ targetPostId, applicantId, ...questionnaire }, tx),
      };
    });
    if (outcome.kind === 'unavailable') {
      throw new NotFoundError('Post', targetPostId);
    }
    if (outcome.kind === 'inactive') {
      throw new ValidationError('Cannot apply to an inactive adoption listing');
    }
    const application = outcome.application;

    // Fire notification to post owner (non-blocking)
    const applicant = await this.usersService.findById(applicantId);
    this.notificationsService.fireNotification(
      {
        recipientId: post.creatorId,
        type: 'ADOPTION_APPLICATION_RECEIVED',
        title: 'New adoption application',
        body: `${applicant?.fullName ?? 'Someone'} applied to adopt from "${post.title}"`,
        relatedPostId: targetPostId,
        relatedApplicationId: application.id,
      },
      applicantId,
    );

    return application;
  }

  /**
   * Approves a pending adoption application.
   * Only the post owner can approve.
   * Returns the updated application with WhatsApp link.
   *
   * The isolation recheck, the PENDING → APPROVED transition, and the owner
   * phone read that builds the wa.me link all run inside one transaction that
   * holds the canonical account-pair lock. Across a Block the application is
   * treated as unavailable and no contact information is ever disclosed.
   */
  async approveApplication(
    ownerId: string,
    applicationId: string,
  ): Promise<AdoptionApplication & { whatsappLink: string | null }> {
    assertUuid(applicationId, 'applicationId');

    const application = await this.adoptionsRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('AdoptionApplication', applicationId);
    }

    const post = await this.postsRepository.findById(application.targetPostId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', application.targetPostId);
    }
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can approve applications');
    }
    if (post.status !== 'ACTIVE') {
      throw new ValidationError('Cannot approve: this post is no longer active');
    }
    if (application.status !== 'PENDING') {
      throw new ValidationError(`Application is already ${application.status}`);
    }

    const outcome = await this.db.transaction(async (tx) => {
      if (await this.isolationPolicy.lockPairAndRecheck(tx, post.creatorId, application.applicantId)) {
        return { kind: 'unavailable' as const };
      }

      const updated = await this.adoptionsRepository.updateStatus(applicationId, 'APPROVED', tx);
      if (!updated) {
        return { kind: 'lost' as const };
      }

      // Decrypt owner phone → build wa.me link inside the same transaction so
      // the disclosure is ordered with the approval, never after a later Block.
      const owner = await this.usersService.findActiveById(ownerId, tx);
      const whatsappLink = owner?.phoneNumber ? `https://wa.me/${owner.phoneNumber.replace(/\D/g, '')}` : null;
      return { kind: 'approved' as const, updated, whatsappLink };
    });

    if (outcome.kind === 'unavailable') {
      // Neutral: identical to an unknown application, never reveals the Block.
      throw new NotFoundError('AdoptionApplication', applicationId);
    }
    if (outcome.kind === 'lost') {
      const current = await this.adoptionsRepository.findById(applicationId);
      throw new ConflictError(`Application is already ${current?.status ?? 'processed'}`);
    }

    // Fire notification to applicant (non-blocking) ONLY after transition succeeds
    this.notificationsService.fireNotification(
      {
        recipientId: application.applicantId,
        type: 'ADOPTION_APPLICATION_APPROVED',
        title: 'Adoption application approved!',
        body: `Your adoption application for "${post.title}" has been approved. You can now contact the owner.`,
        relatedPostId: application.targetPostId,
        relatedApplicationId: applicationId,
      },
      ownerId,
    );

    return { ...outcome.updated, whatsappLink: outcome.whatsappLink };
  }

  /**
   * Rejects a pending adoption application.
   * Only the post owner can reject.
   */
  async rejectApplication(ownerId: string, applicationId: string): Promise<AdoptionApplication> {
    assertUuid(applicationId, 'applicationId');

    const application = await this.adoptionsRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('AdoptionApplication', applicationId);
    }

    const post = await this.postsRepository.findById(application.targetPostId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', application.targetPostId);
    }
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can reject applications');
    }
    if (application.status !== 'PENDING') {
      throw new ValidationError(`Application is already ${application.status}`);
    }

    const updated = await this.adoptionsRepository.updateStatus(applicationId, 'REJECTED');
    if (!updated) {
      const current = await this.adoptionsRepository.findById(applicationId);
      throw new ConflictError(`Application is already ${current?.status ?? 'processed'}`);
    }

    // Fire notification to applicant (non-blocking)
    this.notificationsService.fireNotification(
      {
        recipientId: application.applicantId,
        type: 'ADOPTION_APPLICATION_REJECTED',
        title: 'Adoption application update',
        body: `Your adoption application for "${post.title}" was not approved at this time`,
        relatedPostId: application.targetPostId,
        relatedApplicationId: applicationId,
      },
      ownerId,
    );

    return updated;
  }

  /**
   * Re-fetches the owner's WhatsApp link for an already-approved adoption application.
   * Only the original applicant can call this.
   *
   * Isolation is rechecked under the canonical account-pair lock, and the
   * owner phone is read inside the same transaction so no disclosure can be
   * ordered after a Block. Across a Block the application resolves as unknown
   * and no phone or WhatsApp link is returned.
   */
  async getAdoptionWhatsAppLink(callerId: string, applicationId: string): Promise<string> {
    assertUuid(applicationId, 'applicationId');

    const application = await this.adoptionsRepository.findById(applicationId);
    if (!application) throw new NotFoundError('AdoptionApplication', applicationId);
    if (application.applicantId !== callerId) {
      throw new ForbiddenError('You can only view your own approved applications');
    }
    if (application.status !== 'APPROVED') {
      throw new ValidationError('Adoption application has not been approved yet');
    }

    const post = await this.postsRepository.findById(application.targetPostId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', application.targetPostId);
    }

    return this.db.transaction(async (tx) => {
      if (await this.isolationPolicy.lockPairAndRecheck(tx, callerId, post.creatorId)) {
        throw new NotFoundError('AdoptionApplication', applicationId);
      }

      const owner = await this.usersService.findActiveById(post.creatorId, tx);
      if (!owner || owner.isBanned || !owner.phoneNumber) {
        throw new NotFoundError('Owner contact information is not available');
      }

      return `https://wa.me/${owner.phoneNumber.replace(/\D/g, '')}`;
    });
  }

  /**
   * Returns paginated applications submitted by the current user.
   */
  async getMyApplications(userId: string, first: number | null | undefined, afterCursor: string | null | undefined) {
    const limit = clampFirst(first);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.adoptionsRepository.findByApplicant({
      applicantId: userId,
      viewerId: userId,
      limit,
      cursor,
    });

    return this.mapToConnection(result);
  }

  /**
   * Returns paginated applications on a specific post.
   * Only the post owner can view these.
   */
  async getPostApplications(
    userId: string,
    postId: string,
    status: string | null | undefined,
    first: number | null | undefined,
    afterCursor: string | null | undefined,
  ) {
    assertUuid(postId, 'postId');

    // BOLA check
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (post.creatorId !== userId) {
      throw new ForbiddenError('Only the post owner can view applications');
    }
    assertStatusFilter(status);

    const limit = clampFirst(first);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.adoptionsRepository.findByPost({
      targetPostId: postId,
      viewerId: userId,
      status,
      limit,
      cursor,
    });

    return this.mapToConnection(result);
  }

  // ─── Isolation cleanup ───────────────────────────────────────────────

  /**
   * Transaction-safe cleanup contract for `blockUser`.
   *
   * Rejects every PENDING Adoption Application between the two accounts in
   * either direction without deleting rows, so history is preserved and a
   * rejected record can never be approved later. Must run inside the caller's
   * Block transaction so the Block insert and the rejections commit atomically.
   *
   * Acquires the canonical account-pair lock, so standalone calls also
   * serialize with create/approval/disclosure paths. Emits no notification.
   */
  async rejectPendingAdoptionApplicationsBetweenAccounts(
    tx: DbTransaction,
    firstAccountId: string,
    secondAccountId: string,
  ): Promise<number> {
    await this.isolationPolicy.lockPair(tx, firstAccountId, secondAccountId);
    return this.adoptionsRepository.rejectPendingBetweenAccounts(firstAccountId, secondAccountId, tx);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private decodeCursor(cursorBase64: string | null | undefined): { createdAt: string; id: string } | null {
    if (!cursorBase64) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursorBase64, 'base64url').toString('utf8')) as {
        createdAt: string;
        id: string;
      };
      const parsedDate = new Date(parsed.createdAt);
      if (Number.isNaN(parsedDate.getTime()) || typeof parsed.id !== 'string') {
        throw new ValidationError('Invalid cursor format');
      }
      return parsed;
    } catch {
      throw new ValidationError('Invalid cursor format');
    }
  }

  private encodeCursor(application: AdoptionApplication): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: application.createdAt.toISOString(),
        id: application.id,
      }),
      'utf8',
    ).toString('base64url');
  }

  private mapToConnection(result: { rows: AdoptionApplication[]; hasNextPage: boolean }) {
    return {
      edges: result.rows.map((app) => ({
        node: app,
        cursor: this.encodeCursor(app),
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        endCursor: result.rows.length > 0 ? this.encodeCursor(result.rows[result.rows.length - 1]) : null,
      },
    };
  }
}
