import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { MatingService } from './mating.service';
import { RequiresTermsAcceptance } from '../terms/requires-terms-acceptance.decorator';
import type { GqlContext } from '../common/types/gql-context.type';
import type { Post } from '../database/schema';
import type { MatingFeedFilterInput } from './mating.service';
import type { FeedLocationInput } from '../posts/dto/feed-query.input';

@Resolver('MatingPostConnection')
export class MatingResolver {
  constructor(private readonly matingService: MatingService) {}

  @Query('matingFeed')
  async matingFeed(
    @Args('filter') filter: MatingFeedFilterInput | undefined,
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Args('search') search: string | undefined,
    @Context() ctx: GqlContext,
    @Args('viewerLocation') viewerLocation?: FeedLocationInput['viewerLocation'],
    @Args('radiusKm') radiusKm?: number | null,
  ) {
    return this.matingService.matingFeed(
      filter ?? null,
      first ?? null,
      after ?? null,
      search ?? null,
      ctx.user?.id,
      viewerLocation,
      radiusKm,
    );
  }

  @Query('matingPostDetail')
  async matingPostDetail(@Args('postId') postId: string, @Context() ctx: GqlContext) {
    return this.matingService.getMatingPostDetail(postId, ctx.user?.id);
  }

  /**
   * Anti-spam: 5 mating posts per hour per IP (see plan §0.3 decision 9 re:
   * IP- vs user-scoping — AUD-15 has an optional per-user alternative).
   */
  @RequiresTermsAcceptance()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Mutation('createMatingPost')
  async createMatingPost(@Args('input') input: Record<string, unknown>, @Context() ctx: GqlContext): Promise<Post> {
    return this.matingService.createMatingPost(ctx.user!.id, input);
  }
}
