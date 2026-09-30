import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { GqlContext } from '../common/types/gql-context.type';
import { PostNotificationPreferencesService } from './post-notification-preferences.service';

@Resolver()
export class PostNotificationPreferencesResolver {
  constructor(private readonly preferences: PostNotificationPreferencesService) {}

  @Query('myPostNotificationPreferences')
  get(@Args('postId') postId: string, @Context() ctx: GqlContext) {
    return this.preferences.get(ctx.user!.id, postId);
  }

  @Mutation('setPostNotificationsMuted')
  setMuted(@Args('postId') postId: string, @Args('muted') muted: boolean, @Context() ctx: GqlContext) {
    return this.preferences.setMuted(ctx.user!.id, postId, muted);
  }
}
