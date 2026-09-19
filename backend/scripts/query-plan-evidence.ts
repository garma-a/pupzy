/**
 * Block-aware query-plan evidence for UGC Reporting and Account Blocking.
 *
 * Starts a disposable PostGIS test database, migrates it, seeds realistic
 * cardinality (users, all five Post types, Blocks in both directions,
 * discussion branches, Saved Posts), then executes the real repository
 * methods with a Drizzle query logger attached. The captured SQL for each
 * surface is replayed through `EXPLAIN (ANALYZE, BUFFERS)` against the same
 * database and printed for inspection.
 *
 * Run from backend/:
 *   npx ts-node -r tsconfig-paths/register scripts/query-plan-evidence.ts
 *
 * Requires Docker (testcontainers PostGIS image). This script is evidence
 * tooling, not a product code path and not part of any release gate.
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { faker } from '@faker-js/faker';
import { TestDatabaseHelper } from '../test/test-database.helper';
import * as schema from '../src/database/schema';
import { ensureOfficialCities } from '../src/cities/seed';
import { PostsRepository } from '../src/posts/posts.repository';
import { CommentsRepository } from '../src/comments/comments.repository';
import { BlocksRepository } from '../src/blocks/blocks.repository';

const USERS = 2_000;
const POSTS = 20_000;
const BLOCKS = 2_000;
const TOP_LEVEL_COMMENTS = 12_000;
const REPLIES = 18_000;
const SAVES = 8_000;

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function main(): Promise<void> {
  const helper = new TestDatabaseHelper();
  const connectionString = await helper.start();
  console.log(`Test database ready: ${connectionString.replace(/:[^:@/]+@/, ':***@')}`);

  const captured: CapturedQuery[] = [];
  const loggedDb = drizzle(helper.pool, {
    schema,
    logger: {
      logQuery(query, params) {
        captured.push({ sql: query, params: [...params] });
      },
    },
  });

  const postsRepository = new PostsRepository(loggedDb);
  const commentsRepository = new CommentsRepository(loggedDb);
  const blocksRepository = new BlocksRepository(loggedDb);

  // ── Seed ────────────────────────────────────────────────────────────────
  console.log('Seeding cities…');
  const cities = await ensureOfficialCities(loggedDb);

  console.log(`Seeding ${USERS} users…`);
  const userIds: string[] = [];
  for (const batch of chunk(
    Array.from({ length: USERS }, (_, i) => ({
      firebaseUserId: `plan-user-${i}`,
      email: `plan-user-${i}@pupzy.test`,
      fullName: `Plan User ${i}`,
      isVerified: i % 10 === 0,
    })),
    500,
  )) {
    const rows = await loggedDb.insert(schema.users).values(batch).returning({ id: schema.users.id });
    userIds.push(...rows.map((row) => row.id));
  }

  const viewer = userIds[0];
  const blockedByViewer = userIds.slice(1, 251);
  const blockedViewer = userIds.slice(251, 301);
  const blockedSet = new Set([...blockedByViewer, ...blockedViewer]);
  const openAuthors = userIds.slice(301);

  console.log(`Seeding ${POSTS} Posts across all five types…`);
  const postIds: string[] = [];
  const postTypes = ['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT', 'MATING'] as const;
  for (const batch of chunk(
    Array.from({ length: POSTS }, (_, i) => {
      const type = postTypes[i % postTypes.length];
      const creator =
        i % 5 === 0 ? faker.helpers.arrayElement(blockedByViewer) : faker.helpers.arrayElement(openAuthors);
      const city = faker.helpers.arrayElement(cities);
      return {
        creatorId: creator,
        postType: type,
        title: faker.lorem.sentence().slice(0, 190),
        description: faker.lorem.paragraph(),
        status: 'ACTIVE' as const,
        moderationStatus: 'CLEAN' as const,
        urgency: type === 'RESCUE' || type === 'LOST' ? (['CRITICAL', 'URGENT', 'MODERATE'] as const)[i % 3] : null,
        cityId: city.id,
        governorate: city.governorate,
        coordinates: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${(31 + (i % 100) / 100).toFixed(6)} ${(30 + (i % 70) / 100).toFixed(6)})`})`,
        marketCategory: type === 'PRODUCT' ? (['CARE', 'FOOD', 'ACCESSORIES'] as const)[i % 3] : null,
        upvoteCount: i % 50,
        saveCount: i % 30,
        viewCount: (i % 40) * 25,
        commentCount: 0,
      };
    }),
    1_000,
  )) {
    const rows = await loggedDb.insert(schema.posts).values(batch).returning({ id: schema.posts.id });
    postIds.push(...rows.map((row) => row.id));
  }

  console.log(`Seeding ${BLOCKS} Blocks in both directions…`);
  const blockRows = new Map<string, { blockerId: string; blockedId: string }>();
  for (let i = 0; i < BLOCKS; i += 1) {
    const blocker = i % 2 === 0 ? viewer : faker.helpers.arrayElement(userIds.slice(1));
    const blocked = i % 2 === 0 ? blockedByViewer[i % blockedByViewer.length] : blockedViewer[i % blockedViewer.length];
    if (blocker === blocked) continue;
    blockRows.set(`${blocker}:${blocked}`, { blockerId: blocker, blockedId: blocked });
  }
  for (const batch of chunk([...blockRows.values()], 1_000)) {
    await loggedDb.insert(schema.blocks).values(batch);
  }

  console.log(`Seeding ${TOP_LEVEL_COMMENTS} top-level Comments and ${REPLIES} Replies…`);
  const discussionPosts = postIds.slice(0, 12);
  const parentIds: string[] = [];
  const parentPostIds: string[] = [];
  for (const batch of chunk(
    Array.from({ length: TOP_LEVEL_COMMENTS }, (_, i) => {
      const author =
        i % 4 === 0 ? faker.helpers.arrayElement(blockedByViewer) : faker.helpers.arrayElement(openAuthors);
      return {
        postId: discussionPosts[i % discussionPosts.length],
        authorId: author,
        text: `Top-level comment ${i}`,
        status: 'ACTIVE' as const,
        replyCount: 0,
        boostCount: i % 25,
      };
    }),
    1_000,
  )) {
    const rows = await loggedDb.insert(schema.comments).values(batch).returning({ id: schema.comments.id });
    parentIds.push(...rows.map((row) => row.id));
    parentPostIds.push(...batch.map((row) => row.postId));
  }
  for (const batch of chunk(
    Array.from({ length: REPLIES }, (_, i) => {
      const parentIndex = i % parentIds.length;
      const author = i % 4 === 0 ? faker.helpers.arrayElement(blockedViewer) : faker.helpers.arrayElement(openAuthors);
      return {
        postId: parentPostIds[parentIndex],
        authorId: author,
        parentId: parentIds[parentIndex],
        text: `Reply ${i}`,
        status: 'ACTIVE' as const,
      };
    }),
    1_000,
  )) {
    await loggedDb.insert(schema.comments).values(batch);
  }

  console.log(`Seeding ${SAVES} Saved Posts (including blocked creators)…`);
  const saveRows = new Map<string, { userId: string; postId: string; createdAt: Date }>();
  for (let i = 0; i < SAVES; i += 1) {
    const postId = postIds[i % postIds.length];
    saveRows.set(`${viewer}:${postId}`, {
      userId: viewer,
      postId,
      createdAt: new Date(Date.now() - i * 1000),
    });
  }
  for (const batch of chunk([...saveRows.values()], 1_000)) {
    await loggedDb.insert(schema.postSaves).values(batch);
  }

  console.log('Running ANALYZE…');
  await loggedDb.execute(sql`
    ANALYZE users; ANALYZE posts; ANALYZE blocks; ANALYZE comments; ANALYZE post_saves;
  `);

  // Recompute comment counts so the discussion post looks realistic.
  await loggedDb.execute(sql`
    UPDATE posts p SET comment_count = sub.total
    FROM (
      SELECT post_id, count(*)::int AS total
      FROM comments
      WHERE status IN ('ACTIVE', 'IMAGE_HIDDEN')
      GROUP BY post_id
    ) sub
    WHERE p.id = sub.post_id
  `);
  await loggedDb.execute(sql`
    UPDATE comments c SET reply_count = sub.total
    FROM (
      SELECT parent_id, count(*)::int AS total
      FROM comments
      WHERE parent_id IS NOT NULL AND status IN ('ACTIVE', 'IMAGE_HIDDEN')
      GROUP BY parent_id
    ) sub
    WHERE c.id = sub.parent_id
  `);

  console.log(
    `Cardinality: users=${USERS}, posts=${POSTS}, blocks=${blockRows.size}, saves=${saveRows.size}, discussionPosts=${discussionPosts.length}`,
  );

  // ── Capture and EXPLAIN ─────────────────────────────────────────────────
  async function explain(label: string, action: () => Promise<unknown>): Promise<void> {
    captured.length = 0;
    await action();
    const selects = captured.filter((entry) => /^\s*(select|with)/i.test(entry.sql));
    if (selects.length === 0) {
      console.log(`\n### ${label}\nNo SELECT captured.`);
      return;
    }
    const main = selects[selects.length - 1];
    console.log(`\n### ${label}`);
    console.log(`Queries executed by the operation: ${captured.length} (SELECTs: ${selects.length})`);
    console.log('SQL:');
    console.log(main.sql.replace(/\s+/g, ' ').slice(0, 1_600));
    try {
      const result = await (helper.pool as Pool).query<{ 'QUERY PLAN': string }>({
        text: `EXPLAIN (ANALYZE, BUFFERS) ${main.sql}`,
        values: main.params,
      });
      console.log('Plan:');
      for (const row of result.rows) console.log(row['QUERY PLAN']);
    } catch (error) {
      console.log(`EXPLAIN failed: ${(error as Error).message}`);
    }
  }

  const viewerLocation = { latitude: 30.05, longitude: 31.25 };

  await explain('Home Feed (Block-aware, keyset page 1)', () =>
    postsRepository.findHomeFeed({
      governorate: null,
      cityId: null,
      viewerLocation,
      radiusKm: 50,
      limit: 20,
      cursor: null,
      viewerId: viewer,
    }),
  );

  await explain('Help Feed (RESCUE/LOST, Block-aware)', () =>
    postsRepository.findHelpFeed({
      governorate: null,
      cityId: null,
      viewerLocation,
      radiusKm: 50,
      limit: 20,
      cursor: null,
      viewerId: viewer,
    }),
  );

  await explain('Market Feed (PRODUCT, Block-aware)', () =>
    postsRepository.findMarketFeed({
      governorate: null,
      cityId: null,
      viewerLocation,
      radiusKm: 50,
      sort: 'HOT',
      category: null,
      limit: 20,
      cursor: null,
      viewerId: viewer,
    }),
  );

  await explain('Saved Posts (Block-aware anti-join)', () =>
    postsRepository.findPostsSavedByCurrentUser({
      userId: viewer,
      limit: 20,
      cursor: null,
    }),
  );

  const discussionPost = discussionPosts[0];
  await explain('Pinned Comment resolution + top-level Comments (TOP, page 1)', () =>
    commentsRepository.findTopLevelCommentsByPostId(discussionPost, 20, 'TOP', undefined, viewer),
  );

  const replyParent = parentIds[0];
  await explain('Replies for a top-level Comment (Block-aware)', () =>
    commentsRepository.findRepliesByCommentId(replyParent, 20, undefined, viewer),
  );

  await explain('Personalized Post commentCount (DataLoader batch)', () =>
    commentsRepository
      .createReachableCommentCountByPostIdLoader()
      .loadMany(discussionPosts.map((id) => `${viewer}:${id}`)),
  );

  await explain('Personalized Comment replyCount (DataLoader batch)', () =>
    commentsRepository
      .createReachableReplyCountByCommentIdLoader()
      .loadMany(parentIds.slice(0, 50).map((id) => `${viewer}:${id}`)),
  );

  await explain('Blocked Accounts pagination (page 1)', () =>
    blocksRepository.findBlockedUsers({ blockerId: viewer, limit: 20, cursor: null }),
  );

  await explain('Blocked Accounts pagination (page 2, cursor continuation)', async () => {
    const firstPage = await blocksRepository.findBlockedUsers({ blockerId: viewer, limit: 20, cursor: null });
    const last = firstPage.rows[firstPage.rows.length - 1];
    return blocksRepository.findBlockedUsers({
      blockerId: viewer,
      limit: 20,
      cursor: last ? { createdAt: last.cursorCreatedAt, id: last.blockId } : null,
    });
  });

  await helper.stop();
  console.log('\nQuery-plan evidence complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
