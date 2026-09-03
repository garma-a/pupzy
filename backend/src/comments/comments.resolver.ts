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
   * Toggles boost on a Comment or Reply.
   * Requires authenticated user. Returns resulting isBoostedByMe state and canonical boostCount.
   */
  @Mutation('toggleCommentBoost')
  async toggleCommentBoost(@Args('commentId') commentId: string, @Context() ctx: GqlContext) {
    assertUuid(commentId, 'commentId');
    return this.commentsService.toggleCommentBoost(ctx.user!.id, commentId);
  }

  /**
   * Pins an eligible top-level Comment beneath a Post.
   * Requires authenticated user and post ownership.
   */
  @Mutation('pinComment')
  async pinComment(@Args('commentId') commentId: string, @Context() ctx: GqlContext): Promise<Comment> {
    assertUuid(commentId, 'commentId');
    return this.commentsService.pinComment(ctx.user!.id, commentId);
  }

  /**
   * Unpins the currently pinned Comment beneath a Post.
   * Requires authenticated user and post ownership.
   */
  @Mutation('unpinComment')
  async unpinComment(@Args('postId') postId: string, @Context() ctx: GqlContext): Promise<boolean> {
    assertUuid(postId, 'postId');
    return this.commentsService.unpinComment(ctx.user!.id, postId);
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

  /**
   * Resolves whether the current viewer has boosted this comment or reply.
   * Uses per-request DataLoader when available.
   * Returns `false` for unauthenticated viewers.
   */
  @ResolveField('isBoostedByMe')
  async isBoostedByMe(@Root() comment: Comment, @Context() ctx: GqlContext): Promise<boolean> {
    const userId = ctx.user?.id ?? (ctx.req as unknown as { user?: { id: string } })?.user?.id;
    if (!userId) return false;
    if (ctx.loaders?.commentBoostedByMe) {
      return ctx.loaders.commentBoostedByMe.load(`${userId}:${comment.id}`);
    }
    return this.commentsService.isCommentBoostedByUser(comment.id, userId);
  }

  /**
   * Resolves the boostCount for the comment or reply.
   */
  @ResolveField('boostCount')
  boostCount(@Root() comment: Comment): number {
    return comment.boostCount ?? 0;
  }

  /**
   * Resolves whether this top-level comment is pinned.
   * Replies can never be pinned (always returns false).
   */
  @ResolveField('isPinned')
  async isPinned(@Root() comment: Comment, @Context() ctx: GqlContext): Promise<boolean> {
    if (comment.parentId) return false;
    if ((comment as unknown as { isPinned?: boolean }).isPinned !== undefined) {
      return (comment as unknown as { isPinned: boolean }).isPinned;
    }
    if (ctx.loaders?.pinnedCommentIdByPostId) {
      const pinnedId = await ctx.loaders.pinnedCommentIdByPostId.load(comment.postId);
      return pinnedId === comment.id;
    }
    return this.commentsService.isCommentPinned(comment.postId, comment.id);
  }
}
