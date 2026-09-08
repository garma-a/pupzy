import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../database/database.provider';
import type * as schema from '../database/schema';
import { withDbRetry } from '../common/utils/db-retry.util';

const USER_BAN_POST_CASCADE_BATCH_SIZE = 100;

type CascadeState = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'MISSING';

interface CascadeOutcome {
  state: CascadeState;
  cascadedPostCount: number;
}

/**
 * Continues the narrow durable work item created by the AdminJS ban action.
 * This is intentionally part of the existing always-on API scheduler rather
 * than a new process: AdminJS can sleep, but a PENDING cascade must survive
 * AdminJS and API restarts. One invocation processes at most one 100-Post
 * database-only page and contains no cache, R2, CDN, or notification-provider
 * callback.
 */
@Injectable()
export class UserBanPostCascadeProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserBanPostCascadeProcessor.name);
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.processPendingCascades();
    } catch (error) {
      this.logger.error('Unable to resume a pending user-ban Post cascade at startup', error);
    }
  }

  @Cron('*/5 * * * * *')
  async processScheduledCascade(): Promise<void> {
    try {
      await this.processPendingCascades();
    } catch (error) {
      this.logger.error('Unable to resume a pending user-ban Post cascade', error);
    }
  }

  /** Processes one pending cascade page; exposed for durable recovery tests. */
  async processPendingCascades(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    try {
      const processed = await this.processNextCascadeBatch();
      return processed ? 1 : 0;
    } finally {
      this.isProcessing = false;
    }
  }

  private async updateAudit(
    tx: any,
    actionId: string,
    state: Exclude<CascadeState, 'MISSING'>,
    cascadedPostCount: number,
    cursorPostId: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE moderation_actions
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'cascadedPostCount', ${cascadedPostCount}::integer,
        'postCascade', jsonb_build_object(
          'state', ${state}::text,
          'cascadedPostCount', ${cascadedPostCount}::integer,
          'cursorPostId', ${cursorPostId}::text
        )
      )
      WHERE id = ${actionId}
    `);
  }

  private async processNextCascadeBatch(): Promise<CascadeOutcome | undefined> {
    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const pending = await tx.execute<{ action_id: string }>(sql`
          SELECT action_id
          FROM user_ban_post_cascades
          WHERE state = 'PENDING'
          ORDER BY created_at ASC, action_id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
        const actionId = pending.rows[0]?.action_id;
        if (!actionId) return undefined;

        const cascadeResult = await tx.execute<{
          user_id: string;
          reason: string;
          ban_marker: string;
          cursor_post_id: string | null;
          cascaded_post_count: number;
          state: CascadeState;
          notification_sent_at: Date | null;
        }>(sql`
          SELECT user_id, reason, ban_marker, cursor_post_id,
                 cascaded_post_count, state, notification_sent_at
          FROM user_ban_post_cascades
          WHERE action_id = ${actionId}
        `);
        const cascade = cascadeResult.rows[0];
        if (!cascade) return { state: 'MISSING', cascadedPostCount: 0 };
        if (cascade.state !== 'PENDING') {
          return { state: cascade.state, cascadedPostCount: Number(cascade.cascaded_post_count) };
        }

        const candidates = await tx.execute<{ id: string }>(sql`
          SELECT id
          FROM posts
          WHERE creator_id = ${cascade.user_id}
            AND status = 'ACTIVE'
            AND (${cascade.cursor_post_id}::uuid IS NULL OR id > ${cascade.cursor_post_id}::uuid)
          ORDER BY id ASC
          LIMIT ${USER_BAN_POST_CASCADE_BATCH_SIZE}
        `);
        const postIds = candidates.rows.map((post) => post.id).sort();

        // Global discussion ordering: advisory Post key, Post row, then User.
        // The active-Post trigger used by restorePost also takes Post -> User.
        for (const postId of postIds) {
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(hashtextextended('comment_discussion:' || ${postId}, 0))
          `);
          await tx.execute(sql`SELECT id FROM posts WHERE id = ${postId} FOR UPDATE`);
        }

        const userResult = await tx.execute<{ is_banned: boolean; ban_marker: string | null }>(sql`
          SELECT is_banned,
                 to_char(banned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ban_marker
          FROM users
          WHERE id = ${cascade.user_id}
          FOR UPDATE
        `);
        const user = userResult.rows[0];
        const previousCount = Number(cascade.cascaded_post_count);
        if (!user || !user.is_banned || user.ban_marker !== cascade.ban_marker) {
          await tx.execute(sql`
            UPDATE user_ban_post_cascades
            SET state = 'CANCELLED', completed_at = now(), updated_at = now()
            WHERE action_id = ${actionId}
          `);
          await this.updateAudit(tx, actionId, 'CANCELLED', previousCount, cascade.cursor_post_id);
          return { state: 'CANCELLED', cascadedPostCount: previousCount };
        }

        if (postIds.length === 0) {
          if (previousCount > 0 && !cascade.notification_sent_at) {
            await tx.execute(sql`
              INSERT INTO notifications (recipient_id, type, title, body, is_read)
              VALUES (
                ${cascade.user_id},
                'POST_REMOVED_BY_ADMIN',
                'Your posts were removed',
                ${`Your account was banned (${cascade.reason}) and your active posts were removed.`},
                false
              )
            `);
          }
          await tx.execute(sql`
            UPDATE user_ban_post_cascades
            SET state = 'COMPLETED',
                notification_sent_at = CASE
                  WHEN ${previousCount} > 0 AND notification_sent_at IS NULL THEN now()
                  ELSE notification_sent_at
                END,
                completed_at = now(),
                updated_at = now()
            WHERE action_id = ${actionId}
          `);
          await this.updateAudit(tx, actionId, 'COMPLETED', previousCount, cascade.cursor_post_id);
          return { state: 'COMPLETED', cascadedPostCount: previousCount };
        }

        const removed = await tx.execute<{ id: string }>(sql`
          UPDATE posts
          SET status = 'REMOVED', updated_at = now()
          WHERE id IN (${sql.join(
            postIds.map((postId) => sql`${postId}::uuid`),
            sql`, `,
          )})
            AND creator_id = ${cascade.user_id}
            AND status = 'ACTIVE'
          RETURNING id
        `);
        const cascadedPostCount = previousCount + removed.rows.length;
        const cursorPostId = postIds[postIds.length - 1];
        await tx.execute(sql`
          UPDATE user_ban_post_cascades
          SET cursor_post_id = ${cursorPostId},
              cascaded_post_count = ${cascadedPostCount},
              updated_at = now()
          WHERE action_id = ${actionId}
        `);
        await this.updateAudit(tx, actionId, 'PENDING', cascadedPostCount, cursorPostId);
        return { state: 'PENDING', cascadedPostCount };
      }),
    );
  }
}
