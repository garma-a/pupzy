import { assertUuid } from '../common/utils/validate-uuid';
import { withDbRetry } from '../common/utils/db-retry.util';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { NotFoundError } from '../common/errors/app.errors';
import { postFollowerAudience } from './post-notification-policy';
import type { PushDeliveryExecutor } from './push-delivery.repository';

@Injectable()
export class PostNotificationPreferencesService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
    private readonly isolation: AccountIsolationPolicy,
  ) {}

  async get(userId: string, postId: string) {
    assertUuid(postId, 'postId');
    return this.read(this.db, userId, postId);
  }

  async setMuted(userId: string, postId: string, muted: boolean) {
    assertUuid(postId, 'postId');
    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const [post] = await tx
          .select({ creatorId: schema.posts.creatorId })
          .from(schema.posts)
          .where(eq(schema.posts.id, postId))
          .limit(1);
        if (!post || (await this.isolation.lockPairAndRecheck(tx, userId, post.creatorId))) {
          throw new NotFoundError('Post', postId);
        }
        await this.read(tx, userId, postId);
        await tx
          .insert(schema.postNotificationPreferences)
          .values({ userId, postId, muted })
          .onConflictDoUpdate({
            target: [schema.postNotificationPreferences.postId, schema.postNotificationPreferences.userId],
            set: { muted, updatedAt: new Date() },
          });
        if (muted) {
          // Terminally cancel pending activity so unmuting never replays it.
          // A send already handed to the provider cannot be recalled.
          await tx.execute(sql`
          UPDATE discussion_notification_events SET status = 'SUPPRESSED', lease_token = NULL,
            lease_expires_at = NULL, updated_at = now()
          WHERE related_post_id = ${postId}::uuid AND recipient_id = ${userId}::uuid
            AND status IN ('PENDING', 'PROCESSING')
        `);
          await tx.execute(sql`
          UPDATE post_completion_recipients r SET status = 'SUPPRESSED', lease_token = NULL,
            lease_expires_at = NULL, updated_at = now()
          FROM post_completion_notification_events e
          WHERE r.event_id = e.id AND r.post_id = ${postId}::uuid AND r.recipient_id = ${userId}::uuid
            AND r.status IN ('PENDING', 'PROCESSING') AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
        `);
          await tx.execute(sql`
          UPDATE push_deliveries d SET status = 'SUPPRESSED', lease_token = NULL,
            lease_expires_at = NULL, updated_at = now()
          FROM notifications n WHERE d.notification_id = n.id
            AND n.related_post_id = ${postId}::uuid AND d.recipient_id = ${userId}::uuid
            AND d.status IN ('PENDING', 'PROCESSING')
            AND n.type IN ('NEW_UPVOTE', 'POST_SAVED', 'NEW_COMMENT', 'NEW_REPLY', 'COMMENT_BOOSTED',
              'COMMENT_PINNED', 'POST_COMPLETED', 'RESCUE_COMPLETED', 'POST_REOPENED', 'RESCUE_REOPENED')
        `);
        }
        return this.read(tx, userId, postId);
      }),
    );
  }

  private async read(executor: PushDeliveryExecutor, userId: string, postId: string) {
    const result = await executor.execute<{ following: boolean; muted: boolean }>(sql`
      SELECT (
        p.creator_id = ${userId}::uuid OR EXISTS (
          SELECT 1 FROM (${postFollowerAudience(postId)}) audience WHERE audience.recipient_id = ${userId}::uuid
        )
      ) AS following, COALESCE(pref.muted, false) AS muted
      FROM posts p JOIN users owner ON owner.id = p.creator_id
      LEFT JOIN post_notification_preferences pref ON pref.post_id = p.id AND pref.user_id = ${userId}::uuid
      WHERE p.id = ${postId}::uuid AND p.status <> 'REMOVED' AND NOT owner.is_banned
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id = ${userId}::uuid AND b.blocked_id = p.creator_id) OR
          (b.blocked_id = ${userId}::uuid AND b.blocker_id = p.creator_id))
    `);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Post', postId);
    return {
      postId,
      isFollowing: row.following,
      isMuted: row.muted,
      notificationsEnabled: row.following && !row.muted,
    };
  }
}
