import { eq, sql } from 'drizzle-orm';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  cities,
  users,
  posts,
  rescuePosts,
  lostPosts,
  productPosts,
  matingPosts,
  postUpvotes,
  postSaves,
  comments,
  contactRequests,
  blocks,
  notifications,
  pushDeliveries,
  deviceRegistrations,
  postCompletionNotificationEvents,
  postCompletionRecipients,
  type User,
  type City,
  type Post,
} from '../database/schema';
import { PostsRepository } from '../posts/posts.repository';
import { PostCompletionNotificationRepository } from './post-completion-notification.repository';
import { PostCompletionNotificationProcessor } from './post-completion-notification.processor';
import { PushDeliveryRepository } from './push-delivery.repository';
import { PushDeliveryProcessor } from './push-delivery.processor';
import type { PushDeliveryMessage, PushProvider } from './push.provider';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

describe('Post Completion Notifications Integration (Ticket 03)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let postsRepo: PostsRepository;
  let postCompletionRepo: PostCompletionNotificationRepository;
  let processor: PostCompletionNotificationProcessor;
  let pushDeliveryRepo: PushDeliveryRepository;
  let isolationPolicy: AccountIsolationPolicy;
  let defaultCity: City;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
    pushDeliveryRepo = new PushDeliveryRepository(dbHelper.db);
    postCompletionRepo = new PostCompletionNotificationRepository(dbHelper.db, pushDeliveryRepo);
    isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    processor = new PostCompletionNotificationProcessor(
      dbHelper.db,
      postCompletionRepo,
      isolationPolicy,
      pushDeliveryRepo,
    );
    postsRepo = new PostsRepository(dbHelper.db, undefined, isolationPolicy, pushDeliveryRepo, postCompletionRepo);
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    defaultCity = city;
  });

  async function createUser(overrides: Partial<typeof users.$inferInsert> & { name?: string } = {}): Promise<User> {
    const { name, ...rest } = overrides;
    const id = generateUuidV7();
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        id,
        firebaseUserId: `firebase_${id}`,
        email: `${id}@example.com`,
        fullName: name ?? `User_${id.substring(0, 6)}`,
        notificationsEnabled: true,
        isBanned: false,
        ...rest,
      })
      .returning();
    return user;
  }

  async function createRescuePost(creatorId: string, title = 'Injured Stray Dog'): Promise<Post> {
    const postId = generateUuidV7();
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: postId,
        creatorId,
        title,
        description: 'Needs immediate medical attention',
        postType: 'RESCUE',
        cityId: defaultCity.id,
        status: 'ACTIVE',
        urgency: 'MODERATE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    await dbHelper.db.insert(rescuePosts).values({
      postId: post.id,
      species: 'DOG',
      conditionSummary: 'Broken leg, needs vet care',
      reporterRole: 'REPORTING',
      isLifeThreatening: false,
      hasVisibleSeriousInjury: true,
      isInDangerousLocation: false,
      canAnimalMoveOrEscape: true,
    });

    return post;
  }

  async function createLostPost(
    creatorId: string,
    reportType: 'LOST_PET' | 'FOUND_STRAY' = 'LOST_PET',
    title = 'Missing Golden Retriever',
  ): Promise<Post> {
    const postId = generateUuidV7();
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: postId,
        creatorId,
        title,
        description: 'Lost near the market yesterday',
        postType: 'LOST',
        cityId: defaultCity.id,
        status: 'ACTIVE',
        urgency: 'URGENT',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    if (reportType === 'LOST_PET') {
      await dbHelper.db.insert(lostPosts).values({
        postId: post.id,
        reportType: 'LOST_PET',
        species: 'DOG',
        petName: 'Rex',
        dateLastSeen: '2026-08-20',
      });
    } else {
      await dbHelper.db.insert(lostPosts).values({
        postId: post.id,
        reportType: 'FOUND_STRAY',
        species: 'DOG',
        currentCondition: 'HEALTHY',
        isCurrentlySafeWithReporter: true,
        dateFound: '2026-08-20',
      });
    }
    return post;
  }

  async function createProductPost(creatorId: string, title = 'Dog Carrier'): Promise<Post> {
    const postId = generateUuidV7();
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: postId,
        creatorId,
        title,
        description: 'Brand new dog carrier',
        postType: 'PRODUCT',
        cityId: defaultCity.id,
        status: 'ACTIVE',
        marketCategory: 'ACCESSORIES',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    await dbHelper.db.insert(productPosts).values({
      postId: post.id,
      category: 'ACCESSORIES',
      condition: 'NEW',
      isFree: true,
    });
    return post;
  }

  async function createMatingPost(creatorId: string, title = 'Husky Mating Partner'): Promise<Post> {
    const postId = generateUuidV7();
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: postId,
        creatorId,
        title,
        description: 'Looking for a compatible female husky',
        postType: 'MATING',
        cityId: defaultCity.id,
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    await dbHelper.db.insert(matingPosts).values({
      postId: post.id,
      petName: 'Rocky',
      species: 'DOG',
      breed: 'Siberian Husky',
      gender: 'MALE',
      ageValue: 3,
      ageUnit: 'YEARS',
    });
    return post;
  }

  describe('Audience Capture on Owner Closure', () => {
    it('captures a stable closure-time audience snapshot excluding creator and deleted contributions', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);

      const booster = await createUser({ name: 'Booster' });
      const saver = await createUser({ name: 'Saver' });
      const commenter = await createUser({ name: 'Commenter' });
      const requester = await createUser({ name: 'Requester' });
      const deletedCommenter = await createUser({ name: 'DeletedCommenter' });

      // Add upvote
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: booster.id });
      // Add save
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: saver.id });
      // Add active comment
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: commenter.id,
        text: 'I can help transport!',
        status: 'ACTIVE',
      });
      // Add deleted comment (should be excluded)
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: deletedCommenter.id,
        text: 'Nevermind',
        status: 'DELETED',
      });
      // Add contact request
      await dbHelper.db.insert(contactRequests).values({
        id: generateUuidV7(),
        postId: post.id,
        requesterId: requester.id,
        message: 'Can I adopt or foster?',
        status: 'PENDING',
      });

      // Owner closes rescue as RESOLVED
      const updatedPost = await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');
      expect(updatedPost?.status).toBe('RESOLVED');

      // Check event
      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.postType).toBe('RESCUE');
      expect(event.type).toBe('RESCUE_COMPLETED');
      expect(event.outcome).toBe('RESOLVED');
      expect(event.closingActorId).toBe(owner.id);
      expect(event.status).toBe('PENDING');
      expect(event.totalRecipients).toBe(4);
      expect(event.body).toContain(post.title);
      expect(event.bodyArabic).toContain(post.title);

      // Check recipients
      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.eventId, event.id));

      expect(recipients).toHaveLength(4);
      const recipientIds = recipients.map((r) => r.recipientId);
      expect(recipientIds).toContain(booster.id);
      expect(recipientIds).toContain(saver.id);
      expect(recipientIds).toContain(commenter.id);
      expect(recipientIds).toContain(requester.id);
      expect(recipientIds).not.toContain(owner.id);
      expect(recipientIds).not.toContain(deletedCommenter.id);

      // Verify all recipient statuses are PENDING
      for (const r of recipients) {
        expect(r.status).toBe('PENDING');
      }
    });

    it('deduplicates participants across multiple interaction types', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);

      const activeUser = await createUser({ name: 'ActiveUser' });

      // User upvoted, saved, commented, AND requested contact
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: activeUser.id });
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: activeUser.id });
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: activeUser.id,
        text: 'I want to help!',
        status: 'ACTIVE',
      });
      await dbHelper.db.insert(contactRequests).values({
        id: generateUuidV7(),
        postId: post.id,
        requesterId: activeUser.id,
        message: 'Direct contact request',
        status: 'APPROVED',
      });

      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id));

      expect(recipients).toHaveLength(1);
      expect(recipients[0].recipientId).toBe(activeUser.id);
    });

    it('completes an event with an empty audience and leaves nothing for the worker', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);

      // Nobody interacted with the rescue, so the captured audience is empty.
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(events).toHaveLength(1);
      expect(events[0].totalRecipients).toBe(0);
      expect(events[0].status).toBe('COMPLETED');

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);
      expect(batchRes.batchesProcessed).toBe(0);

      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id));
      expect(recipients).toHaveLength(0);
    });
  });

  describe('Bounded Batch Delivery (>500 recipients supported)', () => {
    it('processes >500 recipients in restartable bounded batches without an arbitrary cap', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);

      // Create 550 users and upvotes
      const count = 550;
      const userValues = [];
      const upvoteValues = [];
      const userIds: string[] = [];

      for (let i = 0; i < count; i++) {
        const id = generateUuidV7();
        userIds.push(id);
        userValues.push({
          id,
          firebaseUserId: `firebase_${id}`,
          email: `${id}@example.com`,
          fullName: `User_${i}`,
          notificationsEnabled: true,
          isBanned: false,
        });
        upvoteValues.push({
          postId: post.id,
          userId: id,
        });
      }

      // Batch insert users and upvotes
      for (let i = 0; i < userValues.length; i += 100) {
        await dbHelper.db.insert(users).values(userValues.slice(i, i + 100));
        await dbHelper.db.insert(postUpvotes).values(upvoteValues.slice(i, i + 100));
      }

      // Owner closes rescue
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));

      expect(events[0].totalRecipients).toBe(550);

      // Process in batches of 100
      let totalDelivered = 0;
      let iterations = 0;
      while (totalDelivered < count && iterations < 15) {
        const batchRes = await processor.processPendingBatches({ batchSize: 100 });
        totalDelivered += batchRes.delivered;
        iterations++;
        if (batchRes.batchesProcessed === 0) break;
      }

      expect(totalDelivered).toBe(550);

      // Verify all recipients are DELIVERED
      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id));

      expect(recipients).toHaveLength(550);
      for (const r of recipients) {
        expect(r.status).toBe('DELIVERED');
        expect(r.notificationId).toBeDefined();
      }

      // Verify 550 inbox notifications exist with relatedPostId matching post.id
      const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.relatedPostId, post.id));

      expect(notifs).toHaveLength(550);
      for (const n of notifs) {
        expect(n.type).toBe('RESCUE_COMPLETED');
        expect(n.body).toContain(post.title);
      }

      // Verify event is COMPLETED
      const [updatedEvent] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.id, events[0].id));
      expect(updatedEvent.status).toBe('COMPLETED');
    });

    it('recovers interrupted batches whose lease has expired', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);
      const recipientUser = await createUser({ name: 'Recipient' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: recipientUser.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      // Simulate an interrupted worker: recipient is left in PROCESSING with an expired lease
      await dbHelper.db.execute(sql`
        UPDATE post_completion_recipients
        SET status = 'PROCESSING',
            lease_token = ${generateUuidV7()}::uuid,
            lease_expires_at = now() - interval '10 seconds'
        WHERE post_id = ${post.id}::uuid
      `);

      // Processor should claim and recover the expired leased recipient
      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id));

      expect(recipient.status).toBe('DELIVERED');
    });

    it('rolls back a failed delivery attempt and retries it without duplicating the inbox notification', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);
      const recipientUser = await createUser({ name: 'RetryRecipient' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: recipientUser.id,
        token: 'token_retry_recipient',
        platform: 'ANDROID',
      });
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: recipientUser.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      // Fault injection: fail the first enqueue inside the delivery transaction,
      // after the inbox row insert, then delegate to the real outbox. The plain
      // Error carries no retryable SQLSTATE, so withDbRetry rethrows it at once
      // and the failure reaches the processor's requeue path deterministically.
      let enqueueAttempts = 0;
      const flakyPushRepo = {
        enqueueForNotification: async (...args: Parameters<PushDeliveryRepository['enqueueForNotification']>) => {
          enqueueAttempts++;
          if (enqueueAttempts === 1) throw new Error('injected push enqueue failure');
          return pushDeliveryRepo.enqueueForNotification(...args);
        },
      } as unknown as PushDeliveryRepository;

      const faultProcessor = new PostCompletionNotificationProcessor(
        dbHelper.db,
        postCompletionRepo,
        isolationPolicy,
        flakyPushRepo,
      );

      const failedPass = await faultProcessor.processPendingBatches({ batchSize: 10 });
      expect(failedPass.delivered).toBe(0);
      expect(failedPass.failed).toBe(1);

      // The delivery transaction rolled back: the inbox row and push intent it
      // had written are gone, so a retry cannot produce a duplicate.
      const notifsAfterFailure = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, recipientUser.id));
      expect(notifsAfterFailure).toHaveLength(0);

      const pushesAfterFailure = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.recipientId, recipientUser.id));
      expect(pushesAfterFailure).toHaveLength(0);

      const [failedRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, recipientUser.id));
      expect(failedRecipient.status).toBe('PENDING');
      expect(failedRecipient.notificationId).toBeNull();
      expect(failedRecipient.attempts).toBe(1);
      expect(failedRecipient.lastError).toContain('injected push enqueue failure');
      // The requeue path scheduled a backoff instead of leaving the recipient
      // immediately claimable.
      expect(failedRecipient.nextAttemptAt.getTime()).toBeGreaterThan(failedRecipient.updatedAt.getTime());

      // Expire the recorded backoff explicitly instead of sleeping, so the
      // retry pass is deterministic and clock-skew independent.
      await dbHelper.db.execute(sql`
        UPDATE post_completion_recipients
        SET next_attempt_at = now() - interval '1 second'
        WHERE id = ${failedRecipient.id}::uuid
      `);
      const retryPass = await faultProcessor.processPendingBatches({ batchSize: 10 });
      expect(retryPass.delivered).toBe(1);
      expect(enqueueAttempts).toBe(2);

      const notifsAfterRetry = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, recipientUser.id));
      expect(notifsAfterRetry).toHaveLength(1);

      const pushesAfterRetry = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.recipientId, recipientUser.id));
      expect(pushesAfterRetry).toHaveLength(1);
      expect(pushesAfterRetry[0].notificationId).toBe(notifsAfterRetry[0].id);

      const [deliveredRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, recipientUser.id));
      expect(deliveredRecipient.status).toBe('DELIVERED');
      expect(deliveredRecipient.notificationId).toBe(notifsAfterRetry[0].id);
      expect(deliveredRecipient.lastError).toBeNull();
    });
  });

  describe('Recheck Account Availability, Blocks, and Push Preferences', () => {
    it('cancels delivery if recipient account is banned at delivery time', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);
      const bannedUser = await createUser({ name: 'BannedUser', isBanned: false });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: bannedUser.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      // Ban the user right before delivery
      await dbHelper.db.update(users).set({ isBanned: true }).where(eq(users.id, bannedUser.id));

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, bannedUser.id));

      expect(recipient.status).toBe('CANCELLED');

      // No notification should be inserted
      const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, bannedUser.id));
      expect(notifs).toHaveLength(0);
    });

    it('suppresses delivery if an active block exists between actor and recipient', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);
      const blockedUser = await createUser({ name: 'BlockedUser' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: blockedUser.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      // Create block between owner and blockedUser
      await dbHelper.db.insert(blocks).values({
        blockerId: blockedUser.id,
        blockedId: owner.id,
      });

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, blockedUser.id));

      expect(recipient.status).toBe('BLOCKED');

      const notifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, blockedUser.id));
      expect(notifs).toHaveLength(0);
    });

    it('delivers inbox notification but suppresses push when user has disabled notifications', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);
      const user = await createUser({ name: 'NoPushUser', notificationsEnabled: false });

      // Register device for the user
      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: user.id,
        token: 'token_123',
        platform: 'ANDROID',
      });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: user.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      // Inbox notification delivered
      const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, user.id));
      expect(notifs).toHaveLength(1);

      // Push deliveries NOT enqueued
      const pushes = await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, user.id));
      expect(pushes).toHaveLength(0);
    });

    it('enqueues push when notifications are enabled for the recipient', async () => {
      const owner = await createUser({ name: 'Owner' });
      const post = await createRescuePost(owner.id);
      const user = await createUser({ name: 'PushUser', notificationsEnabled: true });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: user.id,
        token: 'token_push_enabled',
        platform: 'IOS',
      });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: user.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      await processor.processPendingBatches({ batchSize: 10 });

      const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, user.id));
      expect(notifs).toHaveLength(1);

      const pushes = await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, user.id));
      expect(pushes).toHaveLength(1);
      expect(pushes[0].notificationId).toBe(notifs[0].id);
    });
  });

  describe('Administrative Resolution and Reopening Corrections', () => {
    it('captures audience without notifying creator twice, and handles reopening corrections', async () => {
      const creator = await createUser({ name: 'Creator' });
      const admin = await createUser({ name: 'Admin' });
      const post = await createRescuePost(creator.id, 'Injured Cat');

      const participantA = await createUser({ name: 'ParticipantA' });
      const participantB = await createUser({ name: 'ParticipantB' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participantA.id });
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: participantB.id });

      // Admin resolves post
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'RESOLVED' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.captureCompletionEvent(tx, {
          postId: post.id,
          postType: 'RESCUE',
          outcome: 'RESOLVED',
          closingActorId: admin.id,
          title: post.title,
          creatorId: creator.id,
        });
      });

      // Check event and recipients
      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(events).toHaveLength(1);
      expect(events[0].totalRecipients).toBe(2);

      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id));
      const recipientIds = recipients.map((r) => r.recipientId);
      expect(recipientIds).toContain(participantA.id);
      expect(recipientIds).toContain(participantB.id);
      expect(recipientIds).not.toContain(creator.id);
      expect(recipientIds).not.toContain(admin.id);

      // Deliver only one participant (leave the other PENDING)
      const deliveryBatch = await processor.processPendingBatches({ maxBatches: 1, batchSize: 1 });
      expect(deliveryBatch.delivered).toBe(1);

      const [claimedRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.status, 'DELIVERED'));
      expect(claimedRecipient).toBeDefined();

      // Now Administrator reopens the post
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, {
          postId: post.id,
          postTitle: post.title,
        });
      });

      // 1. Check that event was SUPERSEDED
      const [reopenedEvent] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.id, events[0].id));
      expect(reopenedEvent.status).toBe('SUPERSEDED');

      // 2. Check that pending recipient (participantB) was SUPPRESSED
      const otherRecipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(
          sql`${postCompletionRecipients.postId} = ${post.id}::uuid AND ${postCompletionRecipients.id} <> ${claimedRecipient.id}::uuid`,
        );
      expect(otherRecipients[0].status).toBe('SUPPRESSED');

      // 3. Check that delivered recipient (participantA) was marked CORRECTED
      const [recipACorrected] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.id, claimedRecipient.id));
      expect(recipACorrected.status).toBe('CORRECTED');

      // 4. Check that participantA received RESCUE_REOPENED notification
      const participantANotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, claimedRecipient.recipientId));

      expect(participantANotifs).toHaveLength(2); // 1 RESCUE_COMPLETED, 1 RESCUE_REOPENED
      const correctionNotif = participantANotifs.find((n) => n.type === 'RESCUE_REOPENED');
      expect(correctionNotif).toBeDefined();
      expect(correctionNotif?.relatedPostId).toBe(post.id);
      expect(correctionNotif?.body).toContain(post.title);
      expect(correctionNotif?.bodyArabic).toContain(post.title);
      // Ensure no internal admin reasons exposed
      expect(correctionNotif?.body).not.toContain('admin');
      expect(correctionNotif?.bodyArabic).not.toContain('admin');

      // 5. Check that participantB received NO notifications
      const participantBNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, otherRecipients[0].recipientId));
      expect(participantBNotifs).toHaveLength(0);

      // 6. Running batch processor now does nothing
      const postReopenBatchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(postReopenBatchRes.batchesProcessed).toBe(0);
      expect(postReopenBatchRes.delivered).toBe(0);
    });

    it('handles multiple close-reopen-close cycles cleanly without duplicate notifications', async () => {
      const creator = await createUser({ name: 'Creator2' });
      const post = await createRescuePost(creator.id, 'Rescue Cycle Dog');
      const participant = await createUser({ name: 'ParticipantCycle' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      // Cycle 1: Close
      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');
      let batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      // Cycle 1: Reopen
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      // Reopening again should be idempotent (no duplicate correction)
      await dbHelper.db.transaction(async (tx) => {
        const res = await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
        expect(res.correctedCount).toBe(0);
      });

      // Cycle 2: Close again
      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');
      batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      // Check total notifications for participant:
      // 1st RESCUE_COMPLETED + 1st RESCUE_REOPENED + 2nd RESCUE_COMPLETED = 3
      const notifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(notifs).toHaveLength(3);
      expect(notifs.filter((n) => n.type === 'RESCUE_COMPLETED')).toHaveLength(2);
      expect(notifs.filter((n) => n.type === 'RESCUE_REOPENED')).toHaveLength(1);
    });
  });

  describe('Ticket 04: Other Post Completion Notifications (Lost/Found, Product, Mating)', () => {
    it('notifies closure-time participants when a LOST_PET post is closed as REUNITED', async () => {
      const creator = await createUser({ name: 'LostPetOwner' });
      const post = await createLostPost(creator.id, 'LOST_PET', 'Lost Golden Dog');
      const booster = await createUser({ name: 'LostBooster' });
      const commenter = await createUser({ name: 'LostCommenter' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: booster.id });
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: commenter.id,
        text: 'I think I saw this dog!',
        status: 'ACTIVE',
      });

      const updated = await postsRepo.updateStatus(post.id, creator.id, 'REUNITED');
      expect(updated?.status).toBe('REUNITED');

      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.postType).toBe('LOST');
      expect(event.type).toBe('POST_COMPLETED');
      expect(event.outcome).toBe('REUNITED');
      expect(event.title).toBe('Pet reunited');
      expect(event.body).toBe('The post "Lost Golden Dog" was marked as reunited.');
      expect(event.titleArabic).toBe('تم لمّ الشمل');
      expect(event.bodyArabic).toContain('Lost Golden Dog');
      expect(event.totalRecipients).toBe(2);

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(2);

      for (const recipient of [booster, commenter]) {
        const notifs = await dbHelper.db
          .select()
          .from(notifications)
          .where(eq(notifications.recipientId, recipient.id));
        expect(notifs).toHaveLength(1);
        expect(notifs[0].type).toBe('POST_COMPLETED');
        expect(notifs[0].title).toBe('Pet reunited');
        expect(notifs[0].relatedPostId).toBe(post.id);
      }
    });

    it('notifies participants when a FOUND_STRAY post is closed as RESOLVED or REUNITED', async () => {
      for (const [outcome, expectedTitle] of [
        ['RESOLVED', 'Post resolved'],
        ['REUNITED', 'Pet reunited'],
      ] as const) {
        const creator = await createUser({ name: `FoundOwner_${outcome}` });
        const post = await createLostPost(creator.id, 'FOUND_STRAY', `Found Stray ${outcome}`);
        const saver = await createUser({ name: `FoundSaver_${outcome}` });

        await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: saver.id });

        const updated = await postsRepo.updateStatus(post.id, creator.id, outcome);
        expect(updated?.status).toBe(outcome);

        const [event] = await dbHelper.db
          .select()
          .from(postCompletionNotificationEvents)
          .where(eq(postCompletionNotificationEvents.postId, post.id));
        expect(event.postType).toBe('LOST');
        expect(event.type).toBe('POST_COMPLETED');
        expect(event.outcome).toBe(outcome);
        expect(event.title).toBe(expectedTitle);
        expect(event.totalRecipients).toBe(1);

        const batchRes = await processor.processPendingBatches({ batchSize: 10 });
        expect(batchRes.delivered).toBe(1);

        const [notif] = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, saver.id));
        expect(notif.type).toBe('POST_COMPLETED');
        expect(notif.title).toBe(expectedTitle);
        expect(notif.relatedPostId).toBe(post.id);
      }
    });

    it('notifies participants when a PRODUCT post is closed as SOLD and corrects them on reopening', async () => {
      const seller = await createUser({ name: 'Seller' });
      const post = await createProductPost(seller.id, 'Dog Crate Small');
      const buyer = await createUser({ name: 'Buyer' });

      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: buyer.id });

      await postsRepo.updateStatus(post.id, seller.id, 'SOLD');

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event.postType).toBe('PRODUCT');
      expect(event.type).toBe('POST_COMPLETED');
      expect(event.outcome).toBe('SOLD');
      expect(event.title).toBe('Item sold');
      expect(event.body).toBe('The post "Dog Crate Small" was marked as sold.');
      expect(event.totalRecipients).toBe(1);

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      // Administrator reopening correction through the shared repository
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      // The fully delivered event stays COMPLETED; its delivered recipients are
      // corrected rather than superseded, and it holds no pending delivery.
      const [reopenedEvent] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.id, event.id));
      expect(reopenedEvent.status).toBe('COMPLETED');

      const buyerNotifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, buyer.id));
      expect(buyerNotifs).toHaveLength(2);
      const correction = buyerNotifs.find((n) => n.type === 'POST_REOPENED');
      expect(correction).toBeDefined();
      expect(correction?.title).toBe('Post reopened');
      expect(correction?.body).toContain('Dog Crate Small');
      expect(correction?.relatedPostId).toBe(post.id);
    });

    it('suppresses a stale non-rescue completion delivery when the outcome is corrected first', async () => {
      const seller = await createUser({ name: 'StaleSeller' });
      const post = await createProductPost(seller.id, 'Stale Product');
      const buyer = await createUser({ name: 'StaleBuyer' });

      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: buyer.id });
      await postsRepo.updateStatus(post.id, seller.id, 'SOLD');

      // Reopening commits before the worker delivers the queued audience.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);
      expect(batchRes.batchesProcessed).toBe(0);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, buyer.id));
      expect(recipient.status).toBe('SUPPRESSED');

      const buyerNotifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, buyer.id));
      expect(buyerNotifs).toHaveLength(0);
    });

    it('notifies participants when a MATING post is closed as RESOLVED', async () => {
      const creator = await createUser({ name: 'MatingOwner' });
      const post = await createMatingPost(creator.id, 'Husky Partner Search');
      const participant = await createUser({ name: 'MatingParticipant' });

      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: participant.id,
        text: 'I have a compatible husky!',
        status: 'ACTIVE',
      });

      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event.postType).toBe('MATING');
      expect(event.type).toBe('POST_COMPLETED');
      expect(event.outcome).toBe('RESOLVED');
      expect(event.title).toBe('Post resolved');
      expect(event.body).toBe('The post "Husky Partner Search" was marked as resolved.');
      expect(event.totalRecipients).toBe(1);

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      const [notif] = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(notif.type).toBe('POST_COMPLETED');
      expect(notif.title).toBe('Post resolved');
      expect(notif.relatedPostId).toBe(post.id);
    });

    it('suppresses delivery when the recipient is isolated from the post creator even when an administrator closed it', async () => {
      const creator = await createUser({ name: 'IsolatedCreator' });
      const admin = await createUser({ name: 'IsolatingAdmin' });
      const post = await createProductPost(creator.id, 'Isolated Product');
      const buyer = await createUser({ name: 'IsolatedBuyer' });

      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: buyer.id });

      // Administrator records the outcome, so the closing actor is not the creator.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'SOLD' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.captureCompletionEvent(tx, {
          postId: post.id,
          postType: 'PRODUCT',
          outcome: 'SOLD',
          closingActorId: admin.id,
          title: post.title,
          creatorId: creator.id,
        });
      });

      // The creator blocks the buyer after the outcome was recorded.
      await dbHelper.db.insert(blocks).values({ blockerId: creator.id, blockedId: buyer.id });

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);
      expect(batchRes.suppressed).toBe(1);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, buyer.id));
      expect(recipient.status).toBe('BLOCKED');

      const buyerNotifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, buyer.id));
      expect(buyerNotifs).toHaveLength(0);
    });

    it('rechecks creator isolation when sending a push for an administrator-closed post', async () => {
      const creator = await createUser({ name: 'AdminCloseCreator' });
      const post = await createProductPost(creator.id, 'Admin Closed Product');
      const buyer = await createUser({ name: 'AdminCloseBuyer' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: buyer.id,
        token: 'token_admin_closure_push',
        platform: 'ANDROID',
      });
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: buyer.id });

      // Administrator closure records no app-user closing actor, exactly like
      // the AdminJS boundary.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'SOLD' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.captureCompletionEvent(tx, {
          postId: post.id,
          postType: 'PRODUCT',
          outcome: 'SOLD',
          closingActorId: null,
          title: post.title,
          creatorId: creator.id,
        });
      });

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      const [pushIntent] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.recipientId, buyer.id));
      expect(pushIntent).toBeDefined();
      expect(pushIntent.actorId).toBe(creator.id);

      // A Block committed after the inbox row is queued but before the push is
      // sent must terminate the push while the inbox row survives.
      await dbHelper.db.insert(blocks).values({ blockerId: creator.id, blockedId: buyer.id });

      const sentMessages: PushDeliveryMessage[] = [];
      const provider: PushProvider = {
        send: (message) => {
          sentMessages.push(message);
          return Promise.resolve();
        },
      };
      const pushProcessor = new PushDeliveryProcessor(dbHelper.db, provider, isolationPolicy);

      expect(await pushProcessor.processPendingDeliveries()).toBe(0);
      expect(sentMessages).toHaveLength(0);

      const [suppressedIntent] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.id, pushIntent.id));
      expect(suppressedIntent.status).toBe('SUPPRESSED');

      const buyerNotifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, buyer.id));
      expect(buyerNotifs).toHaveLength(1);
    });

    it('does not emit a completion event when the owner removes the post', async () => {
      const creator = await createUser({ name: 'DeleteOwner' });
      const post = await createLostPost(creator.id, 'LOST_PET', 'Cat To Delete');
      const participant = await createUser({ name: 'DeleteParticipant' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      const removed = await postsRepo.softDelete(post.id, creator.id);
      expect(removed?.status).toBe('REMOVED');

      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(events).toHaveLength(0);

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);

      const notifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(notifs).toHaveLength(0);
    });
  });
});
