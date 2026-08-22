import { Injectable, Logger } from '@nestjs/common';
import { AdoptionsRepository } from './adoptions.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import type { AdoptionApplication } from '../database/schema';
import type { SubmitAdoptionApplicationInput } from './dto/submit-adoption-application.input';

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
  ) {}

  /**
   * Submits a new adoption application.
   *
   * ## Business rules
   * - Target post must be ADOPTION type and ACTIVE
   * - Applicant cannot be the post owner
   * - One application per (applicant, post)
   */
  async submitApplication(applicantId: string, input: SubmitAdoptionApplicationInput): Promise<AdoptionApplication> {
    const { targetPostId, ...questionnaire } = input;

    const post = await this.postsRepository.findById(targetPostId);
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

    const application = await this.adoptionsRepository.create({
      targetPostId,
      applicantId,
      ...questionnaire,
    });

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
    if (!post) throw new NotFoundError('Post', application.targetPostId);
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can approve applications');
    }
    if (application.status !== 'PENDING') {
      throw new ValidationError(`Application is already ${application.status}`);
    }

    const updated = await this.adoptionsRepository.updateStatus(applicationId, 'APPROVED');
    if (!updated) {
      const current = await this.adoptionsRepository.findById(applicationId);
      throw new ConflictError(`Application is already ${current?.status ?? 'processed'}`);
    }

    // Decrypt owner phone → build wa.me link
    const owner = await this.usersService.findById(ownerId);
    const whatsappLink = owner?.phoneNumber ? `https://wa.me/${owner.phoneNumber.replace(/\D/g, '')}` : null;

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

    return { ...updated, whatsappLink };
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
    if (!post) throw new NotFoundError('Post', application.targetPostId);
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
   * Returns paginated applications submitted by the current user.
   */
  async getMyApplications(userId: string, first: number | null | undefined, afterCursor: string | null | undefined) {
    const limit = Math.min(first ?? 20, 50);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.adoptionsRepository.findByApplicant({
      applicantId: userId,
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

    const limit = Math.min(first ?? 20, 50);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.adoptionsRepository.findByPost({
      targetPostId: postId,
      status,
      limit,
      cursor,
    });

    return this.mapToConnection(result);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private decodeCursor(cursorBase64: string | null | undefined): { createdAt: string; id: string } | null {
    if (!cursorBase64) return null;
    try {
      return JSON.parse(Buffer.from(cursorBase64, 'base64url').toString('utf8')) as { createdAt: string; id: string };
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
