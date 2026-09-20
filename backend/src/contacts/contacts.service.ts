import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ContactsRepository } from './contacts.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildNotificationContent } from '../notifications/notification-templates';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import { clampFirst } from '../common/utils/pagination.util';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import type { ContactRequest } from '../database/schema';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

const CONTACT_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

function assertStatusFilter(status: string | null | undefined): void {
  if (status && !(CONTACT_REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError('status must be one of PENDING, APPROVED, REJECTED');
  }
}

/**
 * ContactsService — business logic for contact request flows.
 *
 * ## Flow for RESCUE / LOST / ADOPTION:
 * 1. Requester sends contact request → creates PENDING row + notification
 * 2. Post owner reviews → approves or rejects
 * 3. On APPROVE: requester gets notification + WhatsApp link unlocked
 * 4. On REJECT: requester gets notification
 *
 * ## Flow for PRODUCT:
 * No approval gate — direct phone decrypt via getProductSellerContact().
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly contactsRepository: ContactsRepository,
    private readonly postsRepository: PostsRepository,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly isolationPolicy: AccountIsolationPolicy,
  ) {}

  /**
   * Creates a new contact request.
   *
   * ## Business rules
   * - Post must be RESCUE, LOST, or ADOPTION (not PRODUCT)
   * - Post must be ACTIVE
   * - Requester cannot be the post owner
   * - One request per (requester, post) — duplicate check before DB constraint
   * - Requester and post creator must not be isolated: the viewer-aware Post
   *   lookup hides a Blocked post like any inaccessible content, and the insert
   *   rechecks isolation under the canonical pair lock before committing
   */
  async requestContact(requesterId: string, postId: string, message: string): Promise<ContactRequest> {
    assertUuid(postId, 'postId');

    const post = await this.postsRepository.findById(postId, requesterId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (!['RESCUE', 'LOST', 'ADOPTION', 'MATING'].includes(post.postType)) {
      throw new ValidationError('Contact requests are only for RESCUE, LOST, ADOPTION, and MATING posts');
    }
    if (post.status !== 'ACTIVE') {
      throw new ValidationError('Cannot request contact on an inactive post');
    }
    if (post.creatorId === requesterId) {
      throw new ForbiddenError('You cannot request contact on your own post');
    }

    // Pre-check for duplicate before hitting DB constraint for cleaner error
    const existing = await this.contactsRepository.findExisting(postId, requesterId);
    if (existing) {
      throw new ConflictError('You have already sent a contact request for this post');
    }

    const contactRequest = await this.db.transaction(async (tx) => {
      // Pair lock before the insert: a Block committing first makes this fail
      // neutrally, and a Block committing second rejects the pending row.
      if (await this.isolationPolicy.lockPairAndRecheck(tx, requesterId, post.creatorId)) {
        return null;
      }
      return this.contactsRepository.create({ postId, requesterId, message: message.trim() }, tx);
    });
    if (!contactRequest) {
      throw new NotFoundError('Post', postId);
    }

    // Fire notification to post owner (non-blocking)
    const requester = await this.usersService.findById(requesterId);
    this.notificationsService.fireNotification(
      {
        recipientId: post.creatorId,
        type: 'CONTACT_REQUEST_RECEIVED',
        ...buildNotificationContent('CONTACT_REQUEST_RECEIVED', {
          actorName: requester?.fullName ?? 'Someone',
          postTitle: post.title,
        }),
        relatedPostId: postId,
        relatedContactRequestId: contactRequest.id,
      },
      requesterId,
    );

    return contactRequest;
  }

  /**
   * Approves a pending contact request.
   * Only the post owner can approve.
   * Returns the updated request with the WhatsApp link.
   *
   * The isolation recheck, the PENDING → APPROVED transition, and the owner
   * phone read that builds the wa.me link all run inside one transaction that
   * holds the canonical account-pair lock. Across a Block the request is
   * treated as unavailable and no link is ever disclosed.
   */
  async approveContactRequest(
    ownerId: string,
    requestId: string,
  ): Promise<ContactRequest & { whatsappLink: string | null }> {
    assertUuid(requestId, 'requestId');

    const request = await this.contactsRepository.findById(requestId);
    if (!request) throw new NotFoundError('ContactRequest', requestId);

    const post = await this.postsRepository.findById(request.postId);
    if (!post || post.status === 'REMOVED') throw new NotFoundError('Post', request.postId);
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can approve requests');
    }
    if (post.status !== 'ACTIVE') {
      throw new ValidationError('Cannot approve: this post is no longer active');
    }
    if (request.status !== 'PENDING') {
      throw new ValidationError(`Request is already ${request.status}`);
    }

    const outcome = await this.db.transaction(async (tx) => {
      if (await this.isolationPolicy.lockPairAndRecheck(tx, post.creatorId, request.requesterId)) {
        return { kind: 'unavailable' as const };
      }

      const updated = await this.contactsRepository.updateStatus(requestId, 'APPROVED', tx);
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
      // Neutral: identical to an unknown request, never reveals the Block.
      throw new NotFoundError('ContactRequest', requestId);
    }
    if (outcome.kind === 'lost') {
      // Lost a concurrent approve/reject race — no state change, no notification.
      const current = await this.contactsRepository.findById(requestId);
      throw new ConflictError(`Request is already ${current?.status ?? 'processed'}`);
    }

    // Notification ONLY after the transition succeeded
    this.notificationsService.fireNotification(
      {
        recipientId: request.requesterId,
        type: 'CONTACT_REQUEST_APPROVED',
        ...buildNotificationContent('CONTACT_REQUEST_APPROVED', { postTitle: post.title }),
        relatedPostId: request.postId,
        relatedContactRequestId: requestId,
      },
      ownerId,
    );

    return { ...outcome.updated, whatsappLink: outcome.whatsappLink };
  }

  /**
   * Rejects a pending contact request.
   * Only the post owner can reject.
   */
  async rejectContactRequest(ownerId: string, requestId: string): Promise<ContactRequest> {
    assertUuid(requestId, 'requestId');

    const request = await this.contactsRepository.findById(requestId);
    if (!request) throw new NotFoundError('ContactRequest', requestId);

    const post = await this.postsRepository.findById(request.postId);
    if (!post || post.status === 'REMOVED') throw new NotFoundError('Post', request.postId);
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can reject requests');
    }
    if (request.status !== 'PENDING') {
      throw new ValidationError(`Request is already ${request.status}`);
    }

    const updated = await this.contactsRepository.updateStatus(requestId, 'REJECTED');
    if (!updated) {
      // Lost a concurrent approve/reject race — no state change, no notification.
      const current = await this.contactsRepository.findById(requestId);
      throw new ConflictError(`Request is already ${current?.status ?? 'processed'}`);
    }

    // Fire notification to requester (non-blocking)
    this.notificationsService.fireNotification(
      {
        recipientId: request.requesterId,
        type: 'CONTACT_REQUEST_REJECTED',
        ...buildNotificationContent('CONTACT_REQUEST_REJECTED', { postTitle: post.title }),
        relatedPostId: request.postId,
        relatedContactRequestId: requestId,
      },
      ownerId,
    );

    return updated;
  }

  /**
   * Re-fetches the WhatsApp link for an already-approved contact request.
   * Only the original requester can call this.
   *
   * Isolation is rechecked under the canonical account-pair lock, and the
   * owner phone is read inside the same transaction so no disclosure can be
   * ordered after a Block. Across a Block the request resolves as unknown and
   * no phone or WhatsApp link is returned.
   */
  async getWhatsAppLink(callerId: string, requestId: string): Promise<string> {
    assertUuid(requestId, 'requestId');

    const request = await this.contactsRepository.findById(requestId);
    if (!request) throw new NotFoundError('ContactRequest', requestId);
    if (request.requesterId !== callerId) {
      throw new ForbiddenError('You can only view your own approved requests');
    }
    if (request.status !== 'APPROVED') {
      throw new ValidationError('Contact request has not been approved yet');
    }

    const post = await this.postsRepository.findById(request.postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', request.postId);
    }

    return this.db.transaction(async (tx) => {
      if (await this.isolationPolicy.lockPairAndRecheck(tx, callerId, post.creatorId)) {
        throw new NotFoundError('ContactRequest', requestId);
      }

      const owner = await this.usersService.findActiveById(post.creatorId, tx);
      if (!owner || owner.isBanned || !owner.phoneNumber) {
        throw new NotFoundError('Owner contact information is not available');
      }

      return `https://wa.me/${owner.phoneNumber.replace(/\D/g, '')}`;
    });
  }

  /**
   * Returns the seller's WhatsApp contact for a PRODUCT post.
   * No approval gate — direct phone decrypt for classifieds.
   *
   * The caller's view of the Post already hides isolated creators, and the
   * disclosure rechecks isolation under the canonical account-pair lock while
   * reading the seller phone inside the same transaction.
   */
  async getProductSellerContact(callerId: string, postId: string): Promise<string> {
    assertUuid(postId, 'postId');

    const post = await this.postsRepository.findById(postId, callerId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (post.postType !== 'PRODUCT') {
      throw new ValidationError('Direct seller contact is only available for PRODUCT posts');
    }
    if (post.status !== 'ACTIVE') {
      throw new ValidationError('This listing is no longer active');
    }
    if (post.creatorId === callerId) {
      throw new ForbiddenError('You cannot request contact for your own listing');
    }

    return this.db.transaction(async (tx) => {
      if (await this.isolationPolicy.lockPairAndRecheck(tx, callerId, post.creatorId)) {
        throw new NotFoundError('Post', postId);
      }

      const seller = await this.usersService.findActiveById(post.creatorId, tx);
      if (!seller || seller.isBanned || !seller.phoneNumber) {
        throw new NotFoundError('Seller contact information is not available');
      }

      return `https://wa.me/${seller.phoneNumber.replace(/\D/g, '')}`;
    });
  }

  /**
   * Returns paginated contact requests sent by the current user.
   */
  async getMyContactRequests(
    userId: string,
    postId: string | null | undefined,
    status: string | null | undefined,
    first: number | null | undefined,
    afterCursor: string | null | undefined,
  ) {
    if (postId) assertUuid(postId, 'postId');
    assertStatusFilter(status);

    const limit = clampFirst(first);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.contactsRepository.findByRequester({
      requesterId: userId,
      viewerId: userId,
      postId,
      status,
      limit,
      cursor,
    });

    return this.mapToConnection(result);
  }

  /**
   * Returns paginated contact requests on a specific post.
   * Only the post owner can view these.
   */
  async getPostContactRequests(
    userId: string,
    postId: string,
    status: string | null | undefined,
    first: number | null | undefined,
    afterCursor: string | null | undefined,
  ) {
    assertUuid(postId, 'postId');

    // BOLA check: verify caller is the post owner
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (post.creatorId !== userId) {
      throw new ForbiddenError('Only the post owner can view contact requests');
    }
    assertStatusFilter(status);

    const limit = clampFirst(first);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.contactsRepository.findByPost({
      postId,
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
   * Rejects every PENDING Contact Request between the two accounts in either
   * direction without deleting rows, so history is preserved and a rejected
   * record can never be approved later. Must run inside the caller's Block
   * transaction so the Block insert and the rejections commit atomically.
   *
   * Acquires the canonical account-pair lock, so standalone calls also
   * serialize with create/approval/disclosure paths. Emits no notification.
   */
  async rejectPendingContactRequestsBetweenAccounts(
    tx: DbTransaction,
    firstAccountId: string,
    secondAccountId: string,
  ): Promise<number> {
    await this.isolationPolicy.lockPair(tx, firstAccountId, secondAccountId);
    return this.contactsRepository.rejectPendingBetweenAccounts(firstAccountId, secondAccountId, tx);
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

  private encodeCursor(request: ContactRequest): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: request.createdAt.toISOString(),
        id: request.id,
      }),
      'utf8',
    ).toString('base64url');
  }

  private mapToConnection(result: { rows: ContactRequest[]; hasNextPage: boolean }) {
    return {
      edges: result.rows.map((request) => ({
        node: request,
        cursor: this.encodeCursor(request),
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        endCursor: result.rows.length > 0 ? this.encodeCursor(result.rows[result.rows.length - 1]) : null,
      },
    };
  }
}
