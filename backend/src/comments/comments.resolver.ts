import { Resolver, Query, Mutation, Args, Context, ResolveField, Root } from '@nestjs/graphql';
import { CommentsService, CommentConnection } from './comments.service';
import { validateCreateCommentInput } from './dto/create-comment.input';
import { validateCreateReplyInput } from './dto/create-reply.input';
import { validateCommentsQueryInput, validateRepliesQueryInput } from './dto/comments-query.input';
import { assertUuid } from '../common/utils/validate-uuid';
import type { Comment } from '../database/schema';
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
   * Publishes a text-only Reply beneath a top-level Comment.
   * Requires authenticated user and durable clientRequestId.
   */
  @Mutation('createReply')
  async createReply(@Args('input') rawInput: unknown, @Context() ctx: GqlContext): Promise<Comment> {
    const input = validateCreateReplyInput(rawInput);
    return this.commentsService.createReply(ctx.user!.id, input);
  }

  /**
   * Deletes an authored Comment or Reply.
   * Requires authenticated user and ownership.
   */
  @Mutation('deleteComment')
  async deleteComment(@Args('id') id: string, @Context() ctx: GqlContext): Promise<boolean> {
    assertUuid(id, 'id');
    return this.commentsService.deleteComment(ctx.user!.id, id);
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
   * Queries Replies for a top-level Comment with keyset pagination (oldest first).
   */
  @Query('replies')
  async replies(
    @Args('commentId') commentId: string,
    @Args('first') first?: number,
    @Args('after') after?: string,
  ): Promise<CommentConnection> {
    const input = validateRepliesQueryInput({ commentId, first, after });
    return this.commentsService.getReplies(input);
  }

  /**
   * Resolves the author User object via per-request DataLoader.
   * For deleted comments (tombstones), author is null to hide author identity.
   */
  @ResolveField('author')
  async author(@Root() comment: Comment, @Context() ctx: GqlContext) {
    if (comment.status === 'DELETED') {
      return null;
    }
    return ctx.loaders.userById.load(comment.authorId);
  }

  /**
   * Resolves comment text.
   * For deleted comments (tombstones), original text is masked with [Deleted].
   */
  @ResolveField('text')
  text(@Root() comment: Comment): string {
    if (comment.status === 'DELETED') {
      return '[Deleted]';
    }
    return comment.text;
  }
}
