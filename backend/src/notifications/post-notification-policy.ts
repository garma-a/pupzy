import { posts, comments, users } from '../database/schema';
import type { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PushDeliveryExecutor } from './push-delivery.repository';
import type { NotificationType } from './notification-templates';

/** Current relationships establish following; merely viewing a feed does not. */
export function postFollowerAudience(postId: string): SQL {
  return sql`
    SELECT user_id AS recipient_id FROM post_upvotes WHERE post_id = ${postId}::uuid
    UNION SELECT user_id FROM post_saves WHERE post_id = ${postId}::uuid
    UNION SELECT author_id FROM comments
      WHERE post_id = ${postId}::uuid AND status NOT IN ('DELETED', 'REMOVED')
    UNION SELECT requester_id FROM contact_requests WHERE post_id = ${postId}::uuid
    UNION SELECT applicant_id FROM adoption_applications WHERE target_post_id = ${postId}::uuid
  `;
}

export function postNotificationsUnmuted(postId: string | SQL, userId: string | SQL): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM post_notification_preferences pref
    WHERE pref.post_id = ${postId}::uuid AND pref.user_id = ${userId}::uuid AND pref.muted
  )`;
}

const MUTABLE_ACTIVITY_TYPES: ReadonlySet<NotificationType> = new Set([
  'NEW_UPVOTE',
  'POST_SAVED',
  'NEW_COMMENT',
  'NEW_REPLY',
  'COMMENT_BOOSTED',
  'COMMENT_PINNED',
  'POST_COMPLETED',
  'RESCUE_COMPLETED',
  'POST_REOPENED',
  'RESCUE_REOPENED',
]);

export async function isPostActivityMuted(
  executor: PushDeliveryExecutor,
  postId: string | null | undefined,
  userId: string,
  type: NotificationType,
): Promise<boolean> {
  if (!postId || !MUTABLE_ACTIVITY_TYPES.has(type)) return false;
  const result = await executor.execute<{ muted: boolean }>(sql`
    SELECT NOT (${postNotificationsUnmuted(postId, userId)}) AS muted
  `);
  return result.rows[0].muted;
}

/** Recheck every account that can make the discussion inaccessible, under pair locks. */
export async function canDeliverDiscussion(
  tx: Parameters<AccountIsolationPolicy['lockPairs']>[0],
  isolation: AccountIsolationPolicy,
  event: {
    recipientId: string;
    actorId?: string | null;
    relatedPostId?: string | null;
    relatedCommentId?: string | null;
    type: NotificationType;
  },
): Promise<boolean> {
  if (!event.relatedPostId || !event.relatedCommentId) return false;
  const [post] = await tx.select().from(posts).where(eq(posts.id, event.relatedPostId)).limit(1);
  const [comment] = await tx.select().from(comments).where(eq(comments.id, event.relatedCommentId)).limit(1);
  if (!post || post.status === 'REMOVED' || !comment || comment.status === 'DELETED' || comment.status === 'REMOVED')
    return false;
  const parent = comment.parentId
    ? (await tx.select().from(comments).where(eq(comments.id, comment.parentId)).limit(1))[0]
    : undefined;
  if (comment.parentId && (!parent || parent.status === 'DELETED' || parent.status === 'REMOVED')) return false;
  const accountIds = [
    ...new Set([post.creatorId, event.actorId, comment.authorId, parent?.authorId].filter((id): id is string => !!id)),
  ];
  if (
    await isolation.lockPairsAndRecheck(
      tx,
      accountIds.map((id) => [id, event.recipientId] as const),
    )
  )
    return false;
  const [recipient] = await tx.select().from(users).where(eq(users.id, event.recipientId)).limit(1);
  if (!recipient || recipient.isBanned) return false;
  for (const id of accountIds) {
    const [account] = await tx.select({ isBanned: users.isBanned }).from(users).where(eq(users.id, id)).limit(1);
    if (!account || account.isBanned) return false;
  }
  return !(await isPostActivityMuted(tx, event.relatedPostId, event.recipientId, event.type));
}
