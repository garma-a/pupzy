import { Resolver, Query, Mutation, Args, Context, ResolveField, Root } from '@nestjs/graphql';
import { CommentsService, CommentConnection } from './comments.service';
import { validateCreateCommentInput } from './dto/create-comment.input';
import { validateCommentsQueryInput } from './dto/comments-query.input';
import { Comment } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

@Resolver('Comment')
export class CommentsResolver {
  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Publishes a text-only top-level Comment beneath a Post.
   * Requires authenticated user and durable clientRequestId.
   */
  @Mutation('createComment')
  async createComment(@Args('input') rawInput: unknown, @Context() ctx: GqlContext): Promise<Comment> {
    const input = validateCreateCommentInput(rawInput);
    return this.commentsService.createComment(ctx.user!.id, input);
  }

  /**
   * Queries top-level Comments for a Post with keyset pagination.
   */
  @Query('comments')
  async comments(
    @Args('postId') postId: string,
    @Args('sort') sort?: string,
    @Args('first') first?: number,
    @Args('after') after?: string,
  ): Promise<CommentConnection> {
    const input = validateCommentsQueryInput({ postId, sort, first, after });
    return this.commentsService.getComments(input);
  }

  /**
   * Resolves the author User object via per-request DataLoader.
   * Batches author lookups across all comments in the page without N+1 queries.
   */
  @ResolveField('author')
  async author(@Root() comment: Comment, @Context() ctx: GqlContext) {
    return ctx.loaders.userById.load(comment.authorId);
  }
}
