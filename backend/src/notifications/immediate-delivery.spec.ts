import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { PushDeliveryProcessor } from './push-delivery.processor';
import { DiscussionNotificationProcessor } from './discussion-notification.processor';
import type { PushProvider } from './push.provider';

jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

const RECIPIENT = '01916327-0000-7000-8000-000000000001';
const ACTOR = '01916327-0000-7000-8000-000000000009';

/** Lets fire-and-forget promise chains settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('immediate notification delivery', () => {
  describe('NotificationsService.fireNotification', () => {
    let repo: { createIfNotIsolated: jest.Mock };
    let push: { requestImmediateRun: jest.Mock };
    let service: NotificationsService;

    beforeEach(() => {
      repo = { createIfNotIsolated: jest.fn().mockResolvedValue({ id: 'n1' }) };
      push = { requestImmediateRun: jest.fn() };
      service = new NotificationsService(
        repo as unknown as NotificationsRepository,
        push as unknown as PushDeliveryProcessor,
      );
    });

    it('starts push delivery as soon as a push-enabled notification commits', async () => {
      service.fireNotification({ recipientId: RECIPIENT, type: 'NEW_UPVOTE', title: 't', body: 'b' }, ACTOR);
      expect(push.requestImmediateRun).not.toHaveBeenCalled();
      await flush();
      expect(push.requestImmediateRun).toHaveBeenCalledTimes(1);
    });

    it('does not start push delivery for an inbox-only type', async () => {
      service.fireNotification({ recipientId: RECIPIENT, type: 'SYSTEM_ANNOUNCEMENT', title: 't', body: 'b' }, ACTOR);
      await flush();
      expect(push.requestImmediateRun).not.toHaveBeenCalled();
    });

    it('does not start push delivery when persisting fails', async () => {
      repo.createIfNotIsolated.mockRejectedValue(new Error('db down'));
      service.fireNotification({ recipientId: RECIPIENT, type: 'NEW_UPVOTE', title: 't', body: 'b' }, ACTOR);
      await flush();
      expect(push.requestImmediateRun).not.toHaveBeenCalled();
    });

    it('still works without a push worker (tests and scripts)', async () => {
      const bare = new NotificationsService(repo as unknown as NotificationsRepository);
      bare.fireNotification({ recipientId: RECIPIENT, type: 'NEW_UPVOTE', title: 't', body: 'b' }, ACTOR);
      await flush();
      expect(repo.createIfNotIsolated).toHaveBeenCalledTimes(1);
    });
  });

  describe('PushDeliveryProcessor.requestImmediateRun', () => {
    function processorWithQueue() {
      const provider: PushProvider = { send: jest.fn() };
      const processor = new PushDeliveryProcessor({} as never, provider, {} as never);
      const claims: Array<() => void> = [];
      // Each drain claims once and blocks until the test releases it.
      const claimNextDelivery = jest.fn(
        () => new Promise<undefined>((resolve) => claims.push(() => resolve(undefined))),
      );
      Object.assign(processor, { claimNextDelivery });
      return { processor, claims, claimNextDelivery };
    }

    it('starts a drain immediately', () => {
      const { processor, claimNextDelivery } = processorWithQueue();
      processor.requestImmediateRun();
      expect(claimNextDelivery).toHaveBeenCalledTimes(1);
    });

    it('coalesces requests during a drain into exactly one follow-up drain', async () => {
      const { processor, claims, claimNextDelivery } = processorWithQueue();
      processor.requestImmediateRun();
      processor.requestImmediateRun();
      processor.requestImmediateRun();
      expect(claimNextDelivery).toHaveBeenCalledTimes(1);

      claims.shift()!();
      await flush();
      expect(claimNextDelivery).toHaveBeenCalledTimes(2);

      claims.shift()!();
      await flush();
      expect(claimNextDelivery).toHaveBeenCalledTimes(2);
    });

    it('follows a cron-started drain that was already running', async () => {
      const { processor, claims, claimNextDelivery } = processorWithQueue();
      const cronRun = processor.processPendingDeliveries();
      processor.requestImmediateRun();
      expect(claimNextDelivery).toHaveBeenCalledTimes(1);

      claims.shift()!();
      await cronRun;
      await flush();
      expect(claimNextDelivery).toHaveBeenCalledTimes(2);
      claims.shift()!();
      await flush();
    });
  });

  describe('DiscussionNotificationProcessor', () => {
    it('hands newly written inbox rows to the push worker straight away', async () => {
      const push = { requestImmediateRun: jest.fn() };
      const processor = new DiscussionNotificationProcessor(
        {} as never,
        {} as never,
        {} as never,
        push as unknown as PushDeliveryProcessor,
      );
      const events = [{ id: 'e1' }];
      Object.assign(processor, {
        claimNextEvent: jest.fn(() => Promise.resolve(events.shift())),
        deliverClaimedEvent: jest.fn(() => Promise.resolve(true)),
      });

      processor.requestImmediateRun();
      await flush();
      expect(push.requestImmediateRun).toHaveBeenCalledTimes(1);
    });

    it('does not wake the push worker when nothing was delivered', async () => {
      const push = { requestImmediateRun: jest.fn() };
      const processor = new DiscussionNotificationProcessor(
        {} as never,
        {} as never,
        {} as never,
        push as unknown as PushDeliveryProcessor,
      );
      Object.assign(processor, { claimNextEvent: jest.fn(() => Promise.resolve(undefined)) });

      await processor.processPendingEvents();
      expect(push.requestImmediateRun).not.toHaveBeenCalled();
    });
  });
});
