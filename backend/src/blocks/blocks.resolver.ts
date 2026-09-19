import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { BlocksService, type BlockedUserConnectionPayload } from './blocks.service';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * BlocksResolver — public Block management operations.
 *
 * ## Authentication
 * `blockUser`, `unblockUser`, and `blockedUsers` all require an authenticated
 * viewer (enforced by the global FirebaseAuthGuard). The target account is
 * always the explicit `userId` argument; the caller is never inferred from a
 * client-supplied identity.
 *
 * ## Privacy
 * Responses and errors never reveal Block direction or existence to the other
 * party: mutations are idempotent booleans, the list is viewer-scoped, and
 * nonexistent targets use the ordinary not-found path.
 */
@Resolver()
export class BlocksResolver {
  constructor(private readonly blocksService: BlocksService) {}

  // ─── Queries ─────────────────────────────────────────────────────────

  @Query('blockedUsers')
  async blockedUsers(
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Context() ctx: GqlContext,
  ): Promise<BlockedUserConnectionPayload> {
    return this.blocksService.getBlockedUsers(ctx.user!.id, first, after);
  }

  // ─── Mutations ───────────────────────────────────────────────────────

  @Mutation('blockUser')
  async blockUser(@Args('userId') userId: string, @Context() ctx: GqlContext): Promise<boolean> {
    return this.blocksService.blockUser(ctx.user!.id, userId);
  }

  @Mutation('unblockUser')
  async unblockUser(@Args('userId') userId: string, @Context() ctx: GqlContext): Promise<boolean> {
    return this.blocksService.unblockUser(ctx.user!.id, userId);
  }
}
