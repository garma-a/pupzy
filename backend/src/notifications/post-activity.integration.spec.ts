import * as fs from 'fs';
import * as path from 'path';
import { graphql, type GraphQLSchema } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { PostNotificationPreferencesResolver } from './post-notification-preferences.resolver';
import type { GqlContext } from '../common/types/gql-context.type';
import { eq, sql } from 'drizzle-orm';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { CommentsRepository } from '../comments/comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import {
  users,
  cities,
  posts,
  comments,
  postSaves,
  postUpvotes,
  blocks,
  notifications,
  discussionNotificationEvents,
  deviceRegistrations,
  pushDeliveries,
  postNotificationPreferences,
  type User,
  type Post,
} from '../database/schema';
import { PostNotificationPreferencesService } from './post-notification-preferences.service';
import { DiscussionNotificationProcessor } from './discussion-notification.processor';
import { PostCompletionNotificationRepository } from './post-completion-notification.repository';
import { PostCompletionNotificationProcessor } from './post-completion-notification.processor';
import { PushDeliveryProcessor } from './push-delivery.processor';
import { PushDeliveryRepository } from './push-delivery.repository';
import { NotificationsRepository } from './notifications.repository';

jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

describe('Automatic post activity following and mute', () => {
  jest.setTimeout(120_000);
  const helper = new TestDatabaseHelper();
  let api: GraphQLSchema;
  let preferences: PostNotificationPreferencesService;
  let discussion: CommentsRepository;
  let post: Post;
  let owner: User;
  let saver: User;
  let booster: User;
  let commenter: User;
  let actor: User;
  let stranger: User;

  beforeAll(async () => {
    await helper.start();
    preferences = new PostNotificationPreferencesService(helper.db, new AccountIsolationPolicy(helper.db));
    discussion = new CommentsRepository(helper.db);
    const resolver = new PostNotificationPreferencesResolver(preferences);
    const sourceRoot = path.resolve(__dirname, '..');
    const typeDefs = fs
      .readdirSync(sourceRoot, { recursive: true })
      .filter((file) => typeof file === 'string' && file.endsWith('.graphql'))
      .map((file) => fs.readFileSync(path.join(sourceRoot, String(file)), 'utf8'));
    api = makeExecutableSchema({
      typeDefs,
      resolvers: {
        Query: {
          myPostNotificationPreferences: (_: unknown, args: { postId: string }, ctx: GqlContext) =>
            resolver.get(args.postId, ctx),
        },
        Mutation: {
          setPostNotificationsMuted: (_: unknown, args: { postId: string; muted: boolean }, ctx: GqlContext) =>
            resolver.setMuted(args.postId, args.muted, ctx),
        },
      },
    });
  });
  afterAll(async () => helper.stop());
  beforeEach(async () => {
    await helper.clean();
    const [city] = await helper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31,30),4326)`,
      })
      .returning();
    const people = await helper.db
      .insert(users)
      .values(
        ['owner', 'saver', 'booster', 'commenter', 'actor', 'stranger'].map((name) => ({
          firebaseUserId: generateUuidV7(),
          email: `${name}@example.com`,
          username: name,
          fullName: name,
        })),
      )
      .returning();
    [owner, saver, booster, commenter, actor, stranger] = people;
    [post] = await helper.db
      .insert(posts)
      .values({
        creatorId: owner.id,
        postType: 'RESCUE',
        urgency: 'URGENT',
        title: 'Help this cat',
        description: 'Test post',
        cityId: city.id,
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31,30),4326)`,
      })
      .returning();
  });

  async function addComment(author = actor) {
    return discussion.createCommentWithCounter({
      postId: post.id,
      authorId: author.id,
      text: 'An update',
      clientRequestId: generateUuidV7(),
      requestHash: 'test',
    });
  }
  async function seedAudience() {
    await helper.db.insert(postSaves).values([
      { postId: post.id, userId: saver.id },
      { postId: post.id, userId: commenter.id },
    ]);
    await helper.db.insert(postUpvotes).values([
      { postId: post.id, userId: booster.id },
      { postId: post.id, userId: saver.id },
    ]);
    await helper.db.insert(comments).values({ postId: post.id, authorId: commenter.id, text: 'Following by comment' });
  }
  async function inbox(user: User) {
    return helper.db.select().from(notifications).where(eq(notifications.recipientId, user.id));
  }
  async function drain() {
    return new DiscussionNotificationProcessor(helper.db).processPendingEvents();
  }

  it('exposes authenticated-account GraphQL preferences and rejects malformed IDs or a recipient override', async () => {
    const source = `mutation Mute($postId: ID!) { setPostNotificationsMuted(postId: $postId, muted: true) { postId isFollowing isMuted notificationsEnabled } }`;
    const response = await graphql({
      schema: api,
      source,
      variableValues: { postId: post.id },
      contextValue: { user: saver },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.setPostNotificationsMuted).toEqual({
      postId: post.id,
      isFollowing: false,
      isMuted: true,
      notificationsEnabled: false,
    });
    const query = `query State($postId: ID!) { myPostNotificationPreferences(postId: $postId) { isMuted } }`;
    const other = await graphql({
      schema: api,
      source: query,
      variableValues: { postId: post.id },
      contextValue: { user: booster },
    });
    expect(other.errors).toBeUndefined();
    expect(other.data?.myPostNotificationPreferences).toEqual({ isMuted: false });
    const invalid = await graphql({
      schema: api,
      source: query,
      variableValues: { postId: 'bad-id' },
      contextValue: { user: saver },
    });
    expect(invalid.errors?.[0].message).toContain('valid UUID');
    const override = await graphql({
      schema: api,
      source: `mutation { setPostNotificationsMuted(postId: "${post.id}", muted: true, userId: "${booster.id}") { isMuted } }`,
      contextValue: { user: saver },
    });
    expect(override.errors?.[0].message).toContain('Unknown argument');
  });

  it('snapshots more than one worker batch without dropping followers', async () => {
    const followers = await helper.db
      .insert(users)
      .values(
        Array.from({ length: 60 }, (_, index) => ({
          firebaseUserId: generateUuidV7(),
          username: `follower_${index}`,
          email: `follower_${index}@example.com`,
          fullName: `Follower ${index}`,
        })),
      )
      .returning();
    await helper.db.insert(postSaves).values(followers.map((user) => ({ postId: post.id, userId: user.id })));
    await addComment();
    const processor = new DiscussionNotificationProcessor(helper.db);
    expect(await processor.processPendingEvents()).toBe(50);
    // The exhausted batch schedules another bounded drain without waiting for cron.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pending = await helper.db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM discussion_notification_events WHERE status IN ('PENDING', 'PROCESSING')`,
      );
      if (pending.rows[0].count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const delivered = await helper.db.select().from(notifications);
    expect(delivered).toHaveLength(61);
    expect(new Set(delivered.map((row) => row.recipientId)).size).toBe(61);
  });

  it('derives following from current relationships and keeps mute across later engagement', async () => {
    expect(await preferences.get(saver.id, post.id)).toMatchObject({
      isFollowing: false,
      isMuted: false,
      notificationsEnabled: false,
    });
    await helper.db.insert(postSaves).values({ postId: post.id, userId: saver.id });
    expect(await preferences.get(saver.id, post.id)).toMatchObject({ isFollowing: true, notificationsEnabled: true });
    await preferences.setMuted(saver.id, post.id, true);
    await preferences.setMuted(saver.id, post.id, true);
    await helper.db.insert(postUpvotes).values({ postId: post.id, userId: saver.id });
    expect(await preferences.get(saver.id, post.id)).toMatchObject({
      isFollowing: true,
      isMuted: true,
      notificationsEnabled: false,
    });
    expect(await helper.db.select().from(postNotificationPreferences)).toHaveLength(1);
    await helper.db.delete(postSaves).where(eq(postSaves.userId, saver.id));
    await helper.db.delete(postUpvotes).where(eq(postUpvotes.userId, saver.id));
    expect(await preferences.get(saver.id, post.id)).toMatchObject({ isFollowing: false, isMuted: true });
    expect(await preferences.setMuted(saver.id, post.id, false)).toMatchObject({
      isFollowing: false,
      notificationsEnabled: false,
    });
  });

  it('delivers one bilingual notification per follower, never to the actor or an unrelated feed viewer', async () => {
    await seedAudience();
    const update = await addComment();
    expect(await drain()).toBe(4);
    expect(await drain()).toBe(0);
    for (const follower of [owner, saver, booster, commenter]) {
      expect(await inbox(follower)).toEqual([
        expect.objectContaining({ relatedPostId: post.id, relatedCommentId: update.id, type: 'NEW_COMMENT' }),
      ]);
    }
    const [savedPostNotification] = await inbox(saver);
    expect(savedPostNotification.body).toContain('post you follow');
    expect(savedPostNotification.bodyArabic).toContain('تتابعه');
    expect(await inbox(actor)).toHaveLength(0);
    expect(await inbox(stranger)).toHaveLength(0);
  });

  it('deduplicates a reply author recipient against the follower audience and hides blocked parent threads', async () => {
    await seedAudience();
    const parent = await addComment(commenter);
    await helper.db.insert(blocks).values({ blockerId: saver.id, blockedId: commenter.id });
    const reply = await discussion.createReplyWithCounters({
      commentId: parent.id,
      authorId: actor.id,
      text: 'A reply update',
      clientRequestId: generateUuidV7(),
      requestHash: 'reply',
    });
    await drain();
    expect((await inbox(commenter)).filter((n) => n.relatedCommentId === reply.id)).toHaveLength(1);
    expect((await inbox(saver)).filter((n) => n.relatedCommentId === reply.id)).toHaveLength(0);
    expect((await inbox(booster)).filter((n) => n.relatedCommentId === reply.id)).toHaveLength(1);
  });

  it('mute cancels queued events permanently, excludes future events, and leaves other followers unaffected', async () => {
    await seedAudience();
    await addComment();
    await preferences.setMuted(saver.id, post.id, true);
    await preferences.setMuted(saver.id, post.id, false);
    await drain();
    expect(await inbox(saver)).toHaveLength(0);
    expect(await inbox(booster)).toHaveLength(1);
    await preferences.setMuted(saver.id, post.id, true);
    await addComment();
    await preferences.setMuted(saver.id, post.id, false);
    await drain();
    expect(await inbox(saver)).toHaveLength(0);
    await addComment();
    await drain();
    expect(await inbox(saver)).toHaveLength(1);
  });

  it.each(['actor', 'owner'] as const)('suppresses delayed delivery after blocking the %s', async (target) => {
    await seedAudience();
    await addComment();
    await helper.db.insert(blocks).values({ blockerId: saver.id, blockedId: target === 'actor' ? actor.id : owner.id });
    await drain();
    expect(await inbox(saver)).toHaveLength(0);
    expect(await inbox(booster)).toHaveLength(1);
  });

  it('rejects inaccessible post preferences and scopes writes to the supplied authenticated account', async () => {
    await preferences.setMuted(saver.id, post.id, true);
    expect((await preferences.get(booster.id, post.id)).isMuted).toBe(false);
    await helper.db.insert(blocks).values({ blockerId: owner.id, blockedId: saver.id });
    await expect(preferences.get(saver.id, post.id)).rejects.toThrow('not found');
    await expect(preferences.setMuted(saver.id, post.id, false)).rejects.toThrow('not found');
    await helper.db.update(posts).set({ status: 'REMOVED' }).where(eq(posts.id, post.id));
    await expect(preferences.get(booster.id, post.id)).rejects.toThrow('not found');
    await expect(preferences.get(booster.id, generateUuidV7())).rejects.toThrow('not found');
  });

  it('suppresses queued push after muting without erasing existing inbox history', async () => {
    await seedAudience();
    await helper.db
      .insert(deviceRegistrations)
      .values({ userId: saver.id, token: 'test-saver-token', platform: 'ANDROID' });
    await addComment();
    await drain();
    expect(await inbox(saver)).toHaveLength(1);
    expect(await helper.db.select().from(pushDeliveries)).toHaveLength(1);
    await preferences.setMuted(saver.id, post.id, true);
    await preferences.setMuted(saver.id, post.id, false);
    const send = jest.fn().mockResolvedValue(undefined);
    await new PushDeliveryProcessor(helper.db, { send }).processPendingDeliveries();
    expect(send).not.toHaveBeenCalled();
    expect(await inbox(saver)).toHaveLength(1);
  });

  it('account-wide push disable keeps the follower inbox and stops provider delivery', async () => {
    await seedAudience();
    await helper.db.update(users).set({ notificationsEnabled: false }).where(eq(users.id, saver.id));
    await helper.db
      .insert(deviceRegistrations)
      .values({ userId: saver.id, token: 'test-disabled-token', platform: 'ANDROID' });
    await addComment();
    await drain();
    const send = jest.fn().mockResolvedValue(undefined);
    await new PushDeliveryProcessor(helper.db, { send }).processPendingDeliveries();
    expect(send).not.toHaveBeenCalled();
    expect(await inbox(saver)).toHaveLength(1);
  });

  it('applies mute to completion audiences and to direct save/Boost notifications', async () => {
    await seedAudience();
    await preferences.setMuted(saver.id, post.id, true);
    await new PostsRepository(helper.db).updateStatus(post.id, owner.id, 'RESOLVED');
    await new PostCompletionNotificationProcessor(helper.db).processPendingBatches();
    expect(await inbox(saver)).toHaveLength(0);
    expect(await inbox(booster)).toEqual([expect.objectContaining({ type: 'RESCUE_COMPLETED' })]);
    await preferences.setMuted(owner.id, post.id, true);
    const repository = new NotificationsRepository(helper.db, undefined, new PushDeliveryRepository(helper.db));
    expect(
      await repository.createIfNotIsolated(
        { recipientId: owner.id, relatedPostId: post.id, type: 'NEW_UPVOTE', title: 'Boost', body: 'Boost' },
        actor.id,
        { enqueuePush: true },
      ),
    ).toBeUndefined();
  });

  it('preserves an owed reopening correction in the inbox while keeping its push muted', async () => {
    await seedAudience();
    await helper.db
      .insert(deviceRegistrations)
      .values({ userId: saver.id, token: 'correction-token', platform: 'IOS' });
    await new PostsRepository(helper.db).updateStatus(post.id, owner.id, 'RESOLVED');
    const worker = new PostCompletionNotificationProcessor(helper.db);
    await worker.processPendingBatches();
    expect(await inbox(saver)).toHaveLength(1);
    await preferences.setMuted(saver.id, post.id, true);
    const completion = new PostCompletionNotificationRepository(helper.db);
    await helper.db.transaction(async (tx) => {
      await tx.update(posts).set({ status: 'ACTIVE' }).where(eq(posts.id, post.id));
      await completion.handleReopen(tx, { postId: post.id, postTitle: post.title });
    });
    await worker.processPendingBatches();
    expect((await inbox(saver)).map((row) => row.type).sort()).toEqual(['RESCUE_COMPLETED', 'RESCUE_REOPENED']);
    const send = jest.fn().mockResolvedValue(undefined);
    await new PushDeliveryProcessor(helper.db, { send }).processPendingDeliveries();
    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses unavailable source discussions and cascades preferences on account deletion', async () => {
    await seedAudience();
    const update = await addComment();
    await helper.db.update(comments).set({ status: 'REMOVED' }).where(eq(comments.id, update.id));
    await drain();
    expect(await inbox(saver)).toHaveLength(0);
    expect(
      (await helper.db.select().from(discussionNotificationEvents)).every((event) => event.status === 'SUPPRESSED'),
    ).toBe(true);
    await preferences.setMuted(saver.id, post.id, true);
    await helper.db.delete(users).where(eq(users.id, saver.id));
    expect(await helper.db.select().from(postNotificationPreferences)).toHaveLength(0);
  });
});
