import { Resolver, Query, Mutation, Args, Context, ResolveField, Parent } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { ContactsService } from './contacts.service';
import { validateRequestContactInput } from './dto/request-contact.input';
import type { GqlContext } from '../common/types/gql-context.type';
import type { ContactRequest } from '../database/schema';
import type { User } from '../database/schema';

/**
 * ContactsResolver — GraphQL resolver for contact request flows.
 *
 * ## Authentication
 * All operations require a logged-in user (global FirebaseAuthGuard).
 *
 * ## BOLA protection
 * - postContactRequests: verifies caller is post owner
 * - getWhatsAppLink: verifies caller is the original requester
 * - approveContactRequest/rejectContactRequest: verifies caller is post owner
 */
@Resolver('ContactRequest')
export class ContactsResolver {
  constructor(private readonly contactsService: ContactsService) {}

  // ─── Queries ─────────────────────────────────────────────────────────

  @Query('myContactRequests')
  async myContactRequests(
    @Args('postId') postId: string | undefined,
    @Args('status') status: string | undefined,
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Context() ctx: GqlContext,
  ) {
    return this.contactsService.getMyContactRequests(ctx.user!.id, postId, status, first, after);
  }

  @Query('postContactRequests')
  async postContactRequests(
    @Args('postId') postId: string,
    @Args('status') status: string | undefined,
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Context() ctx: GqlContext,
  ) {
    return this.contactsService.getPostContactRequests(ctx.user!.id, postId, status, first, after);
  }

  @Query('getWhatsAppLink')
  async getWhatsAppLink(@Args('requestId') requestId: string, @Context() ctx: GqlContext): Promise<string> {
    return this.contactsService.getWhatsAppLink(ctx.user!.id, requestId);
  }

  /**
   * Tight per-user throttle to prevent phone number scraping.
   * 5 calls per minute per user.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Query('getProductSellerContact')
  async getProductSellerContact(@Args('postId') postId: string, @Context() ctx: GqlContext): Promise<string> {
    return this.contactsService.getProductSellerContact(ctx.user!.id, postId);
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  /** Anti-spam: 20 contact requests per hour per IP (see AUD-15 re: true per-user limiting). */
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Mutation('requestContact')
  async requestContact(
    @Args('postId') postId: string,
    @Args('message') message: string,
    @Context() ctx: GqlContext,
  ): Promise<ContactRequest> {
    const validated = validateRequestContactInput({ postId, message });
    return this.contactsService.requestContact(ctx.user!.id, validated.postId, validated.message);
  }

  @Mutation('approveContactRequest')
  async approveContactRequest(@Args('requestId') requestId: string, @Context() ctx: GqlContext) {
    return this.contactsService.approveContactRequest(ctx.user!.id, requestId);
  }

  @Mutation('rejectContactRequest')
  async rejectContactRequest(
    @Args('requestId') requestId: string,
    @Context() ctx: GqlContext,
  ): Promise<ContactRequest> {
    return this.contactsService.rejectContactRequest(ctx.user!.id, requestId);
  }

  // ─── Field Resolvers ──────────────────────────────────────────────────

  /**
   * Resolves the `requester` field on ContactRequest.
   * Uses the `userById` DataLoader to batch-load users efficiently.
   */
  @ResolveField('requester')
  async requester(@Parent() contactRequest: ContactRequest, @Context() ctx: GqlContext): Promise<User | null> {
    return ctx.loaders.userById.load(contactRequest.requesterId);
  }
}
