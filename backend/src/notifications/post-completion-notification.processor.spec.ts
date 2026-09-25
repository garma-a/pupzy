import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import * as schema from '../database/schema';
import {
  postCompletionNotificationEvents,
  postCompletionRecipients,
  posts,
  users,
  type PostCompletionNotificationEvent,
  type PostCompletionRecipient,
} from '../database/schema';
import type { PushDeliveryRepository } from './push-delivery.repository';
import { PostCompletionNotificationProcessor } from './post-completion-notification.processor';
import type {
  ClaimedRecipientWithEvent,
  PostCompletionNotificationRepository,
} from './post-completion-notification.repository';

interface SelectChain extends PromiseLike<unknown[]> {
  from(table: unknown): SelectChain;
  where(condition: unknown): SelectChain;
  limit(count?: number): SelectChain;
  for(mode: string): SelectChain;
}

interface FakeTransaction {
  select(fields?: Record<string, unknown>): SelectChain;
  insert(table: unknown): { values(values: unknown): { returning(selection: unknown): Promise<unknown[]> } };
  update(table: unknown): { set(values: unknown): { where(condition: unknown): Promise<undefined> } };
  execute(query: unknown): Promise<{ rows: unknown[]; rowCount: number }>;
}

interface FakeProcessorHarness {
  processor: PostCompletionNotificationProcessor;
  sequence: string[];
  lockPairs: jest.Mock;
  lockPairAndRecheck: jest.Mock;
  enqueueForNotification: jest.Mock;
  creatorId: string;
  recipientId: string;
}

/**
 * ADR 0006 requires cross-account operations to acquire canonical account-pair
 * locks before existing Post/discussion row locks. This focused unit spec uses
 * a fake transaction executor and isolation policy that record the sequence of
 * lock operations, so the delivery path can be asserted to take the pair locks
 * before the Post row lock without depending on real advisory-lock timing.
 */
function createHarness(): FakeProcessorHarness {
  const sequence: string[] = [];

  const creatorId = '01916327-0000-7000-8000-000000000001';
  const recipientId = '01916327-0000-7000-8000-000000000002';
  const leaseToken = '01916327-0000-7000-8000-000000000003';

  const recipient = {
    id: '01916327-0000-7000-8000-000000000004',
    recipientId,
    leaseToken,
    status: 'PROCESSING',
    attempts: 1,
  } as unknown as PostCompletionRecipient;

  const event = {
    id: '01916327-0000-7000-8000-000000000005',
    postId: '01916327-0000-7000-8000-000000000006',
    outcome: 'RESOLVED',
    type: 'RESCUE_COMPLETED',
    closingActorId: null,
    status: 'PENDING',
  } as unknown as PostCompletionNotificationEvent;

  const item: ClaimedRecipientWithEvent = { recipient, event };

  const post = { id: event.postId, creatorId, status: 'RESOLVED' };
  const user = { id: recipientId, isBanned: false, notificationsEnabled: true };

  const rowsByTable = new Map<unknown, unknown[]>([
    [posts, [post]],
    [postCompletionRecipients, [recipient]],
    [postCompletionNotificationEvents, [event]],
    [users, [user]],
  ]);

  const tableLabel = (table: unknown): string => {
    if (table === posts) return 'posts';
    if (table === postCompletionRecipients) return 'post_completion_recipients';
    if (table === postCompletionNotificationEvents) return 'post_completion_notification_events';
    if (table === users) return 'users';
    return 'unknown';
  };

  const createSelect = (fields?: Record<string, unknown>): SelectChain => {
    let table: unknown;
    let rows: unknown[] = fields ? [{ creatorId }] : [];
    const chain = {
      from: (selected: unknown) => {
        table = selected;
        rows = fields ? [{ creatorId }] : (rowsByTable.get(selected) ?? []);
        return chain;
      },
      where: () => chain,
      limit: () => chain,
      for: (mode: string) => {
        sequence.push(`row-lock:${tableLabel(table)}:${mode}`);
        return chain;
      },
      then: <TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> => Promise.resolve(rows).then(onfulfilled, onrejected),
    } as unknown as SelectChain;
    return chain;
  };

  const tx: FakeTransaction = {
    select: (fields?: Record<string, unknown>) => createSelect(fields),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'notification-1', recipientId }]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(undefined),
      }),
    }),
    execute: () => Promise.resolve({ rows: [], rowCount: 0 }),
  };

  const db = {
    transaction: <T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> => callback(tx),
  } as unknown as NodePgDatabase<typeof schema>;

  const repository = {
    claimNextBatch: jest.fn().mockResolvedValueOnce([item]).mockResolvedValue([]),
    completeFinishedEvents: jest.fn().mockResolvedValue(undefined),
    recoverExpiredMaxAttemptLeases: jest.fn().mockResolvedValue(0),
  } as unknown as PostCompletionNotificationRepository;

  const lockPairs = jest.fn(() => {
    sequence.push('pair-locks');
  });
  const lockPairAndRecheck = jest.fn(() => {
    sequence.push('pair-locks');
    return false;
  });
  const isIsolated = jest.fn(() => false);
  const isolationPolicy = {
    lockPairs,
    lockPairAndRecheck,
    isIsolated,
  } as unknown as AccountIsolationPolicy;

  const enqueueForNotification = jest.fn().mockResolvedValue(1);
  const pushDeliveryRepository = { enqueueForNotification } as unknown as PushDeliveryRepository;

  const processor = new PostCompletionNotificationProcessor(db, repository, isolationPolicy, pushDeliveryRepository);

  return { processor, sequence, lockPairs, lockPairAndRecheck, enqueueForNotification, creatorId, recipientId };
}

describe('PostCompletionNotificationProcessor lock ordering (ADR 0006)', () => {
  it('acquires the account pair locks before the Post row lock during delivery', async () => {
    const harness = createHarness();

    const result = await harness.processor.processPendingBatches({ maxBatches: 1, batchSize: 1 });

    expect(result).toMatchObject({ batchesProcessed: 1, delivered: 1, suppressed: 0, failed: 0 });

    const pairLockIndex = harness.sequence.indexOf('pair-locks');
    const postRowLockIndex = harness.sequence.indexOf('row-lock:posts:update');
    expect(pairLockIndex).toBeGreaterThanOrEqual(0);
    expect(postRowLockIndex).toBeGreaterThanOrEqual(0);
    expect(pairLockIndex).toBeLessThan(postRowLockIndex);

    // Pair locks are acquired through the public multi-pair API, which orders
    // and dedupes canonically, never one-off after a row lock.
    expect(harness.lockPairAndRecheck).not.toHaveBeenCalled();
    expect(harness.lockPairs).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([[harness.creatorId, harness.recipientId]]),
    );
  });
});
