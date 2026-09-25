import { eq, sql } from 'drizzle-orm';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  cities,
  users,
  posts,
  rescuePosts,
  lostPosts,
  adoptionPosts,
  adoptionApplications,
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
import {
  MAX_COMPLETION_DELIVERY_ATTEMPTS,
  PostCompletionNotificationProcessor,
} from './post-completion-notification.processor';
import { PushDeliveryRepository } from './push-delivery.repository';
import { PushDeliveryProcessor } from './push-delivery.processor';
import type { PushDeliveryMessage, PushProvider } from './push.provider';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { withDbRetry } from '../common/utils/db-retry.util';
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

  async function createAdoptionPost(creatorId: string, title = 'Fluffy Cat For Adoption'): Promise<Post> {
    const postId = generateUuidV7();
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: postId,
        creatorId,
        title,
        description: 'Friendly cat needs a loving home',
        postType: 'ADOPTION',
        cityId: defaultCity.id,
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    await dbHelper.db.insert(adoptionPosts).values({
      postId: post.id,
      petName: 'Mochi',
      species: 'CAT',
      gender: 'FEMALE',
    });
    return post;
  }

  function adoptionApplicationValues(
    targetPostId: string,
    applicantId: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
  ) {
    return {
      id: generateUuidV7(),
      targetPostId,
      applicantId,
      status,
      livingSituation: 'APARTMENT' as const,
      hasOutdoorAccess: true,
      hasOtherPetsAtHome: false,
      hasChildrenAtHome: false,
      whyAdopt: 'A loving home for the animal',
    };
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

    it('captures the exact audience union across replies, rejected requesters, and hidden versus removed comments', async () => {
      const owner = await createUser({ name: 'UnionOwner' });
      const post = await createRescuePost(owner.id, 'Union Rescue');

      const threadStarter = await createUser({ name: 'ThreadStarter' });
      const replyAuthor = await createUser({ name: 'ReplyAuthor' });
      const rejectedRequester = await createUser({ name: 'RejectedRequester' });
      const hiddenCommenter = await createUser({ name: 'HiddenCommenter' });
      const removedCommenter = await createUser({ name: 'RemovedCommenter' });

      // A Reply author participates through the parent thread.
      const parentCommentId = generateUuidV7();
      await dbHelper.db.insert(comments).values({
        id: parentCommentId,
        postId: post.id,
        authorId: threadStarter.id,
        text: 'Starting the discussion',
        status: 'ACTIVE',
      });
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: replyAuthor.id,
        parentId: parentCommentId,
        text: 'Replying with transport help',
        status: 'ACTIVE',
      });

      // Contact requesters count regardless of their request status.
      await dbHelper.db.insert(contactRequests).values({
        id: generateUuidV7(),
        postId: post.id,
        requesterId: rejectedRequester.id,
        message: 'Earlier request already rejected',
        status: 'REJECTED',
      });

      // HIDDEN authors remain eligible; only DELETED/REMOVED contributions are excluded.
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: hiddenCommenter.id,
        text: 'Hidden by reports but still a participant',
        status: 'HIDDEN',
      });
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: removedCommenter.id,
        text: 'Removed contribution',
        status: 'REMOVED',
      });

      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event.totalRecipients).toBe(4);

      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.eventId, event.id));
      expect(recipients.map((r) => r.recipientId).sort()).toEqual(
        [threadStarter.id, replyAuthor.id, rejectedRequester.id, hiddenCommenter.id].sort(),
      );
      expect(recipients.map((r) => r.recipientId)).not.toContain(removedCommenter.id);
      expect(recipients.map((r) => r.recipientId)).not.toContain(owner.id);
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

    it('terminates a recipient stranded by an expired max-attempt lease and completes its event', async () => {
      const owner = await createUser({ name: 'StrandedLeaseOwner' });
      const post = await createRescuePost(owner.id, 'Stranded Lease Rescue');
      const recipientUser = await createUser({ name: 'StrandedLeaseRecipient' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: recipientUser.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      // Simulate a worker that crashed after claiming the recipient for its
      // final allowed attempt: the lease has expired and attempts is at the
      // bound, so no later claim can ever match this row.
      await dbHelper.db.execute(sql`
        UPDATE post_completion_recipients
        SET status = 'PROCESSING',
            attempts = ${MAX_COMPLETION_DELIVERY_ATTEMPTS},
            lease_token = ${generateUuidV7()}::uuid,
            lease_expires_at = now() - interval '10 seconds'
        WHERE post_id = ${post.id}::uuid
      `);

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);
      expect(batchRes.batchesProcessed).toBe(0);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id));
      expect(recipient.status).toBe('FAILED');
      expect(recipient.leaseToken).toBeNull();
      expect(recipient.leaseExpiresAt).toBeNull();
      expect(recipient.lastError).toContain('lease expired');

      // The stranded recipient must not leave its event PENDING forever.
      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event.status).toBe('COMPLETED');

      const notifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, recipientUser.id));
      expect(notifs).toHaveLength(0);
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

    it('does not resurrect a push intent when the recipient re-enables notifications after delivery', async () => {
      const owner = await createUser({ name: 'ReEnableOwner' });
      const post = await createRescuePost(owner.id, 'ReEnable Rescue');
      const user = await createUser({ name: 'ReEnableUser', notificationsEnabled: false });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: user.id,
        token: 'token_reenable',
        platform: 'ANDROID',
      });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: user.id });
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

      const firstPass = await processor.processPendingBatches({ batchSize: 10 });
      expect(firstPass.delivered).toBe(1);

      const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, user.id));
      expect(notifs).toHaveLength(1);
      expect(
        await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, user.id)),
      ).toHaveLength(0);

      // Re-enabling push later must not resurrect suppressed delivery.
      await dbHelper.db.update(users).set({ notificationsEnabled: true }).where(eq(users.id, user.id));

      const secondPass = await processor.processPendingBatches({ batchSize: 10 });
      expect(secondPass.delivered).toBe(0);
      expect(secondPass.batchesProcessed).toBe(0);

      expect(
        await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, user.id)),
      ).toHaveLength(0);
      expect(await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, user.id))).toHaveLength(
        1,
      );
    });

    it('suppresses a materialized closure event when the owner removes the post before delivery', async () => {
      const owner = await createUser({ name: 'CloseThenDeleteOwner' });
      const post = await createRescuePost(owner.id, 'Close Then Delete Rescue');
      const participant = await createUser({ name: 'CloseThenDeleteParticipant' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: participant.id,
        token: 'token_close_then_delete',
        platform: 'IOS',
      });
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');
      const removed = await postsRepo.softDelete(post.id, owner.id);
      expect(removed?.status).toBe('REMOVED');

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);
      expect(batchRes.suppressed).toBe(1);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, participant.id));
      expect(recipient.status).toBe('SUPPRESSED');
      expect(recipient.notificationId).toBeNull();

      expect(
        await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, participant.id)),
      ).toHaveLength(0);
      expect(
        await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, participant.id)),
      ).toHaveLength(0);
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

    it('applies current access checks to reopening corrections and records the creator as the push actor', async () => {
      const creator = await createUser({ name: 'CorrectionAccessCreator' });
      const post = await createRescuePost(creator.id, 'Correction Access Rescue');
      const blocked = await createUser({ name: 'CorrectionAccessBlocked' });
      const eligible = await createUser({ name: 'CorrectionAccessEligible' });

      for (const [user, token] of [
        [blocked, 'token_correction_blocked'],
        [eligible, 'token_correction_eligible'],
      ] as Array<[User, string]>) {
        await dbHelper.db.insert(deviceRegistrations).values({
          id: generateUuidV7(),
          userId: user.id,
          token,
          platform: 'ANDROID',
        });
      }

      await dbHelper.db.insert(postUpvotes).values([
        { postId: post.id, userId: blocked.id },
        { postId: post.id, userId: eligible.id },
      ]);

      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');
      expect((await processor.processPendingBatches({ batchSize: 10 })).delivered).toBe(2);

      // The creator blocks one participant after the closure notification was
      // committed but before the administrative reopening runs.
      await dbHelper.db.insert(blocks).values({ blockerId: creator.id, blockedId: blocked.id });

      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      // The isolated participant keeps the delivered closure row, is not marked
      // CORRECTED, and receives no correction notification or push intent.
      const [blockedRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, blocked.id));
      expect(blockedRecipient.status).toBe('DELIVERED');
      expect(blockedRecipient.notificationId).not.toBeNull();

      const blockedNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, blocked.id));
      expect(blockedNotifs.filter((n) => n.type === 'RESCUE_COMPLETED')).toHaveLength(1);
      expect(blockedNotifs.filter((n) => n.type === 'RESCUE_REOPENED')).toHaveLength(0);

      const blockedPushes = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.recipientId, blocked.id));
      expect(blockedPushes).toHaveLength(1);
      expect(blockedPushes[0].notificationId).toBe(blockedNotifs.find((n) => n.type === 'RESCUE_COMPLETED')!.id);

      // The eligible participant is corrected, and the correction push intent
      // records the Post creator for the send-time Block recheck.
      const [eligibleRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, eligible.id));
      expect(eligibleRecipient.status).toBe('CORRECTED');

      const eligibleNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, eligible.id));
      const correction = eligibleNotifs.find((n) => n.type === 'RESCUE_REOPENED');
      expect(correction).toBeDefined();

      const correctionPushes = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.notificationId, correction!.id));
      expect(correctionPushes).toHaveLength(1);
      expect(correctionPushes[0].actorId).toBe(creator.id);
    });

    it('suppresses a queued closure push intent when reopening corrects the outcome', async () => {
      const creator = await createUser({ name: 'QueuedClosureCreator' });
      const post = await createRescuePost(creator.id, 'Queued Closure Rescue');
      const participant = await createUser({ name: 'QueuedClosureParticipant' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: participant.id,
        token: 'token_queued_closure',
        platform: 'IOS',
      });
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');
      // Materialize the closure: the inbox row is committed and its push intent
      // is queued PENDING for the push worker to send later.
      expect((await processor.processPendingBatches({ batchSize: 10 })).delivered).toBe(1);

      const [closureNotification] = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(closureNotification.type).toBe('RESCUE_COMPLETED');

      const [closurePush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.notificationId, closureNotification.id));
      expect(closurePush.status).toBe('PENDING');

      // The administrator reopens before the push worker sends the closure.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      // The obsolete closure intent is terminal, and the correction owns a new
      // PENDING intent with the Post creator as its send-time actor.
      const [suppressedClosurePush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.id, closurePush.id));
      expect(suppressedClosurePush.status).toBe('SUPPRESSED');

      const [correction] = await dbHelper.db
        .select()
        .from(notifications)
        .where(
          sql`${notifications.recipientId} = ${participant.id}::uuid AND ${notifications.type} = 'RESCUE_REOPENED'`,
        );
      expect(correction).toBeDefined();

      const [correctionPush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.notificationId, correction.id));
      expect(correctionPush.status).toBe('PENDING');
      expect(correctionPush.actorId).toBe(creator.id);

      // The push processor never hands the suppressed closure intent to the
      // provider: only the correction is sent.
      const sentMessages: PushDeliveryMessage[] = [];
      const provider: PushProvider = {
        send: (message) => {
          sentMessages.push(message);
          return Promise.resolve();
        },
      };
      const pushProcessor = new PushDeliveryProcessor(dbHelper.db, provider, isolationPolicy);
      expect(await pushProcessor.processPendingDeliveries()).toBe(1);
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].data.notificationId).toBe(correction.id);
      expect(sentMessages.filter((message) => message.data.notificationId === closureNotification.id)).toHaveLength(0);
    });

    it('serializes a concurrent reopening against worker materialization without orphaned or misrouted notifications', async () => {
      const creator = await createUser({ name: 'RaceCreator' });
      const post = await createRescuePost(creator.id, 'Race Reopen Rescue');
      const first = await createUser({ name: 'RaceFirst' });
      const second = await createUser({ name: 'RaceSecond' });

      await dbHelper.db.insert(postUpvotes).values([
        { postId: post.id, userId: first.id },
        { postId: post.id, userId: second.id },
      ]);
      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');

      // The worker materializes the closure while an administrator reopening
      // supersedes it. withDbRetry gives the reopening the same deadlock retry
      // the production paths use, so the race always settles in one serial order.
      const [batchResult, reopenResult] = await Promise.all([
        processor.processPendingBatches({ batchSize: 10 }),
        withDbRetry(() =>
          dbHelper.db.transaction(async (tx) => {
            await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
            return postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
          }),
        ),
      ]);
      expect(batchResult.failed).toBe(0);

      // Drain any lease the race left behind so the assertions see the settled
      // serial order rather than an in-flight claim.
      await processor.processPendingBatches({ batchSize: 10 });

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event).toBeDefined();

      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.eventId, event.id));
      expect(recipients).toHaveLength(2);
      for (const recipient of recipients) {
        expect(['SUPPRESSED', 'CORRECTED', 'DELIVERED']).toContain(recipient.status);
      }

      const postNotifs = await dbHelper.db.select().from(notifications).where(eq(notifications.relatedPostId, post.id));
      const recipientIds = recipients.map((r) => r.recipientId);
      for (const notification of postNotifs) {
        expect(recipientIds).toContain(notification.recipientId);
      }

      const closures = postNotifs.filter((n) => n.type === 'RESCUE_COMPLETED');
      const corrections = postNotifs.filter((n) => n.type === 'RESCUE_REOPENED');

      // Every committed closure inbox row corresponds to exactly one closure
      // notification, and a superseded event can never keep an uncorrected
      // closure inbox row.
      const closureInboxRecipients = recipients.filter((r) => r.notificationId !== null);
      expect(closures).toHaveLength(closureInboxRecipients.length);
      for (const recipient of closureInboxRecipients) {
        expect(closures.some((n) => n.id === recipient.notificationId && n.recipientId === recipient.recipientId)).toBe(
          true,
        );
        if (event.status === 'SUPERSEDED') {
          expect(recipient.status).toBe('CORRECTED');
          expect(corrections.some((n) => n.recipientId === recipient.recipientId)).toBe(true);
        }
      }

      // A correction can exist only for a recipient whose closure inbox row was
      // committed, and every correction is unique per recipient.
      expect(corrections).toHaveLength(reopenResult.correctedCount);
      for (const correction of corrections) {
        const recipient = recipients.find((r) => r.recipientId === correction.recipientId);
        expect(recipient).toBeDefined();
        expect(recipient!.notificationId).not.toBeNull();
        expect(recipient!.status).toBe('CORRECTED');
      }
      expect(new Set(corrections.map((n) => n.recipientId)).size).toBe(corrections.length);

      // Once superseded, no recipient is still deliverable.
      if (event.status === 'SUPERSEDED') {
        expect(recipients.filter((r) => r.status === 'PENDING' || r.status === 'PROCESSING')).toHaveLength(0);
      }
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

  describe('Ticket 05: Adoption Post Completion Notifications (including Applicants)', () => {
    it('captures applicants of every status alongside savers and commenters, deduplicated', async () => {
      const creator = await createUser({ name: 'AdoptionCreator' });
      const post = await createAdoptionPost(creator.id, 'Playful Kitten Adoption');

      const pendingApplicant = await createUser({ name: 'PendingApplicant' });
      const approvedApplicant = await createUser({ name: 'ApprovedApplicant' });
      const rejectedApplicant = await createUser({ name: 'RejectedApplicant' });
      const overlappingUser = await createUser({ name: 'OverlappingUser' });
      const saver = await createUser({ name: 'AdoptionSaver' });

      // Applicants of every status are part of the closure-time audience; the
      // overlapping applicant is also a saver and a commenter.
      await dbHelper.db
        .insert(adoptionApplications)
        .values([
          adoptionApplicationValues(post.id, pendingApplicant.id, 'PENDING'),
          adoptionApplicationValues(post.id, approvedApplicant.id, 'APPROVED'),
          adoptionApplicationValues(post.id, rejectedApplicant.id, 'REJECTED'),
          adoptionApplicationValues(post.id, overlappingUser.id, 'PENDING'),
        ]);
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: overlappingUser.id });
      await dbHelper.db.insert(comments).values({
        id: generateUuidV7(),
        postId: post.id,
        authorId: overlappingUser.id,
        text: 'Applied and commented!',
        status: 'ACTIVE',
      });
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: saver.id });

      const updated = await postsRepo.updateStatus(post.id, creator.id, 'ADOPTED');
      expect(updated?.status).toBe('ADOPTED');

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event).toBeDefined();
      expect(event.postType).toBe('ADOPTION');
      expect(event.type).toBe('POST_COMPLETED');
      expect(event.outcome).toBe('ADOPTED');
      expect(event.title).toBe('Pet adopted');
      expect(event.body).toBe('The post "Playful Kitten Adoption" was marked as adopted.');
      expect(event.titleArabic).toBe('تم التبني');
      expect(event.bodyArabic).toContain('Playful Kitten Adoption');
      expect(event.totalRecipients).toBe(5);

      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.eventId, event.id));
      const recipientUserIds = recipients.map((r) => r.recipientId);
      expect(recipientUserIds).toContain(pendingApplicant.id);
      expect(recipientUserIds).toContain(approvedApplicant.id);
      expect(recipientUserIds).toContain(rejectedApplicant.id);
      expect(recipientUserIds).toContain(overlappingUser.id);
      expect(recipientUserIds).toContain(saver.id);
      expect(recipientUserIds).not.toContain(creator.id);

      // Overlapping applicant/comment/save membership stays a single recipient.
      expect(recipients.filter((r) => r.recipientId === overlappingUser.id)).toHaveLength(1);

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(5);

      for (const userId of [
        pendingApplicant.id,
        approvedApplicant.id,
        rejectedApplicant.id,
        overlappingUser.id,
        saver.id,
      ]) {
        const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, userId));
        expect(notifs).toHaveLength(1);
        expect(notifs[0].type).toBe('POST_COMPLETED');
        expect(notifs[0].title).toBe('Pet adopted');
        expect(notifs[0].relatedPostId).toBe(post.id);
      }
    });

    it('suppresses the completion notification when the creator has blocked an applicant', async () => {
      const creator = await createUser({ name: 'BlockCreator' });
      const post = await createAdoptionPost(creator.id, 'Block Test Adoption');
      const applicant = await createUser({ name: 'BlockedApplicant' });

      await dbHelper.db
        .insert(adoptionApplications)
        .values(adoptionApplicationValues(post.id, applicant.id, 'PENDING'));

      await postsRepo.updateStatus(post.id, creator.id, 'ADOPTED');

      // The creator blocks the applicant after the outcome was recorded.
      await dbHelper.db.insert(blocks).values({ blockerId: creator.id, blockedId: applicant.id });

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(0);
      expect(batchRes.suppressed).toBe(1);

      const [recipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.recipientId, applicant.id));
      expect(recipient.status).toBe('BLOCKED');

      const applicantNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, applicant.id));
      expect(applicantNotifs).toHaveLength(0);
    });

    it('does not revive terminated applications or re-notify a completion on reopening', async () => {
      const creator = await createUser({ name: 'ReopenAdoptionCreator' });
      const post = await createAdoptionPost(creator.id, 'Reopened Adoption Listing');
      const applicant = await createUser({ name: 'ReopenApplicant' });

      const applicationId = generateUuidV7();
      await dbHelper.db.insert(adoptionApplications).values({
        ...adoptionApplicationValues(post.id, applicant.id, 'PENDING'),
        id: applicationId,
      });

      await postsRepo.updateStatus(post.id, creator.id, 'ADOPTED');

      const [terminated] = await dbHelper.db
        .select()
        .from(adoptionApplications)
        .where(eq(adoptionApplications.id, applicationId));
      expect(terminated.status).toBe('REJECTED');
      expect(terminated.respondedAt).not.toBeNull();

      expect((await processor.processPendingBatches({ batchSize: 10 })).delivered).toBe(1);

      // Administrator reopens the mistaken outcome.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      // Closed stays closed: reopening never revives a terminated application.
      const [afterReopen] = await dbHelper.db
        .select()
        .from(adoptionApplications)
        .where(eq(adoptionApplications.id, applicationId));
      expect(afterReopen.status).toBe('REJECTED');
      expect(afterReopen.respondedAt).not.toBeNull();

      // The delivered applicant is corrected exactly once and never receives a
      // second completion notification.
      const notifs = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, applicant.id));
      expect(notifs.filter((n) => n.type === 'POST_COMPLETED')).toHaveLength(1);
      expect(notifs.filter((n) => n.type === 'POST_REOPENED')).toHaveLength(1);

      const afterReopenBatch = await processor.processPendingBatches({ batchSize: 10 });
      expect(afterReopenBatch.delivered).toBe(0);
      expect(afterReopenBatch.batchesProcessed).toBe(0);
    });
  });

  describe('Ticket 06: Animal deceased rescue closure', () => {
    it('closes a rescue as ANIMAL_DECEASED with deceased copy and delivers inbox and push with relatedPostId', async () => {
      const owner = await createUser({ name: 'DeceasedOwner' });
      const post = await createRescuePost(owner.id, 'Injured Stray Cat');
      const participant = await createUser({ name: 'DeceasedParticipant' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: participant.id,
        token: 'token_animal_deceased',
        platform: 'ANDROID',
      });
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      const updated = await postsRepo.updateStatus(post.id, owner.id, 'ANIMAL_DECEASED');
      expect(updated?.status).toBe('ANIMAL_DECEASED');

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event.type).toBe('RESCUE_COMPLETED');
      expect(event.outcome).toBe('ANIMAL_DECEASED');
      expect(event.title).toBe('Rescue closed');
      expect(event.body).toBe('The rescue "Injured Stray Cat" was closed (animal deceased).');
      expect(event.body).not.toContain('rescued');
      expect(event.titleArabic).toBe('تم إغلاق حالة الإنقاذ');
      expect(event.bodyArabic).toContain('وفاة الحيوان');
      expect(event.bodyArabic).not.toContain('تم إنقاذها');

      const batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      const [notification] = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(notification.type).toBe('RESCUE_COMPLETED');
      expect(notification.title).toBe('Rescue closed');
      expect(notification.body).toBe('The rescue "Injured Stray Cat" was closed (animal deceased).');
      expect(notification.body).not.toContain('rescued');
      expect(notification.relatedPostId).toBe(post.id);

      const [pushIntent] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.recipientId, participant.id));
      expect(pushIntent).toBeDefined();
      expect(pushIntent.notificationId).toBe(notification.id);

      const sentMessages: PushDeliveryMessage[] = [];
      const provider: PushProvider = {
        send: (message) => {
          sentMessages.push(message);
          return Promise.resolve();
        },
      };
      const pushProcessor = new PushDeliveryProcessor(dbHelper.db, provider, isolationPolicy);
      expect(await pushProcessor.processPendingDeliveries()).toBe(1);
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].title).toBe('Rescue closed');
      expect(sentMessages[0].body).toBe('The rescue "Injured Stray Cat" was closed (animal deceased).');
      expect(sentMessages[0].body).not.toContain('rescued');
      expect(sentMessages[0].data.relatedPostId).toBe(post.id);
    });

    it('sends the RESCUE_REOPENED correction on reopening and suppresses a stale pending closure delivery', async () => {
      const owner = await createUser({ name: 'DeceasedReopenOwner' });
      const post = await createRescuePost(owner.id, 'Deceased Reopen Rescue');
      const delivered = await createUser({ name: 'DeceasedDeliveredParticipant' });
      const pending = await createUser({ name: 'DeceasedPendingParticipant' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: delivered.id });
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: pending.id });

      await postsRepo.updateStatus(post.id, owner.id, 'ANIMAL_DECEASED');

      // Deliver exactly one participant and leave the other PENDING.
      const deliveryBatch = await processor.processPendingBatches({ maxBatches: 1, batchSize: 1 });
      expect(deliveryBatch.delivered).toBe(1);
      const [deliveredRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.status, 'DELIVERED'));
      expect(deliveredRecipient).toBeDefined();

      // Administrator reopens the mistaken deceased outcome.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      const [event] = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id));
      expect(event.status).toBe('SUPERSEDED');

      const deliveredNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, deliveredRecipient.recipientId));
      expect(deliveredNotifs.filter((n) => n.type === 'RESCUE_COMPLETED')).toHaveLength(1);
      const correction = deliveredNotifs.find((n) => n.type === 'RESCUE_REOPENED');
      expect(correction).toBeDefined();
      expect(correction?.relatedPostId).toBe(post.id);
      expect(correction?.body).toContain(post.title);

      const [staleRecipient] = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(
          sql`${postCompletionRecipients.postId} = ${post.id}::uuid AND ${postCompletionRecipients.id} <> ${deliveredRecipient.id}::uuid`,
        );
      expect(staleRecipient.status).toBe('SUPPRESSED');

      const staleNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, staleRecipient.recipientId));
      expect(staleNotifs).toHaveLength(0);

      const afterReopenBatch = await processor.processPendingBatches({ batchSize: 10 });
      expect(afterReopenBatch.delivered).toBe(0);
      expect(afterReopenBatch.batchesProcessed).toBe(0);
    });

    it('keeps deceased and successful rescue close/reopen/close cycles distinct', async () => {
      const creator = await createUser({ name: 'DeceasedCycleCreator' });
      const post = await createRescuePost(creator.id, 'Rescue Cycle Deceased');
      const participant = await createUser({ name: 'DeceasedCycleParticipant' });

      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      // Cycle 1: close as deceased.
      await postsRepo.updateStatus(post.id, creator.id, 'ANIMAL_DECEASED');
      let batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      // Reopen the mistaken deceased outcome.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      // Cycle 2: close as a successful rescue.
      await postsRepo.updateStatus(post.id, creator.id, 'RESOLVED');
      batchRes = await processor.processPendingBatches({ batchSize: 10 });
      expect(batchRes.delivered).toBe(1);

      const notifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(notifs).toHaveLength(3);
      const closures = notifs.filter((n) => n.type === 'RESCUE_COMPLETED');
      expect(closures).toHaveLength(2);
      expect(closures.map((n) => n.title).sort()).toEqual(['Rescue closed', 'Rescue resolved']);
      expect(closures.find((n) => n.title === 'Rescue closed')?.body).toBe(
        'The rescue "Rescue Cycle Deceased" was closed (animal deceased).',
      );
      expect(closures.find((n) => n.title === 'Rescue resolved')?.body).toBe(
        'The rescue "Rescue Cycle Deceased" was marked as rescued.',
      );
      const corrections = notifs.filter((n) => n.type === 'RESCUE_REOPENED');
      expect(corrections).toHaveLength(1);
      expect(corrections[0].title).toBe('Rescue reopened');
      expect(corrections[0].body).toBe('The rescue "Rescue Cycle Deceased" was reopened.');
      expect(corrections[0].relatedPostId).toBe(post.id);

      // The first (deceased) closure had already been delivered, so reopening
      // marks its recipient CORRECTED rather than superseding the completed
      // event; the second closure is delivered normally.
      const recipients = await dbHelper.db
        .select()
        .from(postCompletionRecipients)
        .where(eq(postCompletionRecipients.postId, post.id))
        .orderBy(postCompletionRecipients.createdAt);
      expect(recipients).toHaveLength(2);
      expect(recipients.map((r) => r.status)).toEqual(['CORRECTED', 'DELIVERED']);

      const events = await dbHelper.db
        .select()
        .from(postCompletionNotificationEvents)
        .where(eq(postCompletionNotificationEvents.postId, post.id))
        .orderBy(postCompletionNotificationEvents.createdAt);
      expect(events).toHaveLength(2);
      expect(events[0].outcome).toBe('ANIMAL_DECEASED');
      expect(events[0].status).toBe('COMPLETED');
      expect(events[1].outcome).toBe('RESOLVED');
      expect(events[1].status).toBe('COMPLETED');
    });
  });

  describe('Push worker Post lifecycle recheck (decision 19)', () => {
    it('suppresses a queued closure push when the post is removed before the push worker runs', async () => {
      const owner = await createUser({ name: 'LifecycleRemoveOwner' });
      const post = await createRescuePost(owner.id, 'Lifecycle Remove Rescue');
      const participant = await createUser({ name: 'LifecycleRemoveParticipant' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: participant.id,
        token: 'token_lifecycle_remove',
        platform: 'ANDROID',
      });
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');
      expect((await processor.processPendingBatches({ batchSize: 10 })).delivered).toBe(1);

      const [closureNotification] = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(closureNotification.type).toBe('RESCUE_COMPLETED');

      const [closurePush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.notificationId, closureNotification.id));
      expect(closurePush.status).toBe('PENDING');

      // The owner removes the post after the closure inbox row and push intent
      // committed, but before the push worker sends.
      const removed = await postsRepo.softDelete(post.id, owner.id);
      expect(removed?.status).toBe('REMOVED');

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

      const [suppressedPush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.id, closurePush.id));
      expect(suppressedPush.status).toBe('SUPPRESSED');

      // Suppression terminates the push only; the inbox row survives.
      const retainedNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(retainedNotifs).toHaveLength(1);
    });

    it('suppresses a queued correction push when the post is re-closed before the push worker runs', async () => {
      const owner = await createUser({ name: 'LifecycleRecloseOwner' });
      const post = await createRescuePost(owner.id, 'Lifecycle Reclose Rescue');
      const participant = await createUser({ name: 'LifecycleRecloseParticipant' });

      await dbHelper.db.insert(deviceRegistrations).values({
        id: generateUuidV7(),
        userId: participant.id,
        token: 'token_lifecycle_reclose',
        platform: 'IOS',
      });
      await dbHelper.db.insert(postUpvotes).values({ postId: post.id, userId: participant.id });

      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');
      expect((await processor.processPendingBatches({ batchSize: 10 })).delivered).toBe(1);

      // Administrator reopens, which queues the correction push.
      await dbHelper.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE posts SET status = 'ACTIVE' WHERE id = ${post.id}::uuid`);
        await postCompletionRepo.handleReopen(tx, { postId: post.id, postTitle: post.title });
      });

      const [correction] = await dbHelper.db
        .select()
        .from(notifications)
        .where(
          sql`${notifications.recipientId} = ${participant.id}::uuid AND ${notifications.type} = 'RESCUE_REOPENED'`,
        );
      expect(correction).toBeDefined();

      const [correctionPush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.notificationId, correction.id));
      expect(correctionPush.status).toBe('PENDING');

      // The owner closes the post again before the push worker sends, so the
      // correction no longer describes the current lifecycle state.
      await postsRepo.updateStatus(post.id, owner.id, 'RESOLVED');

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

      const [suppressedPush] = await dbHelper.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.id, correctionPush.id));
      expect(suppressedPush.status).toBe('SUPPRESSED');

      // Both committed inbox rows survive suppression.
      const retainedNotifs = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, participant.id));
      expect(retainedNotifs).toHaveLength(2);
    });
  });
});
