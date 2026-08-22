import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { MatingService } from './mating.service';
import type { GqlContext } from '../common/types/gql-context.type';
import type { Post } from '../database/schema';
import type { MatingFeedFilterInput } from './mating.service';

@Resolver('MatingPostConnection')
export class MatingResolver {
  constructor(private readonly matingService: MatingService) {}

  @Query('matingFeed')
  async matingFeed(
    @Args('filter') filter: MatingFeedFilterInput | undefined,
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
  ) {
    return this.matingService.matingFeed(filter ?? null, first ?? null, after ?? null);
  }

  @Query('matingPostDetail')
  async matingPostDetail(@Args('postId') postId: string) {
    return this.matingService.getMatingPostDetail(postId);
  }

  /**
   * Anti-spam: 5 mating posts per hour per IP (see plan §0.3 decision 9 re:
   * IP- vs user-scoping — AUD-15 has an optional per-user alternative).
   */
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Mutation('createMatingPost')
  async createMatingPost(
    @Args('input') input: Record<string, unknown>,
    @Context() ctx: GqlContext,
  ): Promise<Post> {
    return this.matingService.createMatingPost(ctx.user!.id, input);
  }
}
