import { Injectable, Logger } from '@nestjs/common';
import { ContactsRepository } from './contacts.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import type { ContactRequest } from '../database/schema';

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
  ) {}

  /**
   * Creates a new contact request.
   *
   * ## Business rules
   * - Post must be RESCUE, LOST, or ADOPTION (not PRODUCT)
   * - Post must be ACTIVE
   * - Requester cannot be the post owner
   * - One request per (requester, post) — duplicate check before DB constraint
   */
  async requestContact(requesterId: string, postId: string, message: string): Promise<ContactRequest> {
    assertUuid(postId, 'postId');

    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (!['RESCUE', 'LOST', 'ADOPTION'].includes(post.postType)) {
      throw new ValidationError('Contact requests are only for RESCUE, LOST, and ADOPTION posts');
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

    const contactRequest = await this.contactsRepository.create({
      postId,
      requesterId,
      message: message.trim(),
    });

    // Fire notification to post owner (non-blocking)
    const requester = await this.usersService.findById(requesterId);
    this.notificationsService.fireNotification(
      {
        recipientId: post.creatorId,
        type: 'CONTACT_REQUEST_RECEIVED',
        title: 'New contact request',
        body: `${requester?.fullName ?? 'Someone'} wants to contact you about "${post.title}"`,
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
   */
  async approveContactRequest(
    ownerId: string,
    requestId: string,
  ): Promise<ContactRequest & { whatsappLink: string | null }> {
    assertUuid(requestId, 'requestId');

    const request = await this.contactsRepository.findById(requestId);
    if (!request) throw new NotFoundError('ContactRequest', requestId);

    const post = await this.postsRepository.findById(request.postId);
    if (!post) throw new NotFoundError('Post', request.postId);
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can approve requests');
    }
    if (request.status !== 'PENDING') {
      throw new ValidationError(`Request is already ${request.status}`);
    }

    const updated = await this.contactsRepository.updateStatus(requestId, 'APPROVED');

    // Decrypt owner phone → build wa.me link
    const owner = await this.usersService.findById(ownerId);
    const whatsappLink = owner?.phoneNumber ? `https://wa.me/${owner.phoneNumber.replace(/\D/g, '')}` : null;

    // Fire notification to requester (non-blocking)
    this.notificationsService.fireNotification(
      {
        recipientId: request.requesterId,
        type: 'CONTACT_REQUEST_APPROVED',
        title: 'Contact request approved',
        body: `You can now contact the owner via WhatsApp about "${post.title}"`,
        relatedPostId: request.postId,
        relatedContactRequestId: requestId,
      },
      ownerId,
    );

    return { ...updated!, whatsappLink };
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
    if (!post) throw new NotFoundError('Post', request.postId);
    if (post.creatorId !== ownerId) {
      throw new ForbiddenError('Only the post owner can reject requests');
    }
    if (request.status !== 'PENDING') {
      throw new ValidationError(`Request is already ${request.status}`);
    }

    const updated = await this.contactsRepository.updateStatus(requestId, 'REJECTED');

    // Fire notification to requester (non-blocking)
    this.notificationsService.fireNotification(
      {
        recipientId: request.requesterId,
        type: 'CONTACT_REQUEST_REJECTED',
        title: 'Contact request update',
        body: `Your contact request about "${post.title}" was not approved`,
        relatedPostId: request.postId,
        relatedContactRequestId: requestId,
      },
      ownerId,
    );

    return updated!;
  }

  /**
   * Re-fetches the WhatsApp link for an already-approved contact request.
   * Only the original requester can call this.
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
    if (!post) throw new NotFoundError('Post', request.postId);

    const owner = await this.usersService.findById(post.creatorId);
    if (!owner?.phoneNumber) {
      throw new NotFoundError('Owner contact information is not available');
    }

    return `https://wa.me/${owner.phoneNumber.replace(/\D/g, '')}`;
  }

  /**
   * Returns the seller's WhatsApp contact for a PRODUCT post.
   * No approval gate — direct phone decrypt for classifieds.
   */
  async getProductSellerContact(callerId: string, postId: string): Promise<string> {
    assertUuid(postId, 'postId');

    const post = await this.postsRepository.findById(postId);
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

    const seller = await this.usersService.findById(post.creatorId);
    if (!seller?.phoneNumber) {
      throw new NotFoundError('Seller contact information is not available');
    }

    return `https://wa.me/${seller.phoneNumber.replace(/\D/g, '')}`;
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
    const limit = Math.min(first ?? 20, 50);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.contactsRepository.findByRequester({
      requesterId: userId,
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

    const limit = Math.min(first ?? 20, 50);
    const cursor = this.decodeCursor(afterCursor);

    const result = await this.contactsRepository.findByPost({
      postId,
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
