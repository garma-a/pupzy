import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { count, eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  adoptionApplications,
  blocks,
  cities,
  deviceRegistrations,
  notifications,
  posts,
  pushDeliveries,
  users,
  type AdoptionApplication,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { PostsRepository } from '../posts/posts.repository';
import { AdoptionsRepository } from '../adoptions/adoptions.repository';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { UsersResolver } from '../users/users.resolver';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { AccountDeletionService } from '../users/account-deletion.service';
import { CitiesService } from '../cities/cities.service';
import { MediaFinalizationRepository } from '../upload/media-finalization.repository';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsResolver } from './notifications.resolver';
import { DeviceRegistrationsRepository } from './device-registrations.repository';
import { DeviceRegistrationsService } from './device-registrations.service';
import { DeviceRegistrationsResolver } from './device-registrations.resolver';
import { PushDeliveryRepository } from './push-delivery.repository';
import { PUSH_DELIVERY_BATCH_SIZE, MAX_PUSH_DELIVERY_ATTEMPTS, PushDeliveryProcessor } from './push-delivery.processor';
import type { PushDeliveryMessage, PushProvider } from './push.provider';
import { buildPushCollapseId } from './push-payload';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';
import type { App } from 'firebase-admin/app';
import type { UploadService } from '../upload/upload.service';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

const PHONE_ENCRYPTION_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';

const REGISTER_DEVICE = `
  mutation RegisterDevice($input: RegisterDeviceInput!) {
    registerDevice(input: $input) { id platform createdAt updatedAt }
  }
`;

const UNREGISTER_DEVICE = `
  mutation UnregisterDevice($token: String!) {
    unregisterDevice(token: $token)
  }
`;

const UPDATE_PUSH_PREFERENCE = `
  mutation UpdatePushPreference($notificationsEnabled: Boolean!) {
    updateMyNotificationPreferences(notificationsEnabled: $notificationsEnabled) {
      id
      notificationsEnabled
    }
  }
`;

const MY_NOTIFICATIONS = `
  query MyNotifications {
    myNotifications(first: 20) {
      unreadCount
      edges { node { id type title body relatedPostId isRead } }
    }
  }
`;

const APPLICATION_INPUT = {
  livingSituation: 'APARTMENT' as const,
  hasOutdoorAccess: false,
  hasOtherPetsAtHome: false,
  hasChildrenAtHome: false,
  hoursAtHomePerDay: 6,
  previousPetExperience: 'Grew up with dogs and cats',
  whyAdopt: 'I have a stable home and plenty of love to give a rescued pet.',
  consentHomeVisit: true,
  canProvideVetReference: true,
};

interface DeviceRegistrationResult {
  id: string;
  platform: string;
}

interface NotificationNode {
  id: string;
  type: string;
  title: string;
  body: string;
  relatedPostId: string | null;
  isRead: boolean;
}

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
 * Ticket 11 — durable device push delivery, proven end to end with the
 * existing adoption-approval notification.
 *
 * Proves against a real database and a controllable provider boundary:
 * owned registration/unregistration, sign-out, token takeover, opt-out
 * without losing the inbox, send-time Block/account rechecks, bounded
 * retries, dead-token cleanup, per-invocation bounds, deduplication and
 * rollback safety.
 */
describe('Durable adoption-approval push delivery (Ticket 11)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let schema: GraphQLSchema;
  let provider: ControllablePushProvider;
  let processor: PushDeliveryProcessor;
  let notificationsRepository: NotificationsRepository;
  let notificationsService: NotificationsService;
  let notificationsResolver: NotificationsResolver;
  let deviceRegistrationsRepository: DeviceRegistrationsRepository;
  let deviceRegistrationsResolver: DeviceRegistrationsResolver;
  let usersResolver: UsersResolver;
  let adoptionsService: AdoptionsService;
  let pushDeliveryRepository: PushDeliveryRepository;
  let accountDeletionService: AccountDeletionService;
  let mockUploadService: {
    deleteObjects: jest.Mock;
    deletePrefix: jest.Mock;
    getLastUploadGraceUntil: jest.Mock;
  };

  let city: City;
  let owner: User;
  let applicant: User;
  let adoptionPost: Post;
  let application: AdoptionApplication;

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

  async function insertPost(creator: User, title: string): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: creator.id,
        postType: 'ADOPTION',
        title,
        description: 'Adoption push delivery test post',
        cityId: city.id,
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  async function insertApplication(targetPost: Post, candidate: User): Promise<AdoptionApplication> {
    const [created] = await dbHelper.db
      .insert(adoptionApplications)
      .values({
        targetPostId: targetPost.id,
        applicantId: candidate.id,
        status: 'PENDING',
        livingSituation: 'APARTMENT',
        hasOutdoorAccess: false,
        hasOtherPetsAtHome: false,
        hasChildrenAtHome: false,
        hoursAtHomePerDay: 6,
        whyAdopt: 'A stable home with room for one more family member.',
        consentHomeVisit: true,
        canProvideVetReference: true,
      })
      .returning();
    return created;
  }

  async function refetchUser(userId: string): Promise<User> {
    const [user] = await dbHelper.db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  async function notificationCount(recipientId?: string): Promise<number> {
    const [row] = recipientId
      ? await dbHelper.db
          .select({ total: count() })
          .from(notifications)
          .where(eq(notifications.recipientId, recipientId))
      : await dbHelper.db.select({ total: count() }).from(notifications);
    return Number(row?.total ?? 0);
  }

  async function deliveryCount(recipientId: string): Promise<number> {
    const [row] = await dbHelper.db
      .select({ total: count() })
      .from(pushDeliveries)
      .where(eq(pushDeliveries.recipientId, recipientId));
    return Number(row?.total ?? 0);
  }

  async function registrationCount(): Promise<number> {
    const [row] = await dbHelper.db.select({ total: count() }).from(deviceRegistrations);
    return Number(row?.total ?? 0);
  }

  async function waitForDeliveries(recipientId: string, expected: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await deliveryCount(recipientId)) === expected) return;
      await sleep(25);
    }
    expect(await deliveryCount(recipientId)).toBe(expected);
  }

  async function waitForNotificationCount(expected: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await notificationCount()) === expected) return;
      await sleep(25);
    }
    expect(await notificationCount()).toBe(expected);
  }

  /** Retries the whole pending backoff queue immediately for deterministic tests. */
  async function makePendingDeliveriesDue(): Promise<void> {
    await dbHelper.pool.query(`UPDATE push_deliveries SET next_attempt_at = now() WHERE status = 'PENDING'`);
  }

  function contextFor(user?: User): GqlContext {
    return {
      req: {} as GqlContext['req'],
      user,
      loaders: {} as GqlContext['loaders'],
    };
  }

  async function executeGql(
    source: string,
    variables: Record<string, unknown> = {},
    user?: User,
  ): Promise<ExecutionResult> {
    return graphql({ schema, source, variableValues: variables, contextValue: contextFor(user) });
  }

  async function registerDevice(user: User, token: string, platform = 'ANDROID'): Promise<DeviceRegistrationResult> {
    const result = await executeGql(REGISTER_DEVICE, { input: { token, platform } }, user);
    expect(result.errors).toBeUndefined();
    return (result.data as { registerDevice: DeviceRegistrationResult }).registerDevice;
  }

  async function approveAndQueuePush(targetApplication = application): Promise<void> {
    await adoptionsService.approveApplication(owner.id, targetApplication.id);
    await waitForDeliveries(targetApplication.applicantId, 1);
  }

  async function inboxFor(user: User): Promise<NotificationNode[]> {
    const result = await executeGql(MY_NOTIFICATIONS, {}, user);
    expect(result.errors).toBeUndefined();
    return (result.data as { myNotifications: { edges: Array<{ node: NotificationNode }> } }).myNotifications.edges.map(
      (edge) => edge.node,
    );
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
        if (key === 'ACCOUNT_DELETION_ENABLED') return true;
        return undefined;
      }),
    } as unknown as ConfigService;

    const isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    const postsRepository = new PostsRepository(dbHelper.db, undefined, isolationPolicy);
    const usersRepository = new UsersRepository(dbHelper.db);
    const accountDeletionRepository = new AccountDeletionRepository(dbHelper.db);
    const citiesService = { findById: jest.fn(), findNearest: jest.fn() } as unknown as CitiesService;
    const usersService = new UsersService(
      usersRepository,
      citiesService,
      accountDeletionRepository,
      mockConfig,
      mockCache,
    );
    usersResolver = new UsersResolver(usersService, undefined as never);

    pushDeliveryRepository = new PushDeliveryRepository(dbHelper.db);
    notificationsRepository = new NotificationsRepository(dbHelper.db, isolationPolicy, pushDeliveryRepository);
    notificationsService = new NotificationsService(notificationsRepository);
    notificationsResolver = new NotificationsResolver(notificationsService);

    deviceRegistrationsRepository = new DeviceRegistrationsRepository(dbHelper.db);
    const deviceRegistrationsService = new DeviceRegistrationsService(deviceRegistrationsRepository);
    deviceRegistrationsResolver = new DeviceRegistrationsResolver(deviceRegistrationsService);

    provider = new ControllablePushProvider();
    processor = new PushDeliveryProcessor(dbHelper.db, provider, isolationPolicy);

    adoptionsService = new AdoptionsService(
      new AdoptionsRepository(dbHelper.db),
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );

    mockUploadService = {
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      deletePrefix: jest.fn().mockResolvedValue(1),
      getLastUploadGraceUntil: jest.fn().mockResolvedValue(null),
    };
    accountDeletionService = new AccountDeletionService(
      accountDeletionRepository,
      usersRepository,
      mockUploadService as unknown as UploadService,
      mockConfig,
      {} as unknown as App,
      dbHelper.db,
      mockCache,
      new MediaFinalizationRepository(dbHelper.db),
    );

    const schemaFiles = [
      'src/common/graphql/enums.graphql',
      'src/users/users.graphql',
      'src/cities/cities.graphql',
      'src/posts/posts-enums.graphql',
      'src/posts/posts.graphql',
      'src/mating/mating.graphql',
      'src/upload/upload.graphql',
      'src/comments/comments.graphql',
      'src/notifications/notifications.graphql',
      'src/notifications/device-registrations.graphql',
      'src/contacts/contacts.graphql',
      'src/adoptions/adoptions.graphql',
    ];
    const typeDefs = schemaFiles.map((relativePath) =>
      fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8'),
    );
    schema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue(value: unknown) {
            return value;
          },
          __serialize(value: unknown) {
            return value instanceof Date ? value.toISOString() : value;
          },
        },
        Query: {
          myNotifications: (_root: unknown, args: { first?: number; after?: string }, context: GqlContext) =>
            notificationsResolver.myNotifications(args.first, args.after, context),
        },
        Mutation: {
          registerDevice: (_root: unknown, args: { input: unknown }, context: GqlContext) =>
            deviceRegistrationsResolver.registerDevice(args.input, context),
          unregisterDevice: (_root: unknown, args: { token: string }, context: GqlContext) =>
            deviceRegistrationsResolver.unregisterDevice(args.token, context),
          updateMyNotificationPreferences: (
            _root: unknown,
            args: { notificationsEnabled: boolean },
            context: GqlContext,
          ) => usersResolver.updateMyNotificationPreferences(args.notificationsEnabled, context),
        },
      },
    });
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
    applicant = await insertUser('Applicant', { languagePreference: 'ar' });
    adoptionPost = await insertPost(owner, 'Lovely puppy for adoption');
    application = await insertApplication(adoptionPost, applicant);
  });

  it('registers owned devices idempotently and never unregisters another account registration', async () => {
    const token = `fcm-token-${generateUuidV7()}`;

    const first = await registerDevice(applicant, token);
    expect(first.platform).toBe('ANDROID');

    const second = await registerDevice(applicant, token);
    expect(second.id).toBe(first.id);
    expect(await registrationCount()).toBe(1);

    const [stored] = await dbHelper.db.select().from(deviceRegistrations);
    expect(stored.userId).toBe(applicant.id);

    // Another account cannot remove it, and cannot take ownership by unregistering.
    const foreignUnregister = await executeGql(UNREGISTER_DEVICE, { token }, owner);
    expect(foreignUnregister.errors).toBeUndefined();
    expect((foreignUnregister.data as { unregisterDevice: boolean }).unregisterDevice).toBe(false);
    expect(await registrationCount()).toBe(1);
    expect((await dbHelper.db.select().from(deviceRegistrations))[0].userId).toBe(applicant.id);

    const ownUnregister = await executeGql(UNREGISTER_DEVICE, { token }, applicant);
    expect(ownUnregister.errors).toBeUndefined();
    expect((ownUnregister.data as { unregisterDevice: boolean }).unregisterDevice).toBe(true);
    expect(await registrationCount()).toBe(0);

    // Unknown token is an idempotent no-op.
    const unknown = await executeGql(UNREGISTER_DEVICE, { token }, applicant);
    expect((unknown.data as { unregisterDevice: boolean }).unregisterDevice).toBe(false);
  });

  it('rejects empty tokens and unknown platforms', async () => {
    const emptyToken = await executeGql(REGISTER_DEVICE, { input: { token: '   ', platform: 'ANDROID' } }, applicant);
    expect(emptyToken.errors?.map((error) => error.message).join(' ')).toMatch(/token/i);
    expect(await registrationCount()).toBe(0);

    const unknownPlatform = await executeGql(
      REGISTER_DEVICE,
      { input: { token: 'some-token', platform: 'WINDOWS' } },
      applicant,
    );
    expect(unknownPlatform.errors).toBeDefined();
    expect(await registrationCount()).toBe(0);
  });

  it('delivers a localized adoption approval to the registered device and keeps the inbox', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);

    await approveAndQueuePush();

    const [queued] = await dbHelper.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.recipientId, applicant.id));
    expect(queued.status).toBe('PENDING');
    expect(queued.actorId).toBe(owner.id);

    // The durable intent references a persisted notification, never a rollback.
    const [persisted] = await dbHelper.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, queued.notificationId));
    expect(persisted.type).toBe('ADOPTION_APPLICATION_APPROVED');

    expect(await processor.processPendingDeliveries()).toBe(1);
    expect(provider.sent).toHaveLength(1);

    const message = provider.sent[0];
    expect(message.token).toBe(token);
    expect(message.title).toBe(persisted.titleArabic);
    expect(message.body).toBe(persisted.bodyArabic);
    expect(message.data).toMatchObject({
      notificationId: persisted.id,
      type: 'ADOPTION_APPLICATION_APPROVED',
      relatedPostId: adoptionPost.id,
      relatedApplicationId: application.id,
    });
    expect(message.collapseId).toBe(buildPushCollapseId(persisted));

    const [delivered] = await dbHelper.db.select().from(pushDeliveries);
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();

    // Inbox rendering follows the same stored columns as push.
    const inbox = await inboxFor(applicant);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].title).toBe(persisted.titleArabic);
    expect(inbox[0].relatedPostId).toBe(adoptionPost.id);

    // Delivered work never repeats.
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
  });

  it('enqueues durable push for every adoption workflow notification (Ticket 20)', async () => {
    await registerDevice(owner, `fcm-token-${generateUuidV7()}`);
    await registerDevice(applicant, `fcm-token-${generateUuidV7()}`);

    const notificationPost = await insertPost(owner, 'Another adoption listing');
    const submitted = await adoptionsService.submitApplication(applicant.id, {
      targetPostId: notificationPost.id,
      ...APPLICATION_INPUT,
    });
    await waitForNotificationCount(1);
    await waitForDeliveries(owner.id, 1);

    const [received] = await dbHelper.db.select().from(notifications).where(eq(notifications.recipientId, owner.id));
    expect(received.type).toBe('ADOPTION_APPLICATION_RECEIVED');
    const [ownerDelivery] = await dbHelper.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.recipientId, owner.id));
    expect(ownerDelivery.notificationId).toBe(received.id);
    expect(ownerDelivery.actorId).toBe(applicant.id);

    // The approval enqueues for its recipient without duplicating the owner's.
    await adoptionsService.approveApplication(owner.id, submitted.id);
    await waitForDeliveries(applicant.id, 1);
    expect(await deliveryCount(owner.id)).toBe(1);
  });

  it('respects opt-out by suppressing push while preserving the inbox', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);

    const disabled = await executeGql(UPDATE_PUSH_PREFERENCE, { notificationsEnabled: false }, applicant);
    expect(disabled.errors).toBeUndefined();
    expect(
      (disabled.data as { updateMyNotificationPreferences: { notificationsEnabled: boolean } })
        .updateMyNotificationPreferences.notificationsEnabled,
    ).toBe(false);
    expect((await refetchUser(applicant.id)).notificationsEnabled).toBe(false);

    await approveAndQueuePush();

    // Delayed opt-out also suppresses work that was already queued.
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);

    const [suppressed] = await dbHelper.db.select().from(pushDeliveries);
    expect(suppressed.status).toBe('SUPPRESSED');

    const inbox = await inboxFor(applicant);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe('ADOPTION_APPLICATION_APPROVED');

    // Re-enabling never resurrects terminally suppressed work.
    const enabled = await executeGql(UPDATE_PUSH_PREFERENCE, { notificationsEnabled: true }, applicant);
    expect(enabled.errors).toBeUndefined();
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
  });

  it('suppresses queued push after a Block commits while keeping the notification', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: applicant.id });

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    expect((await dbHelper.db.select().from(pushDeliveries))[0].status).toBe('SUPPRESSED');
    expect(await notificationCount(applicant.id)).toBe(1);
  });

  it('suppresses queued push when the recipient account becomes unavailable', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    await dbHelper.db.update(users).set({ isBanned: true, banReason: 'TEST' }).where(eq(users.id, applicant.id));

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    expect((await dbHelper.db.select().from(pushDeliveries))[0].status).toBe('SUPPRESSED');
  });

  it('removes queued work when the device signs out', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const unregistered = await executeGql(UNREGISTER_DEVICE, { token }, applicant);
    expect((unregistered.data as { unregisterDevice: boolean }).unregisterDevice).toBe(true);

    expect(await registrationCount()).toBe(0);
    expect(await deliveryCount(applicant.id)).toBe(0);
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    // The inbox survives sign-out.
    expect(await notificationCount(applicant.id)).toBe(1);
  });

  it('prevents a reassigned token from receiving the previous account notifications', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    // A new account takes the token over through registration.
    await registerDevice(owner, token);
    const [registration] = await dbHelper.db
      .select()
      .from(deviceRegistrations)
      .where(eq(deviceRegistrations.token, token));
    expect(registration.userId).toBe(owner.id);
    expect(await deliveryCount(applicant.id)).toBe(0);
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);

    // Even a takeover that bypasses registration cleanup is caught by the
    // worker's ownership recheck before any send.
    const secondToken = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, secondToken);
    const secondPost = await insertPost(owner, 'Second adoption listing');
    const secondApplication = await insertApplication(secondPost, applicant);
    await approveAndQueuePush(secondApplication);
    await dbHelper.db
      .update(deviceRegistrations)
      .set({ userId: owner.id })
      .where(eq(deviceRegistrations.token, secondToken));

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
    const [suppressed] = await dbHelper.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.recipientId, applicant.id));
    expect(suppressed.status).toBe('SUPPRESSED');
  });

  it('retries transient provider failures with backoff and delivers later', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    provider.failures.push(
      Object.assign(new Error('temporarily unavailable'), { code: 'messaging/server-unavailable' }),
    );

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
    const [retryable] = await dbHelper.db.select().from(pushDeliveries);
    expect(retryable.status).toBe('PENDING');
    expect(retryable.attempts).toBe(1);
    expect(retryable.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(retryable.lastError).toContain('messaging/server-unavailable');

    await makePendingDeliveriesDue();
    expect(await processor.processPendingDeliveries()).toBe(1);
    expect(provider.attempted).toBe(2);
    expect((await dbHelper.db.select().from(pushDeliveries))[0].status).toBe('DELIVERED');
  });

  it('stops after the bounded attempt limit', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    provider.alwaysFail = Object.assign(new Error('provider down'), { code: 'messaging/internal-error' });

    for (let attempt = 1; attempt <= MAX_PUSH_DELIVERY_ATTEMPTS; attempt++) {
      await processor.processPendingDeliveries();
      await makePendingDeliveriesDue();
    }

    expect(provider.attempted).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);
    const [failed] = await dbHelper.db.select().from(pushDeliveries);
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);

    await processor.processPendingDeliveries();
    expect(provider.attempted).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);
  });

  it('cleans a dead token and its queued intents', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    provider.alwaysFail = Object.assign(new Error('not registered'), {
      code: 'messaging/registration-token-not-registered',
    });

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
    expect(await registrationCount()).toBe(0);
    expect(await deliveryCount(applicant.id)).toBe(0);

    // Once the dead token is gone its intents cannot retry or leak.
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(1);
  });

  it('reclaims an interrupted delivery only after its lease expires', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const [queued] = await dbHelper.db.select().from(pushDeliveries);
    const leaseToken = generateUuidV7();
    await dbHelper.db
      .update(pushDeliveries)
      .set({
        status: 'PROCESSING',
        attempts: 1,
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      })
      .where(eq(pushDeliveries.id, queued.id));

    // A live lease belongs to another worker.
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);

    await dbHelper.db
      .update(pushDeliveries)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(pushDeliveries.id, queued.id));

    expect(await processor.processPendingDeliveries()).toBe(1);
    expect(provider.attempted).toBe(1);
    expect((await dbHelper.db.select().from(pushDeliveries))[0].status).toBe('DELIVERED');
  });

  it('terminalizes an interrupted delivery that exhausted its attempt bound without sending again', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const [queued] = await dbHelper.db.select().from(pushDeliveries);
    await dbHelper.db
      .update(pushDeliveries)
      .set({
        status: 'PROCESSING',
        attempts: MAX_PUSH_DELIVERY_ATTEMPTS,
        leaseToken: generateUuidV7(),
        leaseExpiresAt: new Date(Date.now() - 60_000),
        lastError: 'provider down',
      })
      .where(eq(pushDeliveries.id, queued.id));

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);

    const [failed] = await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.id, queued.id));
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);
    expect(failed.leaseToken).toBeNull();
    expect(failed.leaseExpiresAt).toBeNull();
    expect(failed.lastError).toContain('lease expired');

    // The terminal intent never wakes up again.
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
  });

  it('reclaims an interrupted delivery while attempts remain and increments to the bound', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const [queued] = await dbHelper.db.select().from(pushDeliveries);
    await dbHelper.db
      .update(pushDeliveries)
      .set({
        status: 'PROCESSING',
        attempts: MAX_PUSH_DELIVERY_ATTEMPTS - 1,
        leaseToken: generateUuidV7(),
        leaseExpiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(pushDeliveries.id, queued.id));

    expect(await processor.processPendingDeliveries()).toBe(1);
    expect(provider.attempted).toBe(1);

    const [delivered] = await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.id, queued.id));
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.attempts).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);
  });

  it('leaves unexpired interrupted and pending intents outside the exhausted-lease sweep', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const [interrupted] = await dbHelper.db.select().from(pushDeliveries);
    const liveLeaseToken = generateUuidV7();
    await dbHelper.db
      .update(pushDeliveries)
      .set({
        status: 'PROCESSING',
        attempts: MAX_PUSH_DELIVERY_ATTEMPTS,
        leaseToken: liveLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      })
      .where(eq(pushDeliveries.id, interrupted.id));

    // A second, normal pending intent still flows in the same invocation.
    const secondPost = await insertPost(owner, 'Lease sweep isolation listing');
    const secondApplication = await insertApplication(secondPost, applicant);
    await adoptionsService.approveApplication(owner.id, secondApplication.id);
    await waitForDeliveries(applicant.id, 2);

    expect(await processor.processPendingDeliveries()).toBe(1);
    expect(provider.attempted).toBe(1);

    const [stillInterrupted] = await dbHelper.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.id, interrupted.id));
    expect(stillInterrupted.status).toBe('PROCESSING');
    expect(stillInterrupted.attempts).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);
    expect(stillInterrupted.leaseToken).toBe(liveLeaseToken);
    expect(stillInterrupted.lastError).toBeNull();

    const delivered = (await dbHelper.db.select().from(pushDeliveries)).filter((row) => row.id !== interrupted.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].status).toBe('DELIVERED');
  });

  it('never claims a pending intent that already reached the attempt bound', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const [queued] = await dbHelper.db.select().from(pushDeliveries);
    await dbHelper.db
      .update(pushDeliveries)
      .set({ attempts: MAX_PUSH_DELIVERY_ATTEMPTS, nextAttemptAt: new Date(Date.now() - 60_000) })
      .where(eq(pushDeliveries.id, queued.id));

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);

    const [untouched] = await dbHelper.db.select().from(pushDeliveries).where(eq(pushDeliveries.id, queued.id));
    expect(untouched.status).toBe('PENDING');
    expect(untouched.attempts).toBe(MAX_PUSH_DELIVERY_ATTEMPTS);
  });

  it('bounds one invocation to PUSH_DELIVERY_BATCH_SIZE delivers', async () => {
    const devices = Array.from({ length: PUSH_DELIVERY_BATCH_SIZE + 1 }, (_, index) => ({
      userId: applicant.id,
      token: `fcm-token-${index}-${generateUuidV7()}`,
      platform: 'ANDROID' as const,
    }));
    await dbHelper.db.insert(deviceRegistrations).values(devices);

    await adoptionsService.approveApplication(owner.id, application.id);
    await waitForDeliveries(applicant.id, PUSH_DELIVERY_BATCH_SIZE + 1);

    expect(await processor.processPendingDeliveries()).toBe(PUSH_DELIVERY_BATCH_SIZE);
    expect(provider.sent).toHaveLength(PUSH_DELIVERY_BATCH_SIZE);

    expect(await processor.processPendingDeliveries()).toBe(1);
    expect(provider.sent).toHaveLength(PUSH_DELIVERY_BATCH_SIZE + 1);

    expect(await processor.processPendingDeliveries()).toBe(0);
  });

  it('never sends a notification whose transaction rolled back', async () => {
    await registerDevice(applicant, `fcm-token-${generateUuidV7()}`);

    await expect(
      dbHelper.db.transaction(async (tx) => {
        const notification = await notificationsRepository.create(
          {
            recipientId: applicant.id,
            type: 'ADOPTION_APPLICATION_APPROVED',
            title: 'Rolled back approval',
            body: 'This notification must never exist',
            relatedPostId: adoptionPost.id,
          },
          tx,
        );
        await pushDeliveryRepository.enqueueForNotification(notification, owner.id, tx);
        throw new Error('simulated rollback');
      }),
    ).rejects.toThrow('simulated rollback');

    expect(await notificationCount()).toBe(0);
    expect(await deliveryCount(applicant.id)).toBe(0);
    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
  });

  it('removes registrations and queued intents during Account Deletion', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const authModule = require('firebase-admin/auth');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (authModule.getAuth as jest.Mock).mockReturnValue({
      deleteUser: jest.fn().mockResolvedValue(undefined),
    });

    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    const deletion = await accountDeletionService.initiateDeletion(applicant, Math.floor(Date.now() / 1000));
    expect(deletion.status).toBe('COMPLETED');

    expect(await dbHelper.db.select().from(users).where(eq(users.id, applicant.id))).toHaveLength(0);
    expect(await registrationCount()).toBe(0);
    expect(await deliveryCount(applicant.id)).toBe(0);

    expect(await processor.processPendingDeliveries()).toBe(0);
    expect(provider.attempted).toBe(0);
  });

  it('keeps the durable intent tied to notifications across a restart-style drain', async () => {
    const token = `fcm-token-${generateUuidV7()}`;
    await registerDevice(applicant, token);
    await approveAndQueuePush();

    // A fresh processor instance resumes the durable work after a crash.
    const restartedProcessor = new PushDeliveryProcessor(
      dbHelper.db,
      provider,
      new AccountIsolationPolicy(dbHelper.db),
    );
    expect(await restartedProcessor.processPendingDeliveries()).toBe(1);
    expect(provider.sent).toHaveLength(1);

    const [delivered] = await dbHelper.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.recipientId, applicant.id));
    expect(delivered.status).toBe('DELIVERED');
    const [notification] = await dbHelper.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, delivered.notificationId));
    expect(notification.type).toBe('ADOPTION_APPLICATION_APPROVED');
    expect(notification.title.length).toBeGreaterThan(0);
  });
});
