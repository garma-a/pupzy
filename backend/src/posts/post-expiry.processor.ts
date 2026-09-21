import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../database/database.provider';
import type * as schema from '../database/schema';
import {
  POST_EXPIRY_POLICIES,
  type PostExpiryPolicy,
  type PostLifecyclePostType,
} from '../common/contracts/post-lifecycle.contract';
import { buildNotificationContent } from '../notifications/notification-templates';
import { PostsRepository } from './posts.repository';

/** Upper bound on candidates handled per phase and scheduler invocation. */
export const POST_EXPIRY_CANDIDATE_BATCH_SIZE = 100;

interface ExpiryCandidate {
  id: string;
  postType: PostLifecyclePostType;
}

interface ReminderCandidate extends ExpiryCandidate {
  title: string;
}

/**
 * PostExpiryProcessor — the inactivity boundary for renewable listings.
 *
 * Every enabled entry in `POST_EXPIRY_POLICIES` is honoured: candidates are
 * selected oldest-inactivity-first in bounded batches, then each candidate is
 * applied through `PostsRepository`, which re-reads the Post under the shared
 * lifecycle locks and rechecks the window inside the committing transaction.
 *
 * ## Durability and multi-instance safety
 * A stale candidate can never expire a renewed, closed or removed Post, and
 * `reminder_sent_at` is written in the same transaction as its notification,
 * so retries and competing API processes create at most one reminder per
 * inactivity cycle. New activity moves `last_engaged_at` past the stored
 * reminder timestamp and starts a new cycle.
 *
 * ## Batch bounds
 * One invocation handles at most one `POST_EXPIRY_CANDIDATE_BATCH_SIZE` batch
 * of expiries and one batch of reminders, so a backlog is drained gradually by
 * the next scheduled runs without unbounded work in one invocation.
 */
@Injectable()
export class PostExpiryProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(PostExpiryProcessor.name);
  private isProcessing = false;

  constructor(
    private readonly postsRepository: PostsRepository,
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.processPendingExpiry();
    } catch (error) {
      this.logger.error('Unable to resume inactivity expiry at startup', error);
    }
  }

  @Cron('*/15 * * * *')
  async processScheduledExpiry(): Promise<void> {
    try {
      const result = await this.processPendingExpiry();
      if (result.expired > 0 || result.reminded > 0) {
        this.logger.log(`Inactivity run: expired=${result.expired} reminded=${result.reminded}`);
      }
    } catch (error) {
      this.logger.error('Unable to process inactivity expiry', error);
    }
  }

  /**
   * Drains one bounded inactivity run: expiries first, then reminders for the
   * Posts that remain Active. Exposing this method keeps restart, retry and
   * multi-worker behavior testable without the scheduler.
   */
  async processPendingExpiry(): Promise<{ expired: number; reminded: number }> {
    if (this.isProcessing) return { expired: 0, reminded: 0 };
    this.isProcessing = true;
    try {
      const expired = await this.expireDuePosts();
      const reminded = await this.remindInactiveOwners();
      return { expired, reminded };
    } finally {
      this.isProcessing = false;
    }
  }

  private async expireDuePosts(): Promise<number> {
    const candidates = await this.findExpiryCandidates(POST_EXPIRY_CANDIDATE_BATCH_SIZE);
    let expired = 0;

    for (const candidate of candidates) {
      const policy = POST_EXPIRY_POLICIES[candidate.postType];
      if (policy?.expiryAfterDays == null) continue;
      const post = await this.postsRepository.expireInactivePost(
        candidate.id,
        candidate.postType,
        policy.expiryAfterDays,
      );
      if (post) expired += 1;
    }
    return expired;
  }

  private async remindInactiveOwners(): Promise<number> {
    const candidates = await this.findReminderCandidates(POST_EXPIRY_CANDIDATE_BATCH_SIZE);
    let reminded = 0;

    for (const candidate of candidates) {
      const policy = POST_EXPIRY_POLICIES[candidate.postType];
      if (policy?.reminderAfterDays == null) continue;
      const post = await this.postsRepository.recordInactivityReminder({
        postId: candidate.id,
        postType: candidate.postType,
        reminderAfterDays: policy.reminderAfterDays,
        expiryAfterDays: policy.expiryAfterDays,
        content: buildNotificationContent('POST_INACTIVITY_NUDGE', { postTitle: candidate.title }),
      });
      if (post) reminded += 1;
    }
    return reminded;
  }

  private async findExpiryCandidates(limit: number): Promise<ExpiryCandidate[]> {
    const candidates: ExpiryCandidate[] = [];
    for (const [postType, policy] of this.enabledPolicies()) {
      const remaining = limit - candidates.length;
      if (remaining <= 0 || policy.expiryAfterDays == null) continue;

      const result = await this.db.execute<{ id: string; post_type: PostLifecyclePostType }>(sql`
        SELECT id, post_type
        FROM posts
        WHERE status = 'ACTIVE'
          AND post_type = ${postType}
          AND last_engaged_at <= now() - make_interval(days => ${policy.expiryAfterDays}::int)
        ORDER BY last_engaged_at ASC, id ASC
        LIMIT ${remaining}
      `);
      candidates.push(...result.rows.map((row) => ({ id: row.id, postType: row.post_type })));
    }
    return candidates;
  }

  private async findReminderCandidates(limit: number): Promise<ReminderCandidate[]> {
    const candidates: ReminderCandidate[] = [];
    for (const [postType, policy] of this.enabledPolicies()) {
      const remaining = limit - candidates.length;
      if (remaining <= 0 || policy.reminderAfterDays == null) continue;

      const result = await this.db.execute<{ id: string; post_type: PostLifecyclePostType; title: string }>(sql`
        SELECT id, post_type, title
        FROM posts
        WHERE status = 'ACTIVE'
          AND post_type = ${postType}
          AND last_engaged_at <= now() - make_interval(days => ${policy.reminderAfterDays}::int)
          AND (${policy.expiryAfterDays}::int IS NULL OR last_engaged_at > now() - make_interval(days => ${policy.expiryAfterDays}::int))
          AND (reminder_sent_at IS NULL OR reminder_sent_at < last_engaged_at)
        ORDER BY last_engaged_at ASC, id ASC
        LIMIT ${remaining}
      `);
      candidates.push(...result.rows.map((row) => ({ id: row.id, postType: row.post_type, title: row.title })));
    }
    return candidates;
  }

  private enabledPolicies(): Array<[PostLifecyclePostType, PostExpiryPolicy]> {
    return Object.entries(POST_EXPIRY_POLICIES) as Array<[PostLifecyclePostType, PostExpiryPolicy]>;
  }
}
