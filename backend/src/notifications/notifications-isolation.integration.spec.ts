import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { count, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
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
import { PostsRepository } from '../posts/posts.repository';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { CommentsResolver } from '../comments/comments.resolver';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsResolver } from './notifications.resolver';
import { DiscussionNotificationProcessor } from './discussion-notification.processor';
import { AccountIsolationPolicy, canonicalAccountPairKey } from '../blocks/account-isolation.policy';
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
      edges { node { id type title relatedPostId relatedCommentId isRead } }
    }
  }
`;
const MY_UNREAD_COUNT = `query MyUnread { myUnreadNotificationCount }`;
const DIRECT_POST = `query DirectPost($id: ID!) { post(id: $id) { id postType } }`;
const POST_COMMENTS = `
  query PostComments($postId: ID!) {
    comments(postId: $postId, first: 20) {
      edges { node { id } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const INTERACTION_NOTIFICATION_TYPES = [
  'NEW_UPVOTE',
  'POST_SAVED',
  'CONTACT_REQUEST_RECEIVED',
  'CONTACT_REQUEST_APPROVED',
  'CONTACT_REQUEST_REJECTED',
  'ADOPTION_APPLICATION_RECEIVED',
  'ADOPTION_APPLICATION_APPROVED',
  'ADOPTION_APPLICATION_REJECTED',
  'NEW_COMMENT',
  'NEW_REPLY',
  'COMMENT_BOOSTED',
  'COMMENT_PINNED',
] as const;

interface MyNotificationsResult {
  myNotifications: {
    unreadCount: number;
    edges: Array<{
      node: {
        id: string;
        type: string;
        title: string;
        relatedPostId: string | null;
        relatedCommentId: string | null;
        isRead: boolean;
      };
    }>;
  };
}

interface CommentsResult {
  comments: { edges: Array<{ node: { id: string } }> };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ticket 10 — notifications across account isolation.
 *
 * Proves the two suppression chokepoints on the real database:
 * 1. NotificationsRepository.createIfNotIsolated for immediate notifications.
 * 2. DiscussionNotificationProcessor delivery recheck for durable events.
 * Historical inbox rows survive a Block, navigation across a Block is neutral,
 * and administrative/system notifications are unaffected.
 */
describe('Notification account isolation (Ticket 10)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let schema: GraphQLSchema;
  let postsRepository: PostsRepository;
  let notificationsRepository: NotificationsRepository;
  let notificationsService: NotificationsService;
  let notificationsResolver: NotificationsResolver;
  let commentsResolver: CommentsResolver;
  let commentProcessor: DiscussionNotificationProcessor;
  let isolationPolicy: AccountIsolationPolicy;

  let city: City;
  let postOwner: User;
  let commenter: User;
  let replier: User;
  let booster: User;
  let other: User;
  let ownerPost: Post;

  async function insertUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@example.com`,
        username: `${label}_${generateUuidV7().slice(-8)}`,
        fullName: label,
      })
      .returning();
    return user;
  }

  async function insertPost(creator: User, title: string): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: creator.id,
        postType: 'RESCUE',
        title,
        description: 'Notification isolation test post',
        cityId: city.id,
        urgency: 'URGENT',
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
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

  async function createCommentViaGql(text: string, author: User): Promise<string> {
    const result = await executeGql(
      CREATE_COMMENT,
      { input: { postId: ownerPost.id, text, clientRequestId: `comment-${generateUuidV7()}` } },
      author,
    );
    expect(result.errors).toBeUndefined();
    return (result.data as { createComment: { id: string } }).createComment.id;
  }

  /**
   * Holds the canonical account-pair lock on a dedicated connection while the
   * Block row is still uncommitted, runs `action` (which must wait on that
   * lock), then commits the Block. This deterministically injects a Block that
   * commits concurrently with the action's isolation recheck.
   */
  async function withUncommittedBlock<T>(blockerId: string, blockedId: string, action: () => Promise<T>): Promise<T> {
    const client = await dbHelper.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('account_pair'), hashtext($1))`, [
        canonicalAccountPairKey(blockerId, blockedId),
      ]);
      await client.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1::uuid, $2::uuid)`, [
        blockerId,
        blockedId,
      ]);

      const pending = action();
      await sleep(200);
      await client.query('COMMIT');
      committed = true;
      return await pending;
    } finally {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      client.release();
    }
  }

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const mockConfig = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    postsRepository = new PostsRepository(dbHelper.db, undefined, isolationPolicy);
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
    commentsResolver = new CommentsResolver(commentsService);
    notificationsRepository = new NotificationsRepository(dbHelper.db, isolationPolicy);
    notificationsService = new NotificationsService(notificationsRepository);
    notificationsResolver = new NotificationsResolver(notificationsService);
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
      'src/vet-clinics/vet-clinics.graphql',
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
          post: async (_root: unknown, args: { id: string }, context: GqlContext) => {
            const post = await postsRepository.findById(args.id, context.user?.id);
            return !post || post.status === 'REMOVED' ? null : post;
          },
          comments: (_root: unknown, args: { postId: string; first?: number; after?: string }, context: GqlContext) =>
            commentsResolver.comments(args.postId, undefined, args.first, args.after, context),
          myNotifications: (_root: unknown, args: { first?: number; after?: string }, context: GqlContext) =>
            notificationsResolver.myNotifications(args.first, args.after, context),
          myUnreadNotificationCount: (_root: unknown, _args: unknown, context: GqlContext) =>
            notificationsResolver.myUnreadNotificationCount(context),
        },
        Mutation: {
          createComment: (_root: unknown, args: { input: unknown }, context: GqlContext) =>
            commentsResolver.createComment(args.input, context),
          createReply: (_root: unknown, args: { input: unknown }, context: GqlContext) =>
            commentsResolver.createReply(args.input, context),
          toggleCommentBoost: (_root: unknown, args: { commentId: string }, context: GqlContext) =>
            commentsResolver.toggleCommentBoost(args.commentId, context),
          pinComment: (_root: unknown, args: { commentId: string }, context: GqlContext) =>
            commentsResolver.pinComment(args.commentId, context),
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

    postOwner = await insertUser('Post Owner');
    commenter = await insertUser('Commenter');
    replier = await insertUser('Replier');
    booster = await insertUser('Booster');
    other = await insertUser('Other');
    ownerPost = await insertPost(postOwner, 'Notification isolation test post');
  });

  it('suppresses immediate notifications for every interaction path in both Block directions', async () => {
    await dbHelper.db.insert(blocks).values({ blockerId: other.id, blockedId: commenter.id });

    for (const type of INTERACTION_NOTIFICATION_TYPES) {
      const created = await notificationsRepository.createIfNotIsolated(
        {
          recipientId: commenter.id,
          type,
          title: `Immediate ${type}`,
          body: 'Interaction across a committed Block',
          relatedPostId: ownerPost.id,
        },
        other.id,
      );
      expect(created).toBeUndefined();
    }

    expect(await notificationCount()).toBe(0);

    // Mutual isolation: the reverse actor/recipient order is suppressed too.
    await dbHelper.db.delete(blocks);
    await dbHelper.db.insert(blocks).values({ blockerId: commenter.id, blockedId: other.id });
    const reverse = await notificationsRepository.createIfNotIsolated(
      {
        recipientId: other.id,
        type: 'NEW_UPVOTE',
        title: 'Reverse direction',
        body: 'Interaction across a committed Block',
      },
      commenter.id,
    );
    expect(reverse).toBeUndefined();
    expect(await notificationCount()).toBe(0);

    // Control: without a Block the same call persists exactly one row.
    await dbHelper.db.delete(blocks);
    const persisted = await notificationsRepository.createIfNotIsolated(
      {
        recipientId: commenter.id,
        type: 'NEW_UPVOTE',
        title: 'No Block',
        body: 'Ordinary interaction',
      },
      other.id,
    );
    expect(persisted).toBeDefined();
    expect(await notificationCount()).toBe(1);
  });

  it('suppresses through the fireNotification service chokepoint and keeps self-suppression intact', async () => {
    await dbHelper.db.insert(blocks).values({ blockerId: commenter.id, blockedId: other.id });

    notificationsService.fireNotification(
      {
        recipientId: commenter.id,
        type: 'CONTACT_REQUEST_RECEIVED',
        title: 'New contact request',
        body: 'Should be suppressed',
        relatedPostId: ownerPost.id,
      },
      other.id,
    );
    notificationsService.fireNotification(
      {
        recipientId: commenter.id,
        type: 'ADOPTION_APPLICATION_APPROVED',
        title: 'Application approved',
        body: 'Should be suppressed',
        relatedPostId: ownerPost.id,
      },
      other.id,
    );
    notificationsService.fireNotification(
      {
        recipientId: other.id,
        type: 'NEW_UPVOTE',
        title: 'Self notification',
        body: 'Should be suppressed by the self guard',
      },
      other.id,
    );

    await sleep(300);
    expect(await notificationCount()).toBe(0);

    // Control: an unblocked recipient still receives the notification.
    notificationsService.fireNotification(
      {
        recipientId: postOwner.id,
        type: 'NEW_UPVOTE',
        title: 'No Block',
        body: 'Ordinary interaction',
      },
      other.id,
    );
    await waitForNotificationCount(1);
  });

  it('suppresses Comment, Reply, Boost, and pin events committed before a Block and marks them terminal', async () => {
    const commentId = await createCommentViaGql('A durable comment', commenter);

    const replyResult = await executeGql(
      CREATE_REPLY,
      { input: { commentId, text: 'A durable reply', clientRequestId: `reply-${generateUuidV7()}` } },
      replier,
    );
    expect(replyResult.errors).toBeUndefined();

    const boostResult = await executeGql(TOGGLE_BOOST, { commentId }, booster);
    expect(boostResult.errors).toBeUndefined();

    const pinResult = await executeGql(PIN_COMMENT, { commentId }, postOwner);
    expect(pinResult.errors).toBeUndefined();

    const pendingEvents = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(pendingEvents).toHaveLength(4);

    // The source events predate every Block.
    await dbHelper.db.insert(blocks).values([
      { blockerId: postOwner.id, blockedId: commenter.id },
      { blockerId: replier.id, blockedId: commenter.id },
      { blockerId: booster.id, blockedId: commenter.id },
    ]);

    expect(await commentProcessor.processPendingEvents()).toBe(0);
    expect(await notificationCount()).toBe(0);

    const suppressed = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(suppressed).toHaveLength(4);
    for (const event of suppressed) {
      expect(event.status).toBe('SUPPRESSED');
      expect(event.attempts).toBe(1);
      expect(event.lastError).toBeNull();
      expect(event.leaseToken).toBeNull();
      expect(event.deliveredAt).toBeNull();
    }

    // Terminal: re-running the processor claims nothing and does not retry.
    expect(await commentProcessor.processPendingEvents()).toBe(0);
    const afterSecondRun = await dbHelper.db.select().from(discussionNotificationEvents);
    for (const event of afterSecondRun) {
      expect(event.status).toBe('SUPPRESSED');
      expect(event.attempts).toBe(1);
    }
    expect(await notificationCount()).toBe(0);
  });

  it('delivers and deduplicates discussion events when no Block applies', async () => {
    const commentId = await createCommentViaGql('A durable comment', commenter);

    const replyResult = await executeGql(
      CREATE_REPLY,
      { input: { commentId, text: 'A durable reply', clientRequestId: `reply-${generateUuidV7()}` } },
      replier,
    );
    expect(replyResult.errors).toBeUndefined();

    const boostResult = await executeGql(TOGGLE_BOOST, { commentId }, booster);
    expect(boostResult.errors).toBeUndefined();

    const pinResult = await executeGql(PIN_COMMENT, { commentId }, postOwner);
    expect(pinResult.errors).toBeUndefined();

    // A self-comment does not enqueue a durable event (self-suppression intact).
    await createCommentViaGql('Talking to myself', postOwner);
    expect(await dbHelper.db.select().from(discussionNotificationEvents)).toHaveLength(4);

    const parallelWorkers = await Promise.all([
      new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents(),
      new DiscussionNotificationProcessor(dbHelper.db).processPendingEvents(),
    ]);
    expect(parallelWorkers[0] + parallelWorkers[1]).toBe(4);
    expect(await notificationCount()).toBe(4);

    // Exactly-once delivery: a later run adds no duplicate inbox rows.
    expect(await commentProcessor.processPendingEvents()).toBe(0);
    expect(await notificationCount()).toBe(4);

    const delivered = await dbHelper.db.select().from(discussionNotificationEvents);
    for (const event of delivered) {
      expect(event.status).toBe('DELIVERED');
    }
  });

  it('suppresses delayed delivery when the Block commits while the processor waits on the pair lock', async () => {
    const commentId = await createCommentViaGql('A concurrent delivery comment', commenter);

    const delivered = await withUncommittedBlock(postOwner.id, commenter.id, () =>
      commentProcessor.processPendingEvents(),
    );
    expect(delivered).toBe(0);
    expect(await notificationCount()).toBe(0);

    const [event] = await dbHelper.db.select().from(discussionNotificationEvents);
    expect(event).toMatchObject({ status: 'SUPPRESSED', relatedCommentId: commentId });
    expect(event.attempts).toBe(1);
  });

  it('suppresses immediate creation when the Block commits while the insert waits on the pair lock', async () => {
    const created = await withUncommittedBlock(postOwner.id, commenter.id, () =>
      notificationsRepository.createIfNotIsolated(
        {
          recipientId: postOwner.id,
          type: 'NEW_UPVOTE',
          title: 'Concurrent upvote',
          body: 'The Block commits first',
          relatedPostId: ownerPost.id,
        },
        commenter.id,
      ),
    );

    expect(created).toBeUndefined();
    expect(await notificationCount()).toBe(0);
  });

  it('retains historical notifications and resolves isolated targets neutrally', async () => {
    const blockedPost = await insertPost(other, 'A post by the blocked account');
    const [blockedComment] = await dbHelper.db
      .insert(comments)
      .values({ postId: ownerPost.id, authorId: other.id, text: 'A comment by the blocked account', status: 'ACTIVE' })
      .returning();

    await dbHelper.db.insert(notifications).values([
      {
        recipientId: postOwner.id,
        type: 'NEW_COMMENT',
        title: 'New comment',
        body: 'Someone commented on your post',
        relatedPostId: ownerPost.id,
        relatedCommentId: blockedComment.id,
      },
      {
        recipientId: postOwner.id,
        type: 'NEW_UPVOTE',
        title: 'New upvote',
        body: 'Someone upvoted your post',
        relatedPostId: blockedPost.id,
      },
    ]);

    // Blocking creates no notification and deletes no history.
    await dbHelper.db.insert(blocks).values({ blockerId: postOwner.id, blockedId: other.id });
    expect(await notificationCount()).toBe(2);

    const inbox = await executeGql(MY_NOTIFICATIONS, {}, postOwner);
    expect(inbox.errors).toBeUndefined();
    const inboxData = inbox.data as unknown as MyNotificationsResult;
    expect(inboxData.myNotifications.unreadCount).toBe(2);
    const notificationNodes = inboxData.myNotifications.edges.map((edge) => edge.node);
    expect(notificationNodes).toHaveLength(2);
    expect(notificationNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'NEW_COMMENT',
          relatedPostId: ownerPost.id,
          relatedCommentId: blockedComment.id,
        }),
        expect.objectContaining({ type: 'NEW_UPVOTE', relatedPostId: blockedPost.id }),
      ]),
    );

    const unread = await executeGql(MY_UNREAD_COUNT, {}, postOwner);
    expect((unread.data as { myUnreadNotificationCount: number }).myUnreadNotificationCount).toBe(2);

    // Navigation from the historical notification to the blocked Post is
    // null, exactly like a missing Post.
    const directPost = await executeGql(DIRECT_POST, { id: blockedPost.id }, postOwner);
    expect(directPost.errors).toBeUndefined();
    expect((directPost.data as { post: unknown }).post).toBeNull();

    // Discussion navigation uses the same neutral not-found behavior and never
    // mentions a Block.
    const blockedDiscussion = await executeGql(POST_COMMENTS, { postId: blockedPost.id }, postOwner);
    expect(blockedDiscussion.errors).toBeDefined();
    expect(blockedDiscussion.data?.comments ?? null).toBeNull();
    expect(blockedDiscussion.errors?.map((error) => error.message).join(' ')).not.toMatch(/block/i);

    // On the viewer's own Post, the blocked author's contribution is omitted
    // without affecting historical notification rows.
    const visibleDiscussion = await executeGql(POST_COMMENTS, { postId: ownerPost.id }, postOwner);
    expect(visibleDiscussion.errors).toBeUndefined();
    expect((visibleDiscussion.data as unknown as CommentsResult).comments.edges).toHaveLength(0);
    expect(await notificationCount()).toBe(2);
  });

  it('leaves administrative and system notifications governed by their existing rules', async () => {
    await dbHelper.db.insert(blocks).values({ blockerId: postOwner.id, blockedId: other.id });

    // The ban cascade inserts POST_REMOVED_BY_ADMIN directly (no actor).
    await dbHelper.db.insert(notifications).values({
      recipientId: postOwner.id,
      type: 'POST_REMOVED_BY_ADMIN',
      title: 'Your posts were removed',
      body: 'Your account was banned and your active posts were removed.',
    });

    // System-generated notifications carry no actor and skip the isolation guard.
    notificationsService.fireNotification({
      recipientId: postOwner.id,
      type: 'SYSTEM_ANNOUNCEMENT',
      title: 'New match for your saved search',
      body: 'A new adoption post matches your saved search.',
    });

    await waitForNotificationCount(2);
    const rows = await dbHelper.db.select().from(notifications);
    expect(rows.map((row) => row.type).sort()).toEqual(['POST_REMOVED_BY_ADMIN', 'SYSTEM_ANNOUNCEMENT']);
  });
});
