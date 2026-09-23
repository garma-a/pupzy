import { count, eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  cities,
  deviceRegistrations,
  notifications,
  posts,
  pushDeliveries,
  users,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { notificationTypeEnum } from '../database/schema/enums';
import { buildNotificationContent, type NotificationTemplateParamsMap } from '../notifications/notification-templates';
import { isPushDeliveryEnabled, PUSH_ENABLED_NOTIFICATION_TYPES } from '../notifications/push-delivery.constants';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDeliveryRepository } from '../notifications/push-delivery.repository';
import { PushDeliveryProcessor } from '../notifications/push-delivery.processor';
import { DiscussionNotificationProcessor } from '../notifications/discussion-notification.processor';
import { DeviceRegistrationsRepository } from '../notifications/device-registrations.repository';
import type { PushDeliveryMessage, PushProvider } from '../notifications/push.provider';
import { PostsRepository } from '../posts/posts.repository';
import { PostsService } from '../posts/posts.service';
import { ViewFlushCron } from '../posts/view-flush.cron';
import { PostExpiryProcessor } from '../posts/post-expiry.processor';
import { UserBanPostCascadeProcessor } from '../posts/user-ban-post-cascade.processor';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ContactsService } from '../contacts/contacts.service';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { UploadService } from '../upload/upload.service';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { CitiesService } from '../cities/cities.service';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

const PHONE_ENCRYPTION_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';

/** Representative parameters for the type-coverage sweep. */
const SAMPLE_PARAMS: NotificationTemplateParamsMap = {
  NEW_UPVOTE: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  POST_SAVED: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  CONTACT_REQUEST_RECEIVED: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  CONTACT_REQUEST_APPROVED: { postTitle: 'Missing cat' },
  CONTACT_REQUEST_REJECTED: { postTitle: 'Missing cat' },
  ADOPTION_APPLICATION_RECEIVED: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  ADOPTION_APPLICATION_APPROVED: { postTitle: 'Missing cat' },
  ADOPTION_APPLICATION_REJECTED: { postTitle: 'Missing cat' },
  POST_REMOVED_BY_ADMIN: { reason: 'Policy violation' },
  POST_RESOLVED_BY_ADMIN: { postTitle: 'Missing cat', outcome: 'ADOPTED' },
  POST_REOPENED_BY_ADMIN: { postTitle: 'Missing cat' },
  POST_INACTIVITY_NUDGE: { postTitle: 'Missing cat' },
  SYSTEM_ANNOUNCEMENT: { postTitle: 'Missing cat' },
  NEW_COMMENT: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  NEW_REPLY: { actorName: 'Ahmed' },
  COMMENT_BOOSTED: { actorName: 'Ahmed', target: 'comment' },
  COMMENT_PINNED: { postTitle: 'Missing cat' },
  POST_COMPLETED: { postTitle: 'Missing cat' },
  POST_REOPENED: { postTitle: 'Missing cat' },
  RESCUE_COMPLETED: { postTitle: 'Missing cat' },
  RESCUE_REOPENED: { postTitle: 'Missing cat' },
};

/** Controllable provider standing in for FCM at the external boundary. */
class ControllablePushProvider implements PushProvider {
  readonly sent: PushDeliveryMessage[] = [];
  readonly failures: Error[] = [];
  alwaysFail: Error | null = null;
  attempted = 0;

  send(message: PushDeliveryMessage): Promise<void> {
    this.attempted += 1;
    if (this.alwaysFail) return Promise.reject(this.alwaysFail);
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    this.sent.push(message);
    return Promise.resolve();
  }

  reset(): void {
    this.sent.length = 0;
    this.failures.length = 0;
    this.alwaysFail = null;
    this.attempted = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ticket 20 — durable localized push coverage for every remaining workflow.
 *
 * Drives real workflow entry points (contacts, discussion outbox, inactivity
 * expiry, ban cascade, engagement) against a real database with a controllable
 * push provider, proving durable intent creation, routing/localization,
 * deduplication, retry bounds, dead-token cleanup and suppression after
 * opt-out, Blocks, Account Deletion and token reassignment.
 */
describe('Workflow push delivery coverage (Ticket 20)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let provider: ControllablePushProvider;
  let pushProcessor: PushDeliveryProcessor;
  let pushDeliveryRepository: PushDeliveryRepository;
  let notificationsService: NotificationsService;
  let deviceRegistrationsRepository: DeviceRegistrationsRepository;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let contactsService: ContactsService;
  let commentsService: CommentsService;
  let discussionProcessor: DiscussionNotificationProcessor;
  let expiryProcessor: PostExpiryProcessor;
  let banCascadeProcessor: UserBanPostCascadeProcessor;

  let city: City;
  let owner: User;
  let actor: User;

  async function insertUser(
    label: string,
    options: { languagePreference?: 'ar' | 'en' | null; notificationsEnabled?: boolean } = {},
  ): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@example.com`,
        fullName: label,
        notificationsEnabled: options.notificationsEnabled ?? true,
        ...(options.languagePreference === undefined ? {} : { languagePreference: options.languagePreference }),
      })
      .returning();
    return user;
  }

  async function insertPost(creator: User, postType: Post['postType'], title: string): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: creator.id,
        postType,
        title,
        description: `Ticket 20 ${postType} workflow`,
        cityId: city.id,
        status: 'ACTIVE',
        urgency: postType === 'RESCUE' || postType === 'LOST' ? 'CRITICAL' : null,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  async function notificationsFor(recipientId: string) {
    return dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, recipientId));
  }

  async function deliveriesFor(recipientId: string) {
    return dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.recipientId, recipientId));
  }

  async function notificationCountFor(recipientId: string): Promise<number> {
    const [row] = await dbHelper.db
      .select({ total: count() })
      .from(notifications)
      .where(eq(notifications.recipientId, recipientId));
    return Number(row?.total ?? 0);
  }

  async function deliveryCountFor(recipientId: string): Promise<number> {
    const [row] = await dbHelper.db
      .select({ total: count() })
      .from(pushDeliveries)
      .where(eq(pushDeliveries.recipientId, recipientId));
    return Number(row?.total ?? 0);
  }

  async function waitForDeliveryCount(recipientId: string, expected: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await deliveryCountFor(recipientId)) === expected) return;
      await sleep(25);
    }
    expect(await deliveryCountFor(recipientId)).toBe(expected);
  }

  async function waitForNotificationCount(recipientId: string, expected: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await notificationCountFor(recipientId)) === expected) return;
      await sleep(25);
    }
    expect(await notificationCountFor(recipientId)).toBe(expected);
  }

  /** Retries the whole pending backoff queue immediately for deterministic tests. */
  async function makePendingDeliveriesDue(): Promise<void> {
    await dbHelper.pool.query(`UPDATE push_deliveries SET next_attempt_at = now() WHERE status = 'PENDING'`);
  }

  function token(): string {
    return `fcm-token-${generateUuidV7()}`;
  }

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const cacheStore = new Map<string, unknown>();
    const mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        cacheStore.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
      reset: jest.fn(() => {
        cacheStore.clear();
        return Promise.resolve();
      }),
    } as unknown as Cache;

    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'PHONE_ENCRYPTION_KEY') return PHONE_ENCRYPTION_KEY;
        if (key === 'COMMENT_IMAGES_ENABLED') return 'true';
        if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://cdn.pupzy.net';
        return undefined;
      }),
    } as unknown as ConfigService;

    const isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    pushDeliveryRepository = new PushDeliveryRepository(dbHelper.db);
    const notificationsRepository = new NotificationsRepository(dbHelper.db, isolationPolicy, pushDeliveryRepository);
    notificationsService = new NotificationsService(notificationsRepository);
    deviceRegistrationsRepository = new DeviceRegistrationsRepository(dbHelper.db);

    postsRepository = new PostsRepository(dbHelper.db, undefined, isolationPolicy, pushDeliveryRepository);
    const citiesService = new CitiesService(new CitiesRepository(dbHelper.db), mockCache);
    const usersService = new UsersService(
      new UsersRepository(dbHelper.db),
      citiesService,
      new AccountDeletionRepository(dbHelper.db),
      mockConfig,
      mockCache,
    );
    const uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);

    postsService = new PostsService(
      postsRepository,
      citiesService,
      uploadService,
      new ViewFlushCron(postsRepository),
      usersService,
      notificationsService,
      mockCache,
    );

    contactsService = new ContactsService(
      new ContactsRepository(dbHelper.db),
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );

    const commentsRepository = new CommentsRepository(dbHelper.db);
    commentsService = new CommentsService(
      commentsRepository,
      postsRepository,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      undefined,
      isolationPolicy,
    );

    discussionProcessor = new DiscussionNotificationProcessor(dbHelper.db, isolationPolicy, pushDeliveryRepository);
    expiryProcessor = new PostExpiryProcessor(postsRepository, dbHelper.db);
    banCascadeProcessor = new UserBanPostCascadeProcessor(dbHelper.db, pushDeliveryRepository);

    provider = new ControllablePushProvider();
    pushProcessor = new PushDeliveryProcessor(dbHelper.db, provider, isolationPolicy);
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    provider.reset();

    const [createdCity] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    city = createdCity;

    owner = await insertUser('Post Owner');
    actor = await insertUser('Actor', { languagePreference: 'ar' });
  });

  it('enqueues exactly one durable intent per device for every push-enabled type', async () => {
    const ownerToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'ANDROID');
    const post = await insertPost(owner, 'ADOPTION', 'Type coverage listing');

    const enabledTypes = notificationTypeEnum.enumValues.filter((type) => isPushDeliveryEnabled(type));
    expect(enabledTypes.length).toBe(PUSH_ENABLED_NOTIFICATION_TYPES.size);

    for (const type of enabledTypes) {
      notificationsService.fireNotification(
        {
          recipientId: owner.id,
          type,
          ...buildNotificationContent(type, SAMPLE_PARAMS[type]),
          relatedPostId: post.id,
        },
        actor.id,
      );
    }
    await waitForDeliveryCount(owner.id, enabledTypes.length);

    const rows = await notificationsFor(owner.id);
    expect(rows).toHaveLength(enabledTypes.length);
    const intents = await deliveriesFor(owner.id);
    expect(new Set(intents.map((intent) => intent.notificationId))).toEqual(new Set(rows.map((row) => row.id)));
    expect(intents.every((intent) => intent.status === 'PENDING' && intent.actorId === actor.id)).toBe(true);

    // The retired saved-search announcement stays inbox-only.
    notificationsService.fireNotification(
      {
        recipientId: owner.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        ...buildNotificationContent('SYSTEM_ANNOUNCEMENT', SAMPLE_PARAMS.SYSTEM_ANNOUNCEMENT),
      },
      actor.id,
    );
    await waitForNotificationCount(owner.id, enabledTypes.length + 1);
    expect(await deliveryCountFor(owner.id)).toBe(enabledTypes.length);
  });

  it('delivers contact-request received, approved and rejected pushes with routing', async () => {
    const ownerToken = token();
    const actorToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'IOS');
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'ANDROID');
    const post = await insertPost(owner, 'ADOPTION', 'Adopt this puppy');

    const request = await contactsService.requestContact(actor.id, post.id, 'Can we meet the puppy?');
    await waitForDeliveryCount(owner.id, 1);
    const [receivedNotification] = await notificationsFor(owner.id);
    expect(receivedNotification.type).toBe('CONTACT_REQUEST_RECEIVED');
    const [receivedIntent] = await deliveriesFor(owner.id);
    expect(receivedIntent.status).toBe('PENDING');
    expect(receivedIntent.actorId).toBe(actor.id);

    await contactsService.approveContactRequest(owner.id, request.id);
    await waitForDeliveryCount(actor.id, 1);
    const [approvedNotification] = await notificationsFor(actor.id);
    expect(approvedNotification.type).toBe('CONTACT_REQUEST_APPROVED');

    const secondPost = await insertPost(owner, 'ADOPTION', 'Second listing');
    const secondRequest = await contactsService.requestContact(actor.id, secondPost.id, 'Also interested');
    await waitForDeliveryCount(owner.id, 2);
    await contactsService.rejectContactRequest(owner.id, secondRequest.id);
    await waitForDeliveryCount(actor.id, 2);
    const actorNotifications = await notificationsFor(actor.id);
    expect(actorNotifications.map((row) => row.type).sort()).toEqual([
      'CONTACT_REQUEST_APPROVED',
      'CONTACT_REQUEST_REJECTED',
    ]);

    expect(await pushProcessor.processPendingDeliveries()).toBe(4);
    const sentByType = new Map(provider.sent.map((message) => [message.data.type, message]));

    const ownerMessage = provider.sent.find((message) => message.data.notificationId === receivedNotification.id);
    expect(ownerMessage?.token).toBe(ownerToken);
    expect(ownerMessage?.data).toMatchObject({
      notificationId: receivedNotification.id,
      type: 'CONTACT_REQUEST_RECEIVED',
      relatedPostId: post.id,
      relatedContactRequestId: request.id,
    });

    const approvedMessage = sentByType.get('CONTACT_REQUEST_APPROVED');
    expect(approvedMessage?.token).toBe(actorToken);
    expect(approvedMessage?.title).toBe(approvedNotification.titleArabic);
    expect(approvedMessage?.data).toMatchObject({
      notificationId: approvedNotification.id,
      relatedPostId: post.id,
      relatedContactRequestId: request.id,
    });

    const rejectedMessage = sentByType.get('CONTACT_REQUEST_REJECTED');
    expect(rejectedMessage?.token).toBe(actorToken);
    expect(rejectedMessage?.data).toMatchObject({
      relatedPostId: secondPost.id,
      relatedContactRequestId: secondRequest.id,
    });

    // Delivered work never repeats.
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(4);
  });

  it('delivers every discussion type through the durable outbox and deduplicates', async () => {
    const ownerToken = token();
    const actorToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'ANDROID');
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'IOS');
    const post = await insertPost(owner, 'RESCUE', 'Injured stray dog');

    const comment = await commentsService.createComment(actor.id, {
      postId: post.id,
      text: 'I saw this dog today',
      clientRequestId: generateUuidV7(),
    });
    await commentsService.createReply(owner.id, {
      commentId: comment.id,
      text: 'Thank you, any more details?',
      clientRequestId: generateUuidV7(),
    });
    await commentsService.toggleCommentBoost(owner.id, comment.id);
    await commentsService.pinComment(owner.id, comment.id);

    expect(await discussionProcessor.processPendingEvents()).toBe(4);

    const ownerNotifications = await notificationsFor(owner.id);
    expect(ownerNotifications.map((row) => row.type)).toEqual(['NEW_COMMENT']);
    const actorNotifications = await notificationsFor(actor.id);
    expect(actorNotifications.map((row) => row.type).sort()).toEqual([
      'COMMENT_BOOSTED',
      'COMMENT_PINNED',
      'NEW_REPLY',
    ]);

    await waitForDeliveryCount(owner.id, 1);
    await waitForDeliveryCount(actor.id, 3);
    const intents = [...(await deliveriesFor(owner.id)), ...(await deliveriesFor(actor.id))];
    expect(intents.every((intent) => intent.status === 'PENDING')).toBe(true);

    // Re-running both workers after a crash-style restart changes nothing.
    expect(await discussionProcessor.processPendingEvents()).toBe(0);
    expect(await pushProcessor.processPendingDeliveries()).toBe(4);
    await makePendingDeliveriesDue();
    expect(await discussionProcessor.processPendingEvents()).toBe(0);
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.sent).toHaveLength(4);

    const ownerMessage = provider.sent.find((message) => message.data.type === 'NEW_COMMENT');
    expect(ownerMessage?.token).toBe(ownerToken);
    expect(ownerMessage?.data).toMatchObject({
      relatedPostId: post.id,
      relatedCommentId: comment.id,
    });

    const replyMessage = provider.sent.find((message) => message.data.type === 'NEW_REPLY');
    expect(replyMessage?.token).toBe(actorToken);
    expect(replyMessage?.title).toBe(actorNotifications.find((row) => row.type === 'NEW_REPLY')?.titleArabic);

    // Discussion notifications for the same comment still carry distinct,
    // per-notification collapse keys, so the platform cannot merge them.
    const boostMessage = provider.sent.find((message) => message.data.type === 'COMMENT_BOOSTED');
    const pinnedMessage = provider.sent.find((message) => message.data.type === 'COMMENT_PINNED');
    expect(boostMessage?.collapseId).not.toBe(pinnedMessage?.collapseId);
    expect(new Set(provider.sent.map((message) => message.collapseId)).size).toBe(4);
  });

  it('delivers the inactivity reminder push from the expiry worker only once per cycle', async () => {
    const ownerToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'ANDROID');
    const post = await insertPost(owner, 'ADOPTION', 'Gentle cat');
    await dbHelper.db
      .update(posts)
      .set({ lastEngagedAt: sql`now() - interval '28 days'` })
      .where(eq(posts.id, post.id));

    const firstRun = await expiryProcessor.processPendingExpiry();
    expect(firstRun).toEqual({ expired: 0, reminded: 1 });
    await waitForDeliveryCount(owner.id, 1);

    const [notification] = await notificationsFor(owner.id);
    expect(notification.type).toBe('POST_INACTIVITY_NUDGE');
    expect(notification.relatedPostId).toBe(post.id);
    const [intent] = await deliveriesFor(owner.id);
    expect(intent.actorId).toBeNull();

    expect(await pushProcessor.processPendingDeliveries()).toBe(1);
    const message = provider.sent[0];
    expect(message.token).toBe(ownerToken);
    expect(message.title).toBe(notification.title);
    expect(message.data).toMatchObject({
      notificationId: notification.id,
      type: 'POST_INACTIVITY_NUDGE',
      relatedPostId: post.id,
    });

    // The reminder cycle is durable: a repeated run neither re-notifies nor
    // queues another push.
    expect(await expiryProcessor.processPendingExpiry()).toEqual({ expired: 0, reminded: 0 });
    expect(await deliveryCountFor(owner.id)).toBe(1);
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
  });

  it('queues the ban-cascade removal push and suppresses it for the banned account', async () => {
    const ownerToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'ANDROID');

    const ban = await dbHelper.pool.query<{ ban_marker: string }>(
      `UPDATE users
       SET is_banned = true, banned_at = now(), ban_reason = 'Repeated scams'
       WHERE id = $1
       RETURNING to_char(banned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ban_marker`,
      [owner.id],
    );
    const audit = await dbHelper.pool.query<{ id: string }>(
      `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id, reason, metadata)
       VALUES (NULL, 'USER_BANNED', 'USER', $1, 'Repeated scams',
               jsonb_build_object('alsoRemovePosts', true, 'postCascade', jsonb_build_object('state', 'PENDING')))
       RETURNING id`,
      [owner.id],
    );
    await dbHelper.pool.query(
      `INSERT INTO user_ban_post_cascades (action_id, user_id, reason, ban_marker, cascaded_post_count)
       VALUES ($1, $2, 'Repeated scams', $3, 1)`,
      [audit.rows[0].id, owner.id, ban.rows[0].ban_marker],
    );

    expect(await banCascadeProcessor.processPendingCascades()).toBe(1);
    await waitForDeliveryCount(owner.id, 1);

    const [notification] = await notificationsFor(owner.id);
    expect(notification.type).toBe('POST_REMOVED_BY_ADMIN');
    expect(notification.body).toContain('Repeated scams');
    const [intent] = await deliveriesFor(owner.id);
    expect(intent.actorId).toBeNull();
    expect(intent.status).toBe('PENDING');

    // A banned account receives no push: the intent is terminally suppressed
    // while the inbox row is preserved.
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    expect((await deliveriesFor(owner.id))[0].status).toBe('SUPPRESSED');
    expect(await notificationCountFor(owner.id)).toBe(1);
  });

  it('delivers an upvote push through the real engagement workflow', async () => {
    const ownerToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'ANDROID');
    const post = await insertPost(owner, 'ADOPTION', 'Playful kitten');

    await postsService.toggleUpvote(post.id, actor.id);
    await waitForDeliveryCount(owner.id, 1);

    const [notification] = await notificationsFor(owner.id);
    expect(notification.type).toBe('NEW_UPVOTE');
    expect(notification.relatedPostId).toBe(post.id);

    expect(await pushProcessor.processPendingDeliveries()).toBe(1);
    const message = provider.sent[0];
    expect(message.token).toBe(ownerToken);
    expect(message.body).toContain('Actor');
    expect(message.data).toMatchObject({ type: 'NEW_UPVOTE', relatedPostId: post.id });
  });

  it('retries a transient provider failure and delivers the workflow push later', async () => {
    const actorToken = token();
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'ANDROID');
    const post = await insertPost(actor, 'RESCUE', 'Retry case');
    await commentsService.createComment(owner.id, {
      postId: post.id,
      text: 'Any news?',
      clientRequestId: generateUuidV7(),
    });
    expect(await discussionProcessor.processPendingEvents()).toBe(1);
    await waitForDeliveryCount(actor.id, 1);

    provider.failures.push(
      Object.assign(new Error('temporarily unavailable'), { code: 'messaging/server-unavailable' }),
    );

    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
    const [retryable] = await deliveriesFor(actor.id);
    expect(retryable.status).toBe('PENDING');
    expect(retryable.attempts).toBe(1);
    expect(retryable.lastError).toContain('messaging/server-unavailable');

    await makePendingDeliveriesDue();
    expect(await pushProcessor.processPendingDeliveries()).toBe(1);
    expect(provider.attempted).toBe(2);
    const [delivered] = await deliveriesFor(actor.id);
    expect(delivered.status).toBe('DELIVERED');
    expect(provider.sent[0].data.type).toBe('NEW_COMMENT');
  });

  it('cleans a dead token and its queued workflow pushes', async () => {
    const actorToken = token();
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'ANDROID');
    const post = await insertPost(actor, 'RESCUE', 'Dead token case');
    await commentsService.createComment(owner.id, {
      postId: post.id,
      text: 'Any news?',
      clientRequestId: generateUuidV7(),
    });
    expect(await discussionProcessor.processPendingEvents()).toBe(1);
    await waitForDeliveryCount(actor.id, 1);

    provider.alwaysFail = Object.assign(new Error('not registered'), {
      code: 'messaging/registration-token-not-registered',
    });

    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
    const registrations = await dbHelper.db
      .select()
      .from(deviceRegistrations)
      .where(eq(deviceRegistrations.userId, actor.id));
    expect(registrations).toHaveLength(0);
    expect(await deliveryCountFor(actor.id)).toBe(0);

    // The inbox survives dead-token cleanup.
    expect(await notificationCountFor(actor.id)).toBe(1);
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
  });

  it('suppresses a queued discussion push after opt-out while preserving the inbox', async () => {
    const actorToken = token();
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'ANDROID');
    const post = await insertPost(actor, 'RESCUE', 'Opt-out stray');
    await commentsService.createComment(owner.id, {
      postId: post.id,
      text: 'Any news?',
      clientRequestId: generateUuidV7(),
    });
    expect(await discussionProcessor.processPendingEvents()).toBe(1);

    await dbHelper.db.update(users).set({ notificationsEnabled: false }).where(eq(users.id, actor.id));

    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    expect((await deliveriesFor(actor.id))[0].status).toBe('SUPPRESSED');
    expect(await notificationCountFor(actor.id)).toBe(1);
  });

  it('suppresses a queued contact push after a Block while preserving the inbox', async () => {
    const ownerToken = token();
    await deviceRegistrationsRepository.register(owner.id, ownerToken, 'ANDROID');
    const post = await insertPost(owner, 'ADOPTION', 'Blocked listing');
    await contactsService.requestContact(actor.id, post.id, 'Interested');
    await waitForDeliveryCount(owner.id, 1);

    await dbHelper.pool.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [actor.id, owner.id]);

    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    expect((await deliveriesFor(owner.id))[0].status).toBe('SUPPRESSED');
    expect(await notificationCountFor(owner.id)).toBe(1);
  });

  it('drops queued workflow pushes when the recipient account is deleted', async () => {
    const actorToken = token();
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'ANDROID');
    const post = await insertPost(actor, 'RESCUE', 'Deleted recipient case');
    await commentsService.createComment(owner.id, {
      postId: post.id,
      text: 'Any news?',
      clientRequestId: generateUuidV7(),
    });
    expect(await discussionProcessor.processPendingEvents()).toBe(1);
    await waitForDeliveryCount(actor.id, 1);

    await dbHelper.db.delete(users).where(eq(users.id, actor.id));

    expect(await deliveryCountFor(actor.id)).toBe(0);
    expect(await notificationCountFor(actor.id)).toBe(0);
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
  });

  it('cancels a queued workflow push when the token is reassigned to another account', async () => {
    const actorToken = token();
    await deviceRegistrationsRepository.register(actor.id, actorToken, 'ANDROID');
    const post = await insertPost(actor, 'RESCUE', 'Token takeover case');
    await commentsService.createComment(owner.id, {
      postId: post.id,
      text: 'Any news?',
      clientRequestId: generateUuidV7(),
    });
    expect(await discussionProcessor.processPendingEvents()).toBe(1);
    await waitForDeliveryCount(actor.id, 1);

    await deviceRegistrationsRepository.register(owner.id, actorToken, 'IOS');

    const [registration] = await dbHelper.db
      .select()
      .from(deviceRegistrations)
      .where(eq(deviceRegistrations.token, actorToken));
    expect(registration.userId).toBe(owner.id);
    expect(await deliveryCountFor(actor.id)).toBe(0);
    expect(await pushProcessor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    expect(await notificationCountFor(actor.id)).toBe(1);
  });
});
