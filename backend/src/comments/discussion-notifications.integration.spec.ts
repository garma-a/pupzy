import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { inArray, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  cities,
  comments,
  discussionNotificationEvents,
  notifications,
  posts,
  users,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver } from './comments.resolver';
import { PostsRepository } from '../posts/posts.repository';
import { UploadService } from '../upload/upload.service';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsResolver } from '../notifications/notifications.resolver';
import { DiscussionNotificationProcessor } from '../notifications/discussion-notification.processor';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

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
const MY_NOTIFICATIONS = `
  query MyNotifications {
    myNotifications(first: 20) {
      unreadCount
      edges { node { id type relatedPostId relatedCommentId isRead } }
    }
  }
`;

describe('Durable Discussion Notifications Integration (Ticket 12)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let mockConfig: ConfigService;
  let mockCache: Cache;
  let commentsRepo: CommentsRepository;
  let postsRepo: PostsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;
  let notificationsResolver: NotificationsResolver;
  let schema: GraphQLSchema;

  let city: City;
  let post: Post;
  let postOwner: User;
  let commenter: User;
  let replier: User;
  let booster: User;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'COMMENT_IMAGES_ENABLED') return 'true';
        if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://cdn.pupzy.net';
        return undefined;
      }),
    } as unknown as ConfigService;
    mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as Cache;

    commentsRepo = new CommentsRepository(dbHelper.db);
    postsRepo = new PostsRepository(dbHelper.db);
    const uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    commentsService = new CommentsService(commentsRepo, postsRepo, uploadService, mockConfig);
    commentsResolver = new CommentsResolver(commentsService);
    const notificationsService = new NotificationsService(new NotificationsRepository(dbHelper.db));
    notificationsResolver = new NotificationsResolver(notificationsService);

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
      'src/vet-clinics/vet-clinics.graphql',
    ];
    const typeDefs = schemaFiles.map((relativePath) => fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8'));
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
          post: (_root: unknown, args: { id: string }) => postsRepo.findById(args.id),
          comments: (_root: unknown, args: any) =>
            commentsResolver.comments(args.postId, args.sort, args.first, args.after),
          replies: (_root: unknown, args: any) => commentsResolver.replies(args.commentId, args.first, args.after),
          myNotifications: (_root: unknown, args: any, context: GqlContext) =>
            notificationsResolver.myNotifications(args.first, args.after, context),
          myUnreadNotificationCount: (_root: unknown, _args: unknown, context: GqlContext) =>
            notificationsResolver.myUnreadNotificationCount(context),
        },
        Mutation: {
          createComment: (_root: unknown, args: any, context: GqlContext) => commentsResolver.createComment(args.input, context),
          createReply: (_root: unknown, args: any, context: GqlContext) => commentsResolver.createReply(args.input, context),
          toggleCommentBoost: (_root: unknown, args: any, context: GqlContext) =>
            commentsResolver.toggleCommentBoost(args.commentId, context),
          pinComment: (_root: unknown, args: any, context: GqlContext) => commentsResolver.pinComment(args.commentId, context),
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

    const makeUser = (label: string) => ({
      firebaseUserId: `firebase-${label}-${generateUuidV7()}`,
      email: `${label}-${generateUuidV7()}@example.com`,
      username: `${label}_${generateUuidV7().slice(-8)}`,
      fullName: label,
    });
    [postOwner, commenter, replier, booster] = await dbHelper.db
      .insert(users)
      .values([makeUser('Post Owner'), makeUser('Commenter'), makeUser('Replier'), makeUser('Booster')])
      .returning();

    const [createdPost] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: postOwner.id,
        postType: 'RESCUE',
        title: 'Durable discussion test post',
        description: 'A post used to verify notification recovery.',
        cityId: city.id,
        urgency: 'URGENT',
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    post = createdPost;
  });

  async function executeGql(source: string, variables: Record<string, unknown>, authenticatedUser: User) {
    const userLoader = new DataLoader(async (ids: readonly string[]) => {
      const rows = await dbHelper.db.select().from(users).where(inArray(users.id, ids as string[]));
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.map((id) => byId.get(id) ?? null);
    });
    const context: GqlContext = {
      req: {} as any,
      user: {
        id: authenticatedUser.id,
        email: authenticatedUser.email,
        username: authenticatedUser.username,
        role: authenticatedUser.role,
      } as any,
      loaders: {
        cityById: { load: jest.fn() } as any,
        userById: userLoader,
        mediaByPostId: { load: jest.fn() } as any,
        upvotedByMe: { load: jest.fn() } as any,
        savedByMe: { load: jest.fn() } as any,
        commentBoostedByMe: commentsRepo.createCommentBoostedByMeLoader(),
        pinnedCommentIdByPostId: commentsRepo.createPinnedCommentIdByPostIdLoader(),
        commentMediaByCommentId: commentsRepo.createCommentMediaByCommentIdLoader(),
      },
    };
    return graphql({ schema, source, variableValues: variables, contextValue: context });
  }

  async function createComment(text: string, clientRequestId = `comment-${generateUuidV7()}`, author = commenter): Promise<string> {
    const result = await executeGql(CREATE_COMMENT, { input: { postId: post.id, text, clientRequestId } }, author);
    expect(result.errors).toBeUndefined();
    return (result.data as any).createComment.id;
  }

  it('commits one durable event with the source action, recovers it after restart, and preserves unread navigation IDs', async () => {
    const commentId = await createComment('A durable comment');
    const [event] = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(event).toMatchObject({
      sourceEventId: `NEW_COMMENT:${commentId}`,
      recipientId: postOwner.id,
      actorId: commenter.id,
      type: 'NEW_COMMENT',
      relatedPostId: post.id,
      relatedCommentId: commentId,
      status: 'PENDING',
    });
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(0);

    // A fresh processor instance represents a restart after source commit.
    const restartedProcessor = new DiscussionNotificationProcessor(dbHelper.db);
    await restartedProcessor.onApplicationBootstrap();
    expect(await new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents()).toBe(0);

    const inbox = await executeGql(MY_NOTIFICATIONS, {}, postOwner);
    expect(inbox.errors).toBeUndefined();
    expect((inbox.data as any).myNotifications).toMatchObject({
      unreadCount: 1,
      edges: [
        {
          node: {
            type: 'NEW_COMMENT',
            relatedPostId: post.id,
            relatedCommentId: commentId,
            isRead: false,
          },
        },
      ],
    });
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(1);
  });

  it('recovers an expired delivery lease after a worker crash without duplicating the inbox row', async () => {
    const commentId = await createComment('A lease-recovery comment');
    await dbHelper.pool.query(`
      UPDATE discussion_notification_events
      SET status = 'PROCESSING',
          attempts = 1,
          lease_token = uuidv7(),
          lease_expires_at = now() - INTERVAL '1 second'
      WHERE related_comment_id = $1
    `, [commentId]);

    expect(await new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents()).toBe(1);
    const [event] = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(event).toMatchObject({ status: 'DELIVERED', relatedCommentId: commentId, attempts: 2 });
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(1);
    expect(await new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents()).toBe(0);
  });

  it('retains a real inbox insertion failure, then retries safely after restart without duplication', async () => {
    const commentId = await createComment('A delivery failure must remain recoverable');
    await dbHelper.pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_discussion_notification_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected notification persistence failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_discussion_notification_insert
      BEFORE INSERT ON notifications
      FOR EACH ROW WHEN (NEW.discussion_event_id IS NOT NULL)
      EXECUTE FUNCTION test_fail_discussion_notification_insert();
    `);

    try {
      expect(await new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents()).toBe(0);
      const [failed] = await dbHelper.db.select().from(discussionNotificationEvents);
      expect(failed).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(failed.lastError).toContain('retry scheduled');
      expect(await dbHelper.db.select().from(notifications)).toHaveLength(0);
    } finally {
      await dbHelper.pool.query(`DROP TRIGGER IF EXISTS test_fail_discussion_notification_insert ON notifications;`);
      await dbHelper.pool.query(`DROP FUNCTION IF EXISTS test_fail_discussion_notification_insert();`);
    }

    await dbHelper.pool.query(`UPDATE discussion_notification_events SET next_attempt_at = now()`);
    expect(await new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents()).toBe(1);
    expect(await new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents()).toBe(0);

    const [event] = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(event).toMatchObject({ status: 'DELIVERED', relatedCommentId: commentId, attempts: 2 });
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(1);
  });

  it('deduplicates concurrent equivalent GraphQL creates and multi-process delivery claims', async () => {
    const clientRequestId = `concurrent-${generateUuidV7()}`;
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        executeGql(CREATE_COMMENT, { input: { postId: post.id, text: 'Concurrent durable create', clientRequestId } }, commenter),
      ),
    );
    for (const response of responses) {
      expect(response.errors).toBeUndefined();
    }
    const createdIds = new Set(responses.map((response) => (response.data as any).createComment.id));
    expect(createdIds.size).toBe(1);
    expect(await dbHelper.db.select().from(comments)).toHaveLength(1);
    expect(await dbHelper.db.select().from(discussionNotificationEvents)).toHaveLength(1);

    const [firstWorker, secondWorker] = await Promise.all([
      new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents(),
      new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents(),
    ]);
    expect(firstWorker + secondWorker).toBe(1);
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(1);
  });

  it('uses the required recipients and targets while suppressing self, Boost removal, and no-op pin events', async () => {
    const commentId = await createComment('A comment with every discussion event');
    const replyResult = await executeGql(
      CREATE_REPLY,
      { input: { commentId, text: 'A reply', clientRequestId: `reply-${generateUuidV7()}` } },
      replier,
    );
    expect(replyResult.errors).toBeUndefined();
    const replyId = (replyResult.data as any).createReply.id;

    const boostAdded = await executeGql(TOGGLE_BOOST, { commentId }, booster);
    expect(boostAdded.errors).toBeUndefined();
    expect((boostAdded.data as any).toggleCommentBoost.isBoostedByMe).toBe(true);
    const boostRemoved = await executeGql(TOGGLE_BOOST, { commentId }, booster);
    expect(boostRemoved.errors).toBeUndefined();
    expect((boostRemoved.data as any).toggleCommentBoost.isBoostedByMe).toBe(false);

    expect((await executeGql(PIN_COMMENT, { commentId }, postOwner)).errors).toBeUndefined();
    expect((await executeGql(PIN_COMMENT, { commentId }, postOwner)).errors).toBeUndefined();
    await createComment('Post-owner self comment', `self-${generateUuidV7()}`, postOwner);

    const events = await dbHelper.db.select().from(discussionNotificationEvents).orderBy(discussionNotificationEvents.type);
    expect(events).toHaveLength(4);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'NEW_COMMENT',
          recipientId: postOwner.id,
          relatedPostId: post.id,
          relatedCommentId: commentId,
        }),
        expect.objectContaining({
          type: 'NEW_REPLY',
          recipientId: commenter.id,
          relatedPostId: post.id,
          relatedCommentId: replyId,
        }),
        expect.objectContaining({
          type: 'COMMENT_BOOSTED',
          recipientId: commenter.id,
          relatedPostId: post.id,
          relatedCommentId: commentId,
        }),
        expect.objectContaining({
          type: 'COMMENT_PINNED',
          recipientId: commenter.id,
          relatedPostId: post.id,
          relatedCommentId: commentId,
        }),
      ]),
    );
  });

  it('rolls back the source action when durable event insertion fails', async () => {
    await dbHelper.pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_discussion_event_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected outbox insertion failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_discussion_event_insert
      BEFORE INSERT ON discussion_notification_events
      FOR EACH ROW EXECUTE FUNCTION test_fail_discussion_event_insert();
    `);

    try {
      const response = await executeGql(
        CREATE_COMMENT,
        { input: { postId: post.id, text: 'This source action must roll back', clientRequestId: `rollback-${generateUuidV7()}` } },
        commenter,
      );
      expect(response.errors).toBeDefined();
      expect(await dbHelper.db.select().from(comments)).toHaveLength(0);
      expect(await dbHelper.db.select().from(discussionNotificationEvents)).toHaveLength(0);
    } finally {
      await dbHelper.pool.query(`DROP TRIGGER IF EXISTS test_fail_discussion_event_insert ON discussion_notification_events;`);
      await dbHelper.pool.query(`DROP FUNCTION IF EXISTS test_fail_discussion_event_insert();`);
    }
  });
});
