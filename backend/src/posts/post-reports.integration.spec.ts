import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { Cache } from 'cache-manager';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  commentQuotaAdmissions,
  cities,
  postReports,
  posts,
  users,
  type City,
  type Post,
  type PostReport,
  type User,
  type CommentQuotaAdmission,
} from '../database/schema';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ViewFlushCron } from './view-flush.cron';
import { MODERATION_REPORT_ACTION } from '../moderation-reports/moderation-report-quota.manager';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

const REPORT_POST_MUTATION = `
  mutation ReportPost($input: ReportPostInput!) {
    reportPost(input: $input)
  }
`;

const POST_TYPES = ['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT', 'MATING'] as const;
type ReportablePostType = (typeof POST_TYPES)[number];

interface ReportPostResponse {
  reportPost: boolean;
}

interface PostOverrides {
  creatorId?: string;
  status?: Post['status'];
  moderationStatus?: Post['moderationStatus'];
}

describe('Post Report submission (Ticket 02)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let postsRepo: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let executableSchema: GraphQLSchema;

  let testCity: City;
  let author: User;
  let reporter: User;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    postsRepo = new PostsRepository(dbHelper.db);
    const usersServiceStub = {
      invalidateUserCacheById: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    postsService = new PostsService(
      postsRepo,
      {} as CitiesService,
      {} as UploadService,
      {} as ViewFlushCron,
      usersServiceStub,
      {} as NotificationsService,
      {} as Cache,
    );
    postsResolver = new PostsResolver(postsService);

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

    const typeDefs = schemaFiles.map((relPath) => fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8'));

    executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue(v: unknown) {
            return v;
          },
          __serialize(v: unknown) {
            return v instanceof Date ? v.toISOString() : v;
          },
        },
        Mutation: {
          reportPost: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            postsResolver.reportPost(args.input, ctx),
        },
      },
    });
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
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testCity = city;

    author = await createUser('author');
    reporter = await createUser('reporter');
  });

  async function createUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@example.com`,
        fullName: `${label} user`,
        username: `${label}_${generateUuidV7().slice(0, 8)}`,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();
    return user;
  }

  async function createPost(postType: ReportablePostType, overrides: PostOverrides = {}): Promise<Post> {
    const requiresUrgency = postType === 'RESCUE' || postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: overrides.creatorId ?? author.id,
        postType,
        title: `${postType} reportable post`,
        description: `Description for ${postType}`,
        status: overrides.status ?? 'ACTIVE',
        moderationStatus: overrides.moderationStatus ?? 'CLEAN',
        urgency: requiresUrgency ? 'URGENT' : null,
        cityId: testCity.id,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  async function executeGql(
    source: string,
    variables: Record<string, unknown>,
    user: User,
  ): Promise<ExecutionResult<ReportPostResponse>> {
    const ctx = {
      req: {} as unknown as GqlContext['req'],
      user,
      loaders: {} as GqlContext['loaders'],
    } as GqlContext;

    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: ctx,
    }) as Promise<ExecutionResult<ReportPostResponse>>;
  }

  function report(
    postId: string,
    user: User = reporter,
    input: Record<string, unknown> = {},
  ): Promise<ExecutionResult<ReportPostResponse>> {
    return executeGql(REPORT_POST_MUTATION, { input: { postId, reason: 'SPAM', ...input } }, user);
  }

  async function storedReports(postId: string): Promise<PostReport[]> {
    return dbHelper.db.select().from(postReports).where(eq(postReports.postId, postId));
  }

  async function admissionsFor(userId: string): Promise<CommentQuotaAdmission[]> {
    return dbHelper.db
      .select()
      .from(commentQuotaAdmissions)
      .where(
        and(eq(commentQuotaAdmissions.userId, userId), eq(commentQuotaAdmissions.action, MODERATION_REPORT_ACTION)),
      );
  }

  async function findPost(postId: string): Promise<Post> {
    const [post] = await dbHelper.db.select().from(posts).where(eq(posts.id, postId));
    return post;
  }

  function errorCode(result: ExecutionResult<unknown>): string | undefined {
    return (result.errors?.[0].originalError as { code?: string } | undefined)?.code;
  }

  // ─── Acceptance across every Post type ─────────────────────────────────

  describe('every Post type is reportable through the same operation', () => {
    it.each([...POST_TYPES])('accepts and durably stores a %s Post Report', async (postType) => {
      const post = await createPost(postType);

      const result = await report(post.id, reporter, { reason: 'SCAM' });

      expect(result.errors).toBeUndefined();
      expect(result.data?.reportPost).toBe(true);

      const rows = await storedReports(post.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        postId: post.id,
        reporterId: reporter.id,
        reason: 'SCAM',
        details: null,
      });

      const updated = await findPost(post.id);
      expect(updated.reportCount).toBe(1);
      expect(updated.moderationStatus).toBe('FLAGGED');
      expect(updated.status).toBe('ACTIVE');
    });

    it('reports all five types from one reporter without crossing the shared allowance', async () => {
      for (const postType of POST_TYPES) {
        const post = await createPost(postType);
        const result = await report(post.id);
        expect(result.errors).toBeUndefined();
        expect(result.data?.reportPost).toBe(true);
      }

      const rows = await dbHelper.db.select().from(postReports).where(eq(postReports.reporterId, reporter.id));
      expect(rows).toHaveLength(POST_TYPES.length);
    });
  });

  // ─── Details normalization and validation ──────────────────────────────

  describe('details normalization and validation', () => {
    it('trims details before storing them', async () => {
      const post = await createPost('ADOPTION');

      const result = await report(post.id, reporter, { details: '  misleading listing details  ' });

      expect(result.errors).toBeUndefined();
      const [row] = await storedReports(post.id);
      expect(row.details).toBe('misleading listing details');
    });

    it('stores blank details as absent', async () => {
      const post = await createPost('ADOPTION');

      const result = await report(post.id, reporter, { details: '   ' });

      expect(result.errors).toBeUndefined();
      const [row] = await storedReports(post.id);
      expect(row.details).toBeNull();
    });

    it('accepts details at 500 characters and rejects 501', async () => {
      const acceptedPost = await createPost('PRODUCT');
      const accepted = await report(acceptedPost.id, reporter, { details: 'a'.repeat(500) });
      expect(accepted.errors).toBeUndefined();
      const [acceptedRow] = await storedReports(acceptedPost.id);
      expect(acceptedRow.details).toHaveLength(500);

      const rejectedPost = await createPost('PRODUCT');
      const rejected = await report(rejectedPost.id, reporter, { details: 'a'.repeat(501) });
      expect(rejected.errors).toBeDefined();
      expect(errorCode(rejected)).toBe('VALIDATION_ERROR');
      expect(await storedReports(rejectedPost.id)).toHaveLength(0);
      expect(await admissionsFor(reporter.id)).toHaveLength(1);
    });

    it('requires nonblank details when reason is OTHER', async () => {
      const post = await createPost('MATING');

      for (const details of [undefined, null, '', '   ']) {
        const rejected = await report(post.id, reporter, { reason: 'OTHER', details });
        expect(rejected.errors).toBeDefined();
        expect(errorCode(rejected)).toBe('VALIDATION_ERROR');
      }
      expect(await storedReports(post.id)).toHaveLength(0);

      const accepted = await report(post.id, reporter, { reason: 'OTHER', details: '  unique context  ' });
      expect(accepted.errors).toBeUndefined();
      expect(accepted.data?.reportPost).toBe(true);
      const [row] = await storedReports(post.id);
      expect(row.reason).toBe('OTHER');
      expect(row.details).toBe('unique context');
    });

    it('rejects a malformed Post ID before reserving the allowance', async () => {
      const result = await report('not-a-uuid');

      expect(result.errors).toBeDefined();
      expect(errorCode(result)).toBe('VALIDATION_ERROR');
      expect(await admissionsFor(reporter.id)).toHaveLength(0);
    });
  });

  // ─── Rejections without consuming the shared allowance ─────────────────

  describe('rejected reports consume no shared allowance', () => {
    it('rejects self-reporting', async () => {
      const post = await createPost('RESCUE', { creatorId: author.id });

      const result = await report(post.id, author);

      expect(result.errors).toBeDefined();
      expect(errorCode(result)).toBe('FORBIDDEN');
      expect(await storedReports(post.id)).toHaveLength(0);
      expect(await admissionsFor(author.id)).toHaveLength(0);
      const unchanged = await findPost(post.id);
      expect(unchanged.reportCount).toBe(0);
      expect(unchanged.moderationStatus).toBe('CLEAN');
      expect(unchanged.status).toBe('ACTIVE');
    });

    it('rejects a Post that does not exist', async () => {
      const missingPostId = generateUuidV7();

      const result = await report(missingPostId);

      expect(result.errors).toBeDefined();
      expect(errorCode(result)).toBe('NOT_FOUND');
      expect(await admissionsFor(reporter.id)).toHaveLength(0);
    });

    it('rejects a Removed Post', async () => {
      const post = await createPost('LOST', { status: 'REMOVED' });

      const result = await report(post.id);

      expect(result.errors).toBeDefined();
      expect(errorCode(result)).toBe('NOT_FOUND');
      expect(await storedReports(post.id)).toHaveLength(0);
      expect(await admissionsFor(reporter.id)).toHaveLength(0);
      const removed = await findPost(post.id);
      expect(removed.reportCount).toBe(0);
    });

    it('rejects a duplicate reporter/Post pair without consuming a second slot', async () => {
      const post = await createPost('LOST');

      const first = await report(post.id);
      expect(first.errors).toBeUndefined();
      expect(first.data?.reportPost).toBe(true);

      const duplicate = await report(post.id);
      expect(duplicate.errors).toBeDefined();
      expect(errorCode(duplicate)).toBe('POST_ALREADY_REPORTED');

      expect(await storedReports(post.id)).toHaveLength(1);
      expect(await admissionsFor(reporter.id)).toHaveLength(1);
      const updated = await findPost(post.id);
      expect(updated.reportCount).toBe(1);
    });

    it('serializes concurrent duplicate reports into exactly one accepted slot', async () => {
      const post = await createPost('ADOPTION');

      const [first, second] = await Promise.all([report(post.id), report(post.id)]);
      const results = [first, second];

      expect(results.filter((result) => !result.errors && result.data?.reportPost === true)).toHaveLength(1);
      expect(results.filter((result) => errorCode(result) === 'POST_ALREADY_REPORTED')).toHaveLength(1);

      expect(await storedReports(post.id)).toHaveLength(1);
      expect(await admissionsFor(reporter.id)).toHaveLength(1);
      expect((await findPost(post.id)).reportCount).toBe(1);
    });

    it('keeps full allowance capacity after rejected attempts', async () => {
      // Four distinct rejection paths, none of which may consume a slot.
      const ownPost = await createPost('RESCUE', { creatorId: reporter.id });
      expect(errorCode(await report(ownPost.id, reporter))).toBe('FORBIDDEN');

      expect(errorCode(await report(generateUuidV7()))).toBe('NOT_FOUND');

      const removedPost = await createPost('LOST', { status: 'REMOVED' });
      expect(errorCode(await report(removedPost.id))).toBe('NOT_FOUND');

      const duplicatePost = await createPost('PRODUCT');
      expect((await report(duplicatePost.id)).data?.reportPost).toBe(true);
      expect(errorCode(await report(duplicatePost.id))).toBe('POST_ALREADY_REPORTED');

      expect(await admissionsFor(reporter.id)).toHaveLength(1);

      // The one accepted report above plus nine more fills the ten-slot budget.
      for (let index = 0; index < 9; index += 1) {
        const post = await createPost('RESCUE');
        const result = await report(post.id);
        expect(result.errors).toBeUndefined();
        expect(result.data?.reportPost).toBe(true);
      }

      const overflowPost = await createPost('RESCUE');
      expect(errorCode(await report(overflowPost.id))).toBe('RATE_LIMITED');
      expect(await dbHelper.db.select().from(postReports).where(eq(postReports.reporterId, reporter.id))).toHaveLength(
        10,
      );
    });
  });

  // ─── Shared allowance participation ────────────────────────────────────

  describe('shared moderation-report allowance', () => {
    it('links each accepted report to its admission and stops at ten', async () => {
      const targetPosts: Post[] = [];
      for (let i = 0; i < 11; i += 1) {
        targetPosts.push(await createPost('RESCUE'));
      }

      for (let i = 0; i < 10; i += 1) {
        const result = await report(targetPosts[i].id);
        expect(result.errors).toBeUndefined();
        expect(result.data?.reportPost).toBe(true);
      }

      const rejected = await report(targetPosts[10].id);
      expect(rejected.errors).toBeDefined();
      expect(errorCode(rejected)).toBe('RATE_LIMITED');

      const admissions = await admissionsFor(reporter.id);
      const rows = await dbHelper.db.select().from(postReports).where(eq(postReports.reporterId, reporter.id));
      expect(admissions).toHaveLength(10);
      expect(rows).toHaveLength(10);
      expect(new Set(rows.map((row) => row.id))).toEqual(new Set(admissions.map((admission) => admission.id)));

      const untouched = await findPost(targetPosts[10].id);
      expect(untouched.reportCount).toBe(0);
      expect(untouched.moderationStatus).toBe('CLEAN');
    });
  });

  // ─── Moderation workflow state ─────────────────────────────────────────

  describe('moderation workflow state', () => {
    it('flags a CLEAN Post for review while leaving it ACTIVE', async () => {
      const post = await createPost('ADOPTION', { moderationStatus: 'CLEAN' });

      const result = await report(post.id);
      expect(result.errors).toBeUndefined();

      const updated = await findPost(post.id);
      expect(updated.moderationStatus).toBe('FLAGGED');
      expect(updated.status).toBe('ACTIVE');
      expect(updated.reportCount).toBe(1);
    });

    it('preserves PENDING_AUTO_REVIEW and already FLAGGED moderation states', async () => {
      const pending = await createPost('RESCUE', { moderationStatus: 'PENDING_AUTO_REVIEW' });
      const pendingResult = await report(pending.id);
      expect(pendingResult.errors).toBeUndefined();
      expect((await findPost(pending.id)).moderationStatus).toBe('PENDING_AUTO_REVIEW');

      const flagged = await createPost('PRODUCT', { moderationStatus: 'FLAGGED' });
      const flaggedResult = await report(flagged.id);
      expect(flaggedResult.errors).toBeUndefined();
      expect((await findPost(flagged.id)).moderationStatus).toBe('FLAGGED');
    });

    it('never automatically removes a Post no matter how many reports accumulate', async () => {
      const post = await createPost('MATING');

      const reporters = await Promise.all(Array.from({ length: 12 }, (_, index) => createUser(`reporter-${index}`)));

      for (let index = 0; index < reporters.length; index += 1) {
        const result = await report(post.id, reporters[index], {
          reason: index % 2 === 0 ? 'INAPPROPRIATE_CONTENT' : 'SCAM',
        });
        expect(result.errors).toBeUndefined();
        expect(result.data?.reportPost).toBe(true);
      }

      const updated = await findPost(post.id);
      expect(updated.status).toBe('ACTIVE');
      expect(updated.moderationStatus).toBe('FLAGGED');
      expect(updated.reportCount).toBe(12);
      expect(await storedReports(post.id)).toHaveLength(12);
    });

    it('does not disturb the existing lifecycle workflow for a flagged Post owner', async () => {
      const post = await createPost('RESCUE', { moderationStatus: 'CLEAN' });

      const result = await report(post.id);
      expect(result.errors).toBeUndefined();

      const resolved = await postsService.updatePostStatus(post.id, author.id, 'RESOLVED');
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.moderationStatus).toBe('FLAGGED');
    });
  });

  // ─── Administrator visibility ──────────────────────────────────────────

  describe('administrator visibility', () => {
    it('surfaces the accepted report to the existing resource and needs-review queue', async () => {
      const post = await createPost('RESCUE');

      const result = await report(post.id, reporter, { reason: 'UNRELATED_TO_ANIMALS', details: 'not a pet post' });
      expect(result.errors).toBeUndefined();

      // The AdminJS `post_reports` resource reads this table directly.
      const reports = await storedReports(post.id);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        postId: post.id,
        reporterId: reporter.id,
        reason: 'UNRELATED_TO_ANIMALS',
        details: 'not a pet post',
      });

      // Mirrors the admin dashboard's needs-review query.
      const needsReview = await dbHelper.pool.query<{
        id: string;
        report_count: number;
        moderation_status: string;
        status: string;
      }>(
        `SELECT id, report_count, moderation_status, status
           FROM posts
          WHERE moderation_status IN ('PENDING_AUTO_REVIEW', 'FLAGGED') AND status = 'ACTIVE'
          ORDER BY report_count DESC, created_at DESC`,
      );
      expect(needsReview.rows.map((row) => row.id)).toContain(post.id);
      expect(needsReview.rows.find((row) => row.id === post.id)?.report_count).toBe(1);
    });
  });
});
