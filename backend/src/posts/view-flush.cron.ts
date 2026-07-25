import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostsRepository } from './posts.repository';

/**
 * ViewFlushCron — flushes buffered view counts to Postgres every 3 minutes.
 *
 * ## Architecture
 * Views are buffered in-process (PostsService.viewBuffer Map) to reduce
 * Postgres write amplification. This cron drains the buffer and batch-updates
 * the database in a single SQL statement.
 *
 * ## Flow
 * 1. Drain the in-memory view buffer (atomic swap — no views lost)
 * 2. Batch UPDATE posts SET view_count += N for each post
 * 3. Recompute effective_score for ADOPTION and PRODUCT posts
 * 4. Update last_engaged_at for PRODUCT posts (views are primary signal)
 *
 * ## Why 3 minutes?
 * Balances freshness with write efficiency. At peak, thousands of views
 * per minute would hammer Postgres individually. Buffering reduces writes
 * from O(total_views) to O(unique_posts_viewed) per cycle.
 *
 * ## Failure handling
 * If the flush fails, buffered views are lost for that cycle.
 * This is acceptable — view counts are eventually consistent analytics,
 * not transactional data. The next cycle will capture new views.
 */
@Injectable()
export class ViewFlushCron {
  private readonly logger = new Logger(ViewFlushCron.name);

  /**
   * In-memory view buffer.
   * Key: postId, Value: number of views since last flush.
   *
   * ## Thread safety
   * Node.js is single-threaded, so Map operations are atomic with respect
   * to the event loop. No mutex needed.
   */
  readonly viewBuffer = new Map<string, number>();

  constructor(private readonly postsRepository: PostsRepository) {}

  /**
   * Buffers a view for later flushing.
   * Called by PostsService.recordView() after deduplication.
   */
  bufferView(postId: string): void {
    const current = this.viewBuffer.get(postId) ?? 0;
    this.viewBuffer.set(postId, current + 1);
  }

  /**
   * Drains the buffer and returns a snapshot.
   * The original buffer is cleared atomically (from the event loop's perspective).
   * New views arriving after this call go into the fresh (empty) buffer.
   */
  private drainBuffer(): Map<string, number> {
    const snapshot = new Map(this.viewBuffer);
    this.viewBuffer.clear();
    return snapshot;
  }

  /**
   * Cron handler — runs every 3 minutes.
   * Drains the buffer and flushes to Postgres in a single batch UPDATE.
   */
  @Cron('*/3 * * * *')
  async handleFlush(): Promise<void> {
    const buffer = this.drainBuffer();
    if (buffer.size === 0) return;

    try {
      await this.postsRepository.bulkIncrementViews(buffer);
      this.logger.log(
        `Flushed ${buffer.size} view buffers (${[...buffer.values()].reduce((a, b) => a + b, 0)} total views)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to flush ${buffer.size} view buffers`,
        error instanceof Error ? error.stack : String(error),
      );
      // Views are lost — acceptable for analytics data.
      // Next cycle will capture new views.
    }
  }
}
