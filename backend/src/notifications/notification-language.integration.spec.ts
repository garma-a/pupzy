import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { count, eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
  cities,
  discussionNotificationEvents,
  notifications,
  posts,
  users,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { PostsRepository } from '../posts/posts.repository';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { CommentsResolver } from '../comments/comments.resolver';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ContactsService } from '../contacts/contacts.service';
import { ContactsResolver } from '../contacts/contacts.resolver';
import { AdoptionsRepository } from '../adoptions/adoptions.repository';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { AdoptionsResolver } from '../adoptions/adoptions.resolver';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { UsersResolver } from '../users/users.resolver';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { CitiesService } from '../cities/cities.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsResolver } from './notifications.resolver';
import { DiscussionNotificationProcessor } from './discussion-notification.processor';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { buildNotificationContent, resolveNotificationLanguage } from './notification-templates';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

const PHONE_ENCRYPTION_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';

const MY_NOTIFICATIONS = `
  query MyNotifications {
    myNotifications(first: 20) {
      unreadCount
      edges { node { id type title body relatedPostId relatedCommentId isRead } }
    }
  }
`;

const UPDATE_LANGUAGE = `
  mutation UpdateLanguage($languagePreference: Language!) {
    updateMyLanguagePreference(languagePreference: $languagePreference) {
      id
      languagePreference
    }
  }
`;

const MARK_READ = `
  mutation MarkRead($notificationId: ID!) {
    markNotificationRead(notificationId: $notificationId) { id title body isRead }
  }
`;

const CREATE_COMMENT = `
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) { id postId parentId text }
  }
`;

const CREATE_REPLY = `
  mutation CreateReply($input: CreateReplyInput!) {
    createReply(input: $input) { id postId parentId text }
  }
`;

const TOGGLE_BOOST = `
  mutation ToggleBoost($commentId: ID!) {
    toggleCommentBoost(commentId: $commentId) { commentId isBoostedByMe boostCount }
  }
`;

const PIN_COMMENT = `
  mutation PinComment($commentId: ID!) {
    pinComment(commentId: $commentId) { id postId }
  }
`;

const REQUEST_CONTACT = `
  mutation RequestContact($postId: ID!, $message: String!) {
    requestContact(postId: $postId, message: $message) { id }
  }
`;

const SUBMIT_APPLICATION = `
  mutation SubmitApplication($input: SubmitAdoptionApplicationInput!) {
    submitAdoptionApplication(input: $input) { id }
  }
`;

const APPLICATION_INPUT = {
  livingSituation: 'APARTMENT',
  hasOutdoorAccess: false,
  hasOtherPetsAtHome: false,
  hasChildrenAtHome: false,
  hoursAtHomePerDay: 6,
  previousPetExperience: 'Grew up with dogs and cats',
  whyAdopt: 'I have a stable home and plenty of love to give a rescued pet.',
  consentHomeVisit: true,
  canProvideVetReference: true,
};

interface NotificationNode {
  id: string;
  type: string;
  title: string;
  body: string;
  relatedPostId: string | null;
  relatedCommentId: string | null;
  isRead: boolean;
}

interface MyNotificationsResult {
  myNotifications: { unreadCount: number; edges: Array<{ node: NotificationNode }> };
}

interface UpdateLanguageResult {
  updateMyLanguagePreference: { id: string; languagePreference: string | null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ticket 07 — notifications in the explicitly synchronized language.
 *
 * Proves against a real database that:
 * - the historic `ar` default is distinguishable from an explicit choice and
 *   is cleared for legacy rows so unsynchronized accounts receive English;
 * - existing notification types render from the centralized bilingual
 *   templates, while legacy English-only rows safely fall back to English;
 * - switching the preference re-renders existing rows;
 * - Block suppression still holds for both immediate and durable creation.
 */
describe('Notification language synchronization (Ticket 07)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let schema: GraphQLSchema;
  let usersService: UsersService;
  let usersResolver: UsersResolver;
  let notificationsService: NotificationsService;
  let notificationsResolver: NotificationsResolver;
  let notificationsRepository: NotificationsRepository;
  let contactsService: ContactsService;
  let adoptionsService: AdoptionsService;
  let commentProcessor: DiscussionNotificationProcessor;
  let isolationPolicy: AccountIsolationPolicy;

  let city: City;
  let owner: User;
  let actor: User;
  let unsyncedOwner: User;
  let rescuePost: Post;
  let adoptionPost: Post;

  async function insertUser(label: string, languagePreference?: 'ar' | 'en' | null): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@example.com`,
        fullName: label,
        ...(languagePreference === undefined ? {} : { languagePreference }),
      })
      .returning();
    return user;
  }

  async function insertPost(creator: User, postType: 'RESCUE' | 'ADOPTION', title: string): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: creator.id,
        postType,
        title,
        description: 'Notification language test post',
        cityId: city.id,
        status: 'ACTIVE',
        ...(postType === 'RESCUE' ? { urgency: 'URGENT' } : {}),
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  async function refetchUser(userId: string): Promise<User> {
    const [user] = await dbHelper.db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  async function notificationCount(): Promise<number> {
    const [row] = await dbHelper.db.select({ total: count() }).from(notifications);
    return Number(row?.total ?? 0);
  }

  async function waitForNotificationCount(expected: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await notificationCount()) === expected) return;
      await sleep(25);
    }
    expect(await notificationCount()).toBe(expected);
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

  async function inboxFor(user: User): Promise<NotificationNode[]> {
    const result = await executeGql(MY_NOTIFICATIONS, {}, user);
    expect(result.errors).toBeUndefined();
    return (result.data as unknown as MyNotificationsResult).myNotifications.edges.map((edge) => edge.node);
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
      get: jest.fn((key: string) => (key === 'PHONE_ENCRYPTION_KEY' ? PHONE_ENCRYPTION_KEY : undefined)),
    } as unknown as ConfigService;

    isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    const postsRepository = new PostsRepository(dbHelper.db, undefined, isolationPolicy);
    const usersRepository = new UsersRepository(dbHelper.db);
    const accountDeletionRepository = new AccountDeletionRepository(dbHelper.db);
    const citiesService = new CitiesService(new CitiesRepository(dbHelper.db), mockCache);
    usersService = new UsersService(usersRepository, citiesService, accountDeletionRepository, mockConfig, mockCache);
    usersResolver = new UsersResolver(usersService, undefined as never);

    notificationsRepository = new NotificationsRepository(dbHelper.db, isolationPolicy);
    notificationsService = new NotificationsService(notificationsRepository);
    notificationsResolver = new NotificationsResolver(notificationsService);

    contactsService = new ContactsService(
      new ContactsRepository(dbHelper.db),
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );
    adoptionsService = new AdoptionsService(
      new AdoptionsRepository(dbHelper.db),
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );
    const contactsResolver = new ContactsResolver(contactsService);
    const adoptionsResolver = new AdoptionsResolver(adoptionsService);

    const commentsRepository = new CommentsRepository(dbHelper.db, undefined, isolationPolicy);
    const commentsService = new CommentsService(
      commentsRepository,
      postsRepository,
      undefined as never,
      mockConfig,
      undefined,
      undefined,
      undefined,
      isolationPolicy,
    );
    const commentsResolver = new CommentsResolver(commentsService);
    commentProcessor = new DiscussionNotificationProcessor(dbHelper.db, isolationPolicy);

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
          myUnreadNotificationCount: (_root: unknown, _args: unknown, context: GqlContext) =>
            notificationsResolver.myUnreadNotificationCount(context),
        },
        Mutation: {
          updateMyLanguagePreference: (_root: unknown, args: { languagePreference: string }, context: GqlContext) =>
            usersResolver.updateMyLanguagePreference(args.languagePreference, context),
          markNotificationRead: (_root: unknown, args: { notificationId: string }, context: GqlContext) =>
            notificationsResolver.markNotificationRead(args.notificationId, context),
          createComment: (_root: unknown, args: { input: unknown }, context: GqlContext) =>
            commentsResolver.createComment(args.input, context),
          createReply: (_root: unknown, args: { input: unknown }, context: GqlContext) =>
            commentsResolver.createReply(args.input, context),
          toggleCommentBoost: (_root: unknown, args: { commentId: string }, context: GqlContext) =>
            commentsResolver.toggleCommentBoost(args.commentId, context),
          pinComment: (_root: unknown, args: { commentId: string }, context: GqlContext) =>
            commentsResolver.pinComment(args.commentId, context),
          requestContact: (_root: unknown, args: { postId: string; message: string }, context: GqlContext) =>
            contactsResolver.requestContact(args.postId, args.message, context),
          submitAdoptionApplication: (_root: unknown, args: { input: unknown }, context: GqlContext) =>
            adoptionsResolver.submitAdoptionApplication(args.input, context),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();

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

    owner = await insertUser('Post Owner', 'ar');
    actor = await insertUser('Actor');
    unsyncedOwner = await insertUser('Unsynced Owner');
    rescuePost = await insertPost(owner, 'RESCUE', 'Injured stray dog');
    adoptionPost = await insertPost(owner, 'ADOPTION', 'Lovely puppy for adoption');
  });

  it('synchronizes an explicit language through the profile operations and rejects unknown values', async () => {
    const unsynced = await insertUser('Language Chooser');
    expect(unsynced.languagePreference).toBeNull();

    const switched = await executeGql(UPDATE_LANGUAGE, { languagePreference: 'ar' }, unsynced);
    expect(switched.errors).toBeUndefined();
    expect((switched.data as unknown as UpdateLanguageResult).updateMyLanguagePreference).toMatchObject({
      id: unsynced.id,
      languagePreference: 'ar',
    });

    const [stored] = await dbHelper.db.select().from(users).where(eq(users.id, unsynced.id));
    expect(stored.languagePreference).toBe('ar');

    const switchedBack = await executeGql(UPDATE_LANGUAGE, { languagePreference: 'en' }, stored);
    expect(switchedBack.errors).toBeUndefined();
    expect((await refetchUser(unsynced.id)).languagePreference).toBe('en');

    const rejected = await executeGql(UPDATE_LANGUAGE, { languagePreference: 'fr' }, stored);
    expect(rejected.errors).toBeDefined();
    expect((await refetchUser(unsynced.id)).languagePreference).toBe('en');
  });

  it('synchronizes the language during onboarding without changing existing onboarding inputs', async () => {
    const onboarding = await insertUser('Onboarding User');

    await usersService.completeProfile(onboarding.id, {
      fullName: 'Onboarding User',
      phoneNumber: '+201012345678',
      cityId: city.id,
      languagePreference: 'ar',
    });

    expect((await refetchUser(onboarding.id)).languagePreference).toBe('ar');

    const other = await insertUser('Compatible Onboarding User');
    await usersService.completeProfile(other.id, {
      fullName: 'Compatible Onboarding User',
      phoneNumber: '+201012345679',
      cityId: city.id,
    });

    expect((await refetchUser(other.id)).languagePreference).toBeNull();
  });

  it('clears the historic Arabic default so legacy accounts fall back to English', async () => {
    await dbHelper.pool.query(`ALTER TABLE users ALTER COLUMN language_preference SET DEFAULT 'ar'`);
    try {
      const legacyUser = await insertUser('Legacy User');
      expect(legacyUser.languagePreference).toBe('ar');

      const migrationSql = fs.readFileSync(
        path.resolve(__dirname, '../../drizzle/migrations/0045_add_bilingual_notification_content.sql'),
        'utf8',
      );
      await dbHelper.pool.query(migrationSql);

      const legacyRow = await refetchUser(legacyUser.id);
      expect(legacyRow.languagePreference).toBeNull();
      expect(resolveNotificationLanguage(legacyRow.languagePreference)).toBe('en');

      await dbHelper.db.insert(notifications).values({
        recipientId: legacyUser.id,
        type: 'NEW_UPVOTE',
        ...buildNotificationContent('NEW_UPVOTE', { actorName: 'Ahmed', postTitle: 'Missing cat' }),
      });
      const [node] = await inboxFor(legacyRow);
      expect(node.title).toBe('New upvote');
      expect(node.body).toBe('Ahmed upvoted your post "Missing cat"');
    } finally {
      await dbHelper.pool.query(`ALTER TABLE users ALTER COLUMN language_preference DROP DEFAULT`);
    }
  });

  it('renders immediate interaction notifications in the recipient language and re-renders after a change', async () => {
    const contactResult = await executeGql(
      REQUEST_CONTACT,
      { postId: rescuePost.id, message: 'I can help this dog' },
      actor,
    );
    expect(contactResult.errors).toBeUndefined();

    const applicationResult = await executeGql(
      SUBMIT_APPLICATION,
      { input: { targetPostId: adoptionPost.id, ...APPLICATION_INPUT } },
      actor,
    );
    expect(applicationResult.errors).toBeUndefined();

    // Notification creation is fire-and-forget; wait for both durable rows.
    await waitForNotificationCount(2);

    const arabicInbox = await inboxFor(owner);
    expect(arabicInbox).toHaveLength(2);
    const contactNotification = arabicInbox.find((node) => node.type === 'CONTACT_REQUEST_RECEIVED');
    const applicationNotification = arabicInbox.find((node) => node.type === 'ADOPTION_APPLICATION_RECEIVED');
    expect(contactNotification?.title).toBe('طلب تواصل جديد');
    expect(contactNotification?.body).toContain('Actor');
    expect(contactNotification?.body).toContain('Injured stray dog');
    expect(contactNotification?.relatedPostId).toBe(rescuePost.id);
    expect(applicationNotification?.title).toBe('طلب تبنٍّ جديد');
    expect(applicationNotification?.body).toContain('Lovely puppy for adoption');
    expect(applicationNotification?.relatedPostId).toBe(adoptionPost.id);

    // The unsynchronized owner keeps receiving English from the same creation path.
    const unsyncedPost = await insertPost(unsyncedOwner, 'RESCUE', 'Unsynced owner rescue post');
    const unsyncedResult = await executeGql(
      REQUEST_CONTACT,
      { postId: unsyncedPost.id, message: 'English fallback check' },
      actor,
    );
    expect(unsyncedResult.errors).toBeUndefined();
    await waitForNotificationCount(3);
    const englishInbox = await inboxFor(unsyncedOwner);
    expect(englishInbox).toHaveLength(1);
    expect(englishInbox[0].title).toBe('New contact request');

    // An explicit switch re-renders rows that were created earlier.
    const ownerRow = await refetchUser(owner.id);
    const switched = await executeGql(UPDATE_LANGUAGE, { languagePreference: 'en' }, ownerRow);
    expect(switched.errors).toBeUndefined();
    const reRendered = await inboxFor(await refetchUser(owner.id));
    expect(reRendered.find((node) => node.type === 'CONTACT_REQUEST_RECEIVED')?.title).toBe('New contact request');
    expect(reRendered.find((node) => node.type === 'ADOPTION_APPLICATION_RECEIVED')?.title).toBe(
      'New adoption application',
    );
  });

  it('serves the administrator Post Resolution notification the admin service persists in the recipient language', async () => {
    const arabicContent = buildNotificationContent('POST_RESOLVED_BY_ADMIN', {
      postTitle: adoptionPost.title,
      outcome: 'ADOPTED',
    });
    await notificationsRepository.create({
      recipientId: owner.id,
      type: 'POST_RESOLVED_BY_ADMIN',
      ...arabicContent,
      relatedPostId: adoptionPost.id,
    });

    const englishContent = buildNotificationContent('POST_RESOLVED_BY_ADMIN', {
      postTitle: rescuePost.title,
      outcome: 'RESOLVED',
    });
    await notificationsRepository.create({
      recipientId: unsyncedOwner.id,
      type: 'POST_RESOLVED_BY_ADMIN',
      ...englishContent,
      relatedPostId: rescuePost.id,
    });

    const arabicInbox = await inboxFor(owner);
    expect(arabicInbox).toHaveLength(1);
    expect(arabicInbox[0]).toMatchObject({
      type: 'POST_RESOLVED_BY_ADMIN',
      title: 'تم تسجيل نتيجة المنشور',
      relatedPostId: adoptionPost.id,
      isRead: false,
    });
    expect(arabicInbox[0].body).toContain(adoptionPost.title);
    expect(arabicInbox[0].body).toContain('تم التبني');

    const englishInbox = await inboxFor(unsyncedOwner);
    expect(englishInbox).toHaveLength(1);
    expect(englishInbox[0]).toMatchObject({
      type: 'POST_RESOLVED_BY_ADMIN',
      title: 'Post outcome recorded',
      relatedPostId: rescuePost.id,
    });
    expect(englishInbox[0].body).toBe(`An administrator marked your post "${rescuePost.title}" as resolved.`);
  });

  it('renders every durable discussion notification type bilingually and marks reads in the chosen language', async () => {
    const commenter = await insertUser('Arabic Commenter', 'ar');

    const commentResult = await executeGql(
      CREATE_COMMENT,
      { input: { postId: rescuePost.id, text: 'I saw this dog', clientRequestId: `comment-${generateUuidV7()}` } },
      commenter,
    );
    expect(commentResult.errors).toBeUndefined();
    const commentId = (commentResult.data as { createComment: { id: string } }).createComment.id;

    const replyResult = await executeGql(
      CREATE_REPLY,
      { input: { commentId, text: 'Thank you', clientRequestId: `reply-${generateUuidV7()}` } },
      owner,
    );
    expect(replyResult.errors).toBeUndefined();

    const boostResult = await executeGql(TOGGLE_BOOST, { commentId }, owner);
    expect(boostResult.errors).toBeUndefined();

    const pinResult = await executeGql(PIN_COMMENT, { commentId }, owner);
    expect(pinResult.errors).toBeUndefined();

    expect(await commentProcessor.processPendingEvents()).toBe(4);

    const ownerInbox = await inboxFor(owner);
    expect(ownerInbox).toHaveLength(1);
    expect(ownerInbox[0]).toMatchObject({
      type: 'NEW_COMMENT',
      title: 'تعليق جديد',
      relatedPostId: rescuePost.id,
      relatedCommentId: commentId,
    });
    expect(ownerInbox[0].body).toContain('Arabic Commenter');

    const commenterInbox = await inboxFor(commenter);
    expect(commenterInbox.map((node) => node.type).sort()).toEqual(['COMMENT_BOOSTED', 'COMMENT_PINNED', 'NEW_REPLY']);
    expect(commenterInbox.find((node) => node.type === 'NEW_REPLY')?.title).toBe('رد جديد');
    expect(commenterInbox.find((node) => node.type === 'COMMENT_BOOSTED')?.title).toBe('تم دعم التعليق');
    expect(commenterInbox.find((node) => node.type === 'COMMENT_PINNED')?.title).toBe('تم تثبيت التعليق');

    const marked = await executeGql(MARK_READ, { notificationId: ownerInbox[0].id }, owner);
    expect(marked.errors).toBeUndefined();
    expect(
      (marked.data as { markNotificationRead: { title: string; isRead: boolean } }).markNotificationRead,
    ).toMatchObject({ title: 'تعليق جديد', isRead: true });
  });

  it('keeps legacy English-only rows and events readable for an Arabic recipient', async () => {
    const commenter = await insertUser('Legacy Commenter', 'ar');

    // A pre-ticket row: no Arabic columns were persisted.
    await dbHelper.db.insert(notifications).values({
      recipientId: owner.id,
      type: 'NEW_UPVOTE',
      title: 'New upvote',
      body: 'Ahmed upvoted your post "Injured stray dog"',
      relatedPostId: rescuePost.id,
    });

    // A pre-ticket durable event: English columns only.
    await dbHelper.db.insert(discussionNotificationEvents).values({
      sourceEventId: `NEW_COMMENT:legacy-${generateUuidV7()}`,
      recipientId: owner.id,
      actorId: commenter.id,
      type: 'NEW_COMMENT',
      title: 'New comment',
      body: 'Legacy Commenter commented on your post "Injured stray dog"',
      relatedPostId: rescuePost.id,
    });
    expect(await commentProcessor.processPendingEvents()).toBe(1);

    const inbox = await inboxFor(owner);
    expect(inbox).toHaveLength(2);
    for (const node of inbox) {
      expect(node.title).toMatch(/^New (upvote|comment)$/);
      expect(node.body).not.toContain('تعليق');
    }
  });

  it('suppresses immediate notifications for an Arabic recipient across a Block', async () => {
    await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: actor.id });

    const blocked = await executeGql(REQUEST_CONTACT, { postId: rescuePost.id, message: 'Should never arrive' }, actor);
    expect(blocked.errors).toBeDefined();
    expect(blocked.errors?.map((error) => error.message).join(' ')).not.toMatch(/block/i);
    await sleep(300);
    expect(await notificationCount()).toBe(0);

    await dbHelper.db.delete(blocks);
    const allowed = await executeGql(REQUEST_CONTACT, { postId: rescuePost.id, message: 'Now visible' }, actor);
    expect(allowed.errors).toBeUndefined();
    await waitForNotificationCount(1);

    const inbox = await inboxFor(owner);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].title).toBe('طلب تواصل جديد');
  });

  it('suppresses delayed discussion delivery for an Arabic recipient across a Block', async () => {
    const commenter = await insertUser('Blocked Commenter', 'ar');

    const commentResult = await executeGql(
      CREATE_COMMENT,
      { input: { postId: rescuePost.id, text: 'Evidence', clientRequestId: `comment-${generateUuidV7()}` } },
      commenter,
    );
    expect(commentResult.errors).toBeUndefined();

    await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: commenter.id });

    expect(await commentProcessor.processPendingEvents()).toBe(0);
    expect(await notificationCount()).toBe(0);

    const [event] = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(event.status).toBe('SUPPRESSED');
  });
});
