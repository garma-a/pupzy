import { and, eq, sql } from 'drizzle-orm';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const request = require('supertest');
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  accountReports,
  adminUsers,
  adoptionApplications,
  blocks,
  cities,
  commentQuotaAdmissions,
  commentReports,
  comments,
  contactRequests,
  moderationActions,
  notifications,
  postReports,
  posts,
  users,
  type User,
} from '../database/schema';
import { AccountReportsRepository } from './account-reports.repository';
import { AccountReportsService } from './account-reports.service';
import { AccountReportsResolver } from './account-reports.resolver';
import { ModerationReportQuotaManager } from '../moderation-reports/moderation-report-quota.manager';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { CitiesService } from '../cities/cities.service';
import { GqlExceptionFilter } from '../common/filters/gql-exception.filter';
import { FirebaseAuthGuard } from '../auth/firebase.guard';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

const REPORT_USER_MUTATION = `
  mutation ReportUser($input: ReportUserInput!) {
    reportUser(input: $input)
  }
`;

interface GqlErrorBody {
  message: string;
  extensions?: { code?: string };
}

interface GqlResponseBody {
  data?: { reportUser?: boolean } | null;
  errors?: GqlErrorBody[];
}

describe('Pupzy Account Reports (integration)', () => {
  let dbHelper: TestDatabaseHelper;
  let app: INestApplication;
  let mockVerifyIdToken: jest.Mock;
  let mockCacheManager: jest.Mocked<Cache>;
  let accountReportsRepository: AccountReportsRepository;
  let accountReportsService: AccountReportsService;
  let cacheStore: Map<string, unknown>;
  let sequence = 0;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined as unknown as INestApplication;
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    jest.clearAllMocks();

    sequence = 0;
    cacheStore = new Map<string, unknown>();
    mockCacheManager = {
      get: jest.fn().mockImplementation((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn().mockImplementation((key: string, val: unknown) => {
        cacheStore.set(key, val);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((key: string) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<Cache>;

    mockVerifyIdToken = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const authModule = require('firebase-admin/auth');
    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
      deleteUser: jest.fn().mockResolvedValue(undefined),
    });

    const accountDeletionRepo = new AccountDeletionRepository(dbHelper.db);
    const usersRepo = new UsersRepository(dbHelper.db);
    const config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'PHONE_ENCRYPTION_KEY') return 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
        return undefined;
      }),
    } as unknown as ConfigService;
    const usersService = new UsersService(
      usersRepo,
      {} as unknown as CitiesService,
      accountDeletionRepo,
      config,
      mockCacheManager,
    );

    const quotaManager = new ModerationReportQuotaManager(dbHelper.db);
    accountReportsRepository = new AccountReportsRepository(dbHelper.db);
    accountReportsService = new AccountReportsService(accountReportsRepository, quotaManager);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          typePaths: [join(process.cwd(), 'src/**/*.graphql')],
          context: ({ req }: { req: unknown }) => ({ req }),
        }),
      ],
      providers: [
        AccountReportsResolver,
        { provide: AccountReportsService, useValue: accountReportsService },
        { provide: UsersService, useValue: usersService },
        { provide: AccountDeletionRepository, useValue: accountDeletionRepo },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: FIREBASE_ADMIN_TOKEN, useValue: {} },
        { provide: APP_GUARD, useClass: FirebaseAuthGuard },
        { provide: APP_FILTER, useClass: GqlExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  // ─── Fixtures ─────────────────────────────────────────────────────────────

  async function seedCity(): Promise<string> {
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
    return city.id;
  }

  async function seedUser(label: string, options: { isBanned?: boolean } = {}): Promise<User> {
    sequence += 1;
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${sequence}-${generateUuidV7()}`,
        email: `${label}-${sequence}-${generateUuidV7()}@example.com`,
        fullName: `Account ${label}`,
        isBanned: options.isBanned ?? false,
      })
      .returning();
    return user;
  }

  async function seedPost(
    creatorId: string,
    cityId: string,
    options: { status?: 'ACTIVE' | 'RESOLVED' | 'REMOVED' } = {},
  ) {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId,
        postType: 'ADOPTION',
        title: `Post ${generateUuidV7()}`,
        description: 'Description',
        status: options.status ?? 'ACTIVE',
        cityId,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  async function seedComment(params: {
    postId: string;
    authorId: string;
    parentId?: string;
    status?: 'ACTIVE' | 'IMAGE_HIDDEN' | 'HIDDEN' | 'DELETED';
  }) {
    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: params.postId,
        authorId: params.authorId,
        parentId: params.parentId ?? null,
        text: 'A discussion contribution',
        status: params.status ?? 'ACTIVE',
      })
      .returning();
    return comment;
  }

  async function seedContactRequest(postId: string, requesterId: string) {
    const [contactRequest] = await dbHelper.db
      .insert(contactRequests)
      .values({ postId, requesterId, message: 'Please share contact details' })
      .returning();
    return contactRequest;
  }

  async function seedAdoptionApplication(targetPostId: string, applicantId: string) {
    const [application] = await dbHelper.db
      .insert(adoptionApplications)
      .values({
        targetPostId,
        applicantId,
        livingSituation: 'APARTMENT',
        hasOutdoorAccess: false,
        hasOtherPetsAtHome: false,
        hasChildrenAtHome: false,
        whyAdopt: 'I want to give the pet a home',
      })
      .returning();
    return application;
  }

  function authenticateAs(user: User): void {
    mockVerifyIdToken.mockResolvedValue({
      uid: user.firebaseUserId,
      auth_time: Math.floor(Date.now() / 1000) - 10,
      firebase: { sign_in_provider: 'google.com' },
    });
  }

  async function reportUser(input: Record<string, unknown>, token = 'valid-firebase-token') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const req = request(app.getHttpServer()).post('/graphql');
    if (token) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      req.set('Authorization', `Bearer ${token}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const res = (await req.send({ query: REPORT_USER_MUTATION, variables: { input } })) as { body: GqlResponseBody };
    return res.body;
  }

  async function countAdmissions(reporterId: string): Promise<number> {
    const rows = await dbHelper.db
      .select()
      .from(commentQuotaAdmissions)
      .where(
        and(eq(commentQuotaAdmissions.userId, reporterId), eq(commentQuotaAdmissions.action, 'MODERATION_REPORT')),
      );
    return rows.length;
  }

  async function findReports(reporterId: string, reportedUserId: string) {
    return dbHelper.db
      .select()
      .from(accountReports)
      .where(and(eq(accountReports.reporterId, reporterId), eq(accountReports.reportedUserId, reportedUserId)));
  }

  // ─── Submission ───────────────────────────────────────────────────────────

  describe('submission through authenticated GraphQL', () => {
    it('accepts every account-report reason and persists a durable open report', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);

      const reasons = [
        'HARASSMENT',
        'SPAM',
        'SCAM_OR_FRAUD',
        'IMPERSONATION',
        'INAPPROPRIATE_CONDUCT',
        'SAFETY_CONCERN',
        'OTHER',
      ];

      for (const reason of reasons) {
        const target = await seedUser(`target-${reason.toLowerCase()}`);
        const body = await reportUser({
          userId: target.id,
          reason,
          ...(reason === 'OTHER' ? { details: 'Something uncategorized' } : {}),
        });

        expect(body.errors).toBeUndefined();
        expect(body.data?.reportUser).toBe(true);

        const [row] = await findReports(reporter.id, target.id);
        expect(row.reason).toBe(reason);
        expect(row.reviewedAt).toBeNull();
        expect(row.reviewedByAdminId).toBeNull();
        expect(row.reviewOutcome).toBeNull();
        expect(row.createdAt).toBeInstanceOf(Date);
      }

      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(reasons.length);
      expect(await countAdmissions(reporter.id)).toBe(reasons.length);
    });

    it('trims details and stores blank non-OTHER details as absent', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const secondTarget = await seedUser('second-target');
      authenticateAs(reporter);

      expect(
        (await reportUser({ userId: target.id, reason: 'SPAM', details: '  keep this  ' })).errors,
      ).toBeUndefined();
      expect((await reportUser({ userId: secondTarget.id, reason: 'SPAM', details: '   ' })).errors).toBeUndefined();

      const trimmed = await findReports(reporter.id, target.id);
      expect(trimmed[0].details).toBe('keep this');
      const blank = await findReports(reporter.id, secondTarget.id);
      expect(blank[0].details).toBeNull();
    });

    it('requires nonblank details for OTHER and consumes nothing when missing', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);
      const target = await seedUser('target');

      for (const details of [undefined, null, '   ']) {
        const body = await reportUser({ userId: target.id, reason: 'OTHER', details });
        expect(body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
      }

      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
      expect(await countAdmissions(reporter.id)).toBe(0);
    });

    it('rejects details over 500 characters without consuming quota', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);
      const target = await seedUser('target');

      const body = await reportUser({ userId: target.id, reason: 'SPAM', details: 'a'.repeat(501) });
      expect(body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');

      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
      expect(await countAdmissions(reporter.id)).toBe(0);
    });

    it('rejects content-only report reasons before touching persistence', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);
      const target = await seedUser('target');

      const body = await reportUser({ userId: target.id, reason: 'DUPLICATE' });
      expect(body.errors).toBeDefined();
      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
      expect(await countAdmissions(reporter.id)).toBe(0);
    });
  });

  // ─── Rejections ───────────────────────────────────────────────────────────

  describe('rejections consume no quota', () => {
    it('rejects self-reporting at the mutation and the database', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);

      const body = await reportUser({ userId: reporter.id, reason: 'HARASSMENT' });
      expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
      expect(await countAdmissions(reporter.id)).toBe(0);

      await expect(
        dbHelper.db
          .insert(accountReports)
          .values({ reporterId: reporter.id, reportedUserId: reporter.id, reason: 'SPAM' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a case-variant self target as FORBIDDEN without reaching the database constraint', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);

      const body = await reportUser({ userId: reporter.id.toUpperCase(), reason: 'HARASSMENT' });
      expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
      expect(await countAdmissions(reporter.id)).toBe(0);
    });

    it('rejects a missing reported account without consuming quota', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);

      const body = await reportUser({ userId: generateUuidV7(), reason: 'SPAM' });
      expect(body.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
      expect(await countAdmissions(reporter.id)).toBe(0);
    });

    it('rejects a duplicate open reporter/target pair with one persisted report', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      const first = await reportUser({ userId: target.id, reason: 'SPAM' });
      expect(first.errors).toBeUndefined();
      expect(first.data?.reportUser).toBe(true);

      const second = await reportUser({ userId: target.id, reason: 'SCAM_OR_FRAUD' });
      expect(second.errors?.[0]?.extensions?.code).toBe('ACCOUNT_ALREADY_REPORTED');

      expect(await findReports(reporter.id, target.id)).toHaveLength(1);
      expect(await countAdmissions(reporter.id)).toBe(1);
    });

    it('lets one reporter with rejected attempts still commit the full allowance', async () => {
      const reporter = await seedUser('reporter');
      const targets = [];
      for (let i = 0; i < 11; i += 1) {
        targets.push(await seedUser(`target-${i}`));
      }
      authenticateAs(reporter);

      // Invalid attempts: self, missing, duplicate, invalid source, zod failures.
      const selfAttempt = await reportUser({ userId: reporter.id, reason: 'SPAM' });
      expect(selfAttempt.errors).toBeDefined();
      const missingAttempt = await reportUser({ userId: generateUuidV7(), reason: 'SPAM' });
      expect(missingAttempt.errors).toBeDefined();
      const first = await reportUser({ userId: targets[0].id, reason: 'SPAM' });
      expect(first.data?.reportUser).toBe(true);
      const duplicateAttempt = await reportUser({ userId: targets[0].id, reason: 'SPAM' });
      expect(duplicateAttempt.errors?.[0]?.extensions?.code).toBe('ACCOUNT_ALREADY_REPORTED');
      const invalidSource = await reportUser({
        userId: targets[1].id,
        reason: 'SPAM',
        sourceType: 'POST',
        sourceId: generateUuidV7(),
      });
      expect(invalidSource.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
      const invalidDetails = await reportUser({ userId: targets[1].id, reason: 'OTHER' });
      expect(invalidDetails.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');

      // One committed + nine more = ten accepted.
      for (let i = 1; i < 10; i += 1) {
        const body = await reportUser({ userId: targets[i].id, reason: 'SAFETY_CONCERN' });
        expect(body.errors).toBeUndefined();
        expect(body.data?.reportUser).toBe(true);
      }

      const eleventh = await reportUser({ userId: targets[10].id, reason: 'SAFETY_CONCERN' });
      expect(eleventh.errors?.[0]?.extensions?.code).toBe('RATE_LIMITED');

      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(10);
      expect(await countAdmissions(reporter.id)).toBe(10);
    });
  });

  // ─── One open report ──────────────────────────────────────────────────────

  describe('one open report per reporter and reported account', () => {
    it('permits a new report after the previous one is reviewed', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      expect((await reportUser({ userId: target.id, reason: 'SPAM' })).data?.reportUser).toBe(true);

      await dbHelper.db
        .update(accountReports)
        .set({ reviewedAt: new Date(), reviewOutcome: 'NO_ACTION' })
        .where(and(eq(accountReports.reporterId, reporter.id), eq(accountReports.reportedUserId, target.id)));

      const second = await reportUser({ userId: target.id, reason: 'HARASSMENT' });
      expect(second.errors).toBeUndefined();
      expect(second.data?.reportUser).toBe(true);

      const rows = await findReports(reporter.id, target.id);
      expect(rows).toHaveLength(2);
      expect(await countAdmissions(reporter.id)).toBe(2);
    });

    it('serializes concurrent duplicates to one committed report and one allowance slot', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      const [first, second] = await Promise.all([
        reportUser({ userId: target.id, reason: 'SPAM' }),
        reportUser({ userId: target.id, reason: 'SCAM_OR_FRAUD' }),
      ]);

      const successes = [first, second].filter((body) => body.data?.reportUser === true);
      const conflicts = [first, second].filter(
        (body) => body.errors?.[0]?.extensions?.code === 'ACCOUNT_ALREADY_REPORTED',
      );
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(await findReports(reporter.id, target.id)).toHaveLength(1);
      expect(await countAdmissions(reporter.id)).toBe(1);
    });

    it('enforces the one-open-report rule with a partial unique index', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');

      await dbHelper.db
        .insert(accountReports)
        .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM' });

      await expect(
        dbHelper.db
          .insert(accountReports)
          .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });

      await dbHelper.db
        .update(accountReports)
        .set({ reviewedAt: new Date(), reviewOutcome: 'ACTION_TAKEN' })
        .where(and(eq(accountReports.reporterId, reporter.id), eq(accountReports.reportedUserId, target.id)));

      const [reviewedReplacement] = await dbHelper.db
        .insert(accountReports)
        .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'HARASSMENT' })
        .returning();
      expect(reviewedReplacement.reviewedAt).toBeNull();

      expect(await findReports(reporter.id, target.id)).toHaveLength(2);
    });

    it('does not conflate the reverse reporter/target direction', async () => {
      const first = await seedUser('first');
      const second = await seedUser('second');
      authenticateAs(first);

      expect((await reportUser({ userId: second.id, reason: 'SPAM' })).data?.reportUser).toBe(true);
      authenticateAs(second);
      expect((await reportUser({ userId: first.id, reason: 'SPAM' })).data?.reportUser).toBe(true);

      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(2);
    });
  });

  // ─── Source context ───────────────────────────────────────────────────────

  describe('validated source context', () => {
    it('accepts no source context at all', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      expect((await reportUser({ userId: target.id, reason: 'SPAM' })).data?.reportUser).toBe(true);
      const [row] = await findReports(reporter.id, target.id);
      expect(row.sourceType).toBeNull();
      expect(row.sourceId).toBeNull();
    });

    it('accepts a Post authored by the reported account and stores it as evidence only', async () => {
      const cityId = await seedCity();
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const post = await seedPost(target.id, cityId);
      authenticateAs(reporter);

      const body = await reportUser({
        userId: target.id,
        reason: 'INAPPROPRIATE_CONDUCT',
        sourceType: 'POST',
        sourceId: post.id,
      });
      expect(body.errors).toBeUndefined();

      const [row] = await findReports(reporter.id, target.id);
      expect(row.sourceType).toBe('POST');
      expect(row.sourceId).toBe(post.id);

      // Evidence only: no Post Report was created and no report counter moved.
      expect(await dbHelper.db.select().from(postReports)).toHaveLength(0);
      const [refreshedPost] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
      expect(refreshedPost.reportCount).toBe(0);
    });

    it('rejects a Post source not authored by the reported account or removed', async () => {
      const cityId = await seedCity();
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const other = await seedUser('other');
      const targetPost = await seedPost(target.id, cityId);
      const otherPost = await seedPost(other.id, cityId);
      const removedPost = await seedPost(target.id, cityId, { status: 'REMOVED' });
      authenticateAs(reporter);

      for (const sourceId of [otherPost.id, removedPost.id, generateUuidV7()]) {
        const body = await reportUser({
          userId: target.id,
          reason: 'SPAM',
          sourceType: 'POST',
          sourceId,
        });
        expect(body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
      }

      // The valid target post still works afterwards; invalid attempts consumed nothing else.
      const valid = await reportUser({
        userId: target.id,
        reason: 'SPAM',
        sourceType: 'POST',
        sourceId: targetPost.id,
      });
      expect(valid.errors).toBeUndefined();
      expect(await countAdmissions(reporter.id)).toBe(1);
    });

    it('accepts a top-level Comment and a Reply authored by the reported account', async () => {
      const cityId = await seedCity();
      const reporter = await seedUser('reporter');
      const secondReporter = await seedUser('second-reporter');
      const target = await seedUser('target');
      const post = await seedPost(target.id, cityId);
      const targetComment = await seedComment({ postId: post.id, authorId: target.id });
      const targetReply = await seedComment({ postId: post.id, authorId: target.id, parentId: targetComment.id });

      authenticateAs(reporter);
      const commentReport = await reportUser({
        userId: target.id,
        reason: 'HARASSMENT',
        sourceType: 'COMMENT',
        sourceId: targetComment.id,
      });
      expect(commentReport.errors).toBeUndefined();

      authenticateAs(secondReporter);
      const replyReport = await reportUser({
        userId: target.id,
        reason: 'HARASSMENT',
        sourceType: 'COMMENT',
        sourceId: targetReply.id,
      });
      expect(replyReport.errors).toBeUndefined();

      const [commentRow] = await findReports(reporter.id, target.id);
      const [replyRow] = await findReports(secondReporter.id, target.id);
      expect(commentRow.sourceId).toBe(targetComment.id);
      expect(replyRow.sourceId).toBe(targetReply.id);

      // Evidence only: no Comment Report rows were created.
      expect(await dbHelper.db.select().from(commentReports)).toHaveLength(0);
    });

    it('rejects Comment sources that are inaccessible or authored by someone else', async () => {
      const cityId = await seedCity();
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const other = await seedUser('other');
      const post = await seedPost(target.id, cityId);
      const removedPost = await seedPost(target.id, cityId, { status: 'REMOVED' });

      const otherComment = await seedComment({ postId: post.id, authorId: other.id });
      const hiddenComment = await seedComment({ postId: post.id, authorId: target.id, status: 'HIDDEN' });
      const deletedComment = await seedComment({ postId: post.id, authorId: target.id, status: 'DELETED' });
      const commentOnRemovedPost = await seedComment({ postId: removedPost.id, authorId: target.id });
      authenticateAs(reporter);

      for (const sourceId of [
        otherComment.id,
        hiddenComment.id,
        deletedComment.id,
        commentOnRemovedPost.id,
        generateUuidV7(),
      ]) {
        const body = await reportUser({
          userId: target.id,
          reason: 'SPAM',
          sourceType: 'COMMENT',
          sourceId,
        });
        expect(body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
      }

      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
      expect(await countAdmissions(reporter.id)).toBe(0);
    });

    it('accepts a Contact Request only when reporter and reported account are the two participants', async () => {
      const cityId = await seedCity();
      const ownerReporter = await seedUser('owner-reporter');
      const requesterReporter = await seedUser('requester-reporter');
      const target = await seedUser('target');
      const thirdParty = await seedUser('third');
      const targetPost = await seedPost(target.id, cityId);
      const ownerReporterPost = await seedPost(ownerReporter.id, cityId);
      const thirdPartyPost = await seedPost(thirdParty.id, cityId);

      // The reported account requested contact on the reporter's post.
      const targetRequestedOnOwnerPost = await seedContactRequest(ownerReporterPost.id, target.id);
      // The reporter requested contact on the reported account's post.
      const requesterRequestedOnTargetPost = await seedContactRequest(targetPost.id, requesterReporter.id);
      const unrelatedRequest = await seedContactRequest(thirdPartyPost.id, thirdParty.id);

      authenticateAs(ownerReporter);
      expect(
        (
          await reportUser({
            userId: target.id,
            reason: 'SAFETY_CONCERN',
            sourceType: 'CONTACT_REQUEST',
            sourceId: targetRequestedOnOwnerPost.id,
          })
        ).errors,
      ).toBeUndefined();

      authenticateAs(requesterReporter);
      expect(
        (
          await reportUser({
            userId: target.id,
            reason: 'SAFETY_CONCERN',
            sourceType: 'CONTACT_REQUEST',
            sourceId: requesterRequestedOnTargetPost.id,
          })
        ).errors,
      ).toBeUndefined();

      authenticateAs(thirdParty);
      const unrelated = await reportUser({
        userId: target.id,
        reason: 'SAFETY_CONCERN',
        sourceType: 'CONTACT_REQUEST',
        sourceId: unrelatedRequest.id,
      });
      expect(unrelated.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');

      const [ownerRow] = await findReports(ownerReporter.id, target.id);
      const [requesterRow] = await findReports(requesterReporter.id, target.id);
      expect(ownerRow.sourceType).toBe('CONTACT_REQUEST');
      expect(requesterRow.sourceType).toBe('CONTACT_REQUEST');
    });

    it('accepts an Adoption Application only when reporter and reported account are the two participants', async () => {
      const cityId = await seedCity();
      const ownerReporter = await seedUser('owner-reporter');
      const applicantReporter = await seedUser('applicant-reporter');
      const target = await seedUser('target');
      const thirdParty = await seedUser('third');
      const targetPost = await seedPost(target.id, cityId);
      const ownerReporterPost = await seedPost(ownerReporter.id, cityId);
      const thirdPartyPost = await seedPost(thirdParty.id, cityId);

      // The reported account applied to the reporter's adoption post.
      const targetAppliedToOwnerPost = await seedAdoptionApplication(ownerReporterPost.id, target.id);
      // The reporter applied to the reported account's adoption post.
      const applicantAppliedToTargetPost = await seedAdoptionApplication(targetPost.id, applicantReporter.id);
      const unrelatedApplication = await seedAdoptionApplication(thirdPartyPost.id, thirdParty.id);

      authenticateAs(ownerReporter);
      expect(
        (
          await reportUser({
            userId: target.id,
            reason: 'SCAM_OR_FRAUD',
            sourceType: 'ADOPTION_APPLICATION',
            sourceId: targetAppliedToOwnerPost.id,
          })
        ).errors,
      ).toBeUndefined();

      authenticateAs(applicantReporter);
      expect(
        (
          await reportUser({
            userId: target.id,
            reason: 'SCAM_OR_FRAUD',
            sourceType: 'ADOPTION_APPLICATION',
            sourceId: applicantAppliedToTargetPost.id,
          })
        ).errors,
      ).toBeUndefined();

      authenticateAs(thirdParty);
      const unrelated = await reportUser({
        userId: target.id,
        reason: 'SCAM_OR_FRAUD',
        sourceType: 'ADOPTION_APPLICATION',
        sourceId: unrelatedApplication.id,
      });
      expect(unrelated.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');

      expect(await findReports(ownerReporter.id, target.id)).toHaveLength(1);
      expect(await findReports(applicantReporter.id, target.id)).toHaveLength(1);
    });

    it('rejects half-supplied source references', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      const typeOnly = await reportUser({ userId: target.id, reason: 'SPAM', sourceType: 'POST' });
      expect(typeOnly.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');

      const idOnly = await reportUser({ userId: target.id, reason: 'SPAM', sourceId: generateUuidV7() });
      expect(idOnly.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');

      expect(await countAdmissions(reporter.id)).toBe(0);
    });

    it('enforces the source pair database check for direct writes', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');

      await expect(
        dbHelper.db
          .insert(accountReports)
          .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM', sourceType: 'POST' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      await expect(
        dbHelper.db
          .insert(accountReports)
          .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM', sourceId: generateUuidV7() }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });

  // ─── Shared allowance ─────────────────────────────────────────────────────

  describe('shared moderation-report allowance', () => {
    it('allows ten committed account reports per rolling 24 hours and rejects the eleventh', async () => {
      const reporter = await seedUser('reporter');
      authenticateAs(reporter);

      for (let i = 0; i < 10; i += 1) {
        const target = await seedUser(`target-${i}`);
        const body = await reportUser({ userId: target.id, reason: 'SPAM' });
        expect(body.errors).toBeUndefined();
      }

      const overflowTarget = await seedUser('target-overflow');
      const overflow = await reportUser({ userId: overflowTarget.id, reason: 'SPAM' });
      expect(overflow.errors?.[0]?.extensions?.code).toBe('RATE_LIMITED');
      expect(await countAdmissions(reporter.id)).toBe(10);
      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(10);
    });

    it('shares the allowance with committed Comment Reports', async () => {
      const cityId = await seedCity();
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const post = await seedPost(target.id, cityId);
      const comment = await seedComment({ postId: post.id, authorId: target.id });

      // A committed Comment Report admitted through the shared seam counts one slot.
      const admissionId = generateUuidV7();
      await dbHelper.db.insert(commentQuotaAdmissions).values({
        id: admissionId,
        userId: reporter.id,
        action: 'MODERATION_REPORT',
        createdAt: new Date(),
      });
      await dbHelper.db
        .insert(commentReports)
        .values({ id: admissionId, commentId: comment.id, reporterId: reporter.id, reason: 'SPAM' });

      authenticateAs(reporter);
      for (let i = 0; i < 9; i += 1) {
        const nextTarget = await seedUser(`target-${i}`);
        const body = await reportUser({ userId: nextTarget.id, reason: 'SPAM' });
        expect(body.errors).toBeUndefined();
      }

      const overflowTarget = await seedUser('target-overflow');
      const overflow = await reportUser({ userId: overflowTarget.id, reason: 'SPAM' });
      expect(overflow.errors?.[0]?.extensions?.code).toBe('RATE_LIMITED');
      expect(await countAdmissions(reporter.id)).toBe(10);
    });

    it('counts committed account-report rows that never admitted through the seam', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');

      // Simulate a committed row recorded outside the admission seam.
      await dbHelper.db
        .insert(accountReports)
        .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM' });

      authenticateAs(reporter);
      for (let i = 0; i < 9; i += 1) {
        const nextTarget = await seedUser(`target-${i}`);
        const body = await reportUser({ userId: nextTarget.id, reason: 'SPAM' });
        expect(body.errors).toBeUndefined();
      }

      const overflowTarget = await seedUser('target-overflow');
      const overflow = await reportUser({ userId: overflowTarget.id, reason: 'SPAM' });
      expect(overflow.errors?.[0]?.extensions?.code).toBe('RATE_LIMITED');
      expect(await countAdmissions(reporter.id)).toBe(9);
    });
  });

  // ─── Safety and privacy ───────────────────────────────────────────────────

  describe('safety and privacy', () => {
    it('never automatically bans or suspends the reported account', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      expect((await reportUser({ userId: target.id, reason: 'SCAM_OR_FRAUD' })).data?.reportUser).toBe(true);

      const collaborators = await Promise.all([seedUser('r2'), seedUser('r3')]);
      for (const collaborator of collaborators) {
        authenticateAs(collaborator);
        expect((await reportUser({ userId: target.id, reason: 'SCAM_OR_FRAUD' })).data?.reportUser).toBe(true);
      }

      const [refreshed] = await dbHelper.db.select().from(users).where(eq(users.id, target.id));
      expect(refreshed.isBanned).toBe(false);
      expect(refreshed.bannedAt).toBeNull();
      expect(await dbHelper.db.select().from(moderationActions)).toHaveLength(0);
    });

    it('does not notify the reported account that a report was submitted', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      expect((await reportUser({ userId: target.id, reason: 'HARASSMENT' })).data?.reportUser).toBe(true);
      expect(await dbHelper.db.select().from(notifications)).toHaveLength(0);
    });

    it('reports normally despite an active Block in either direction', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      await dbHelper.db.insert(blocks).values({ blockerId: reporter.id, blockedId: target.id });

      authenticateAs(reporter);
      expect((await reportUser({ userId: target.id, reason: 'SAFETY_CONCERN' })).data?.reportUser).toBe(true);

      await dbHelper.db.insert(blocks).values({ blockerId: target.id, blockedId: reporter.id });
      await dbHelper.db
        .update(accountReports)
        .set({ reviewedAt: new Date() })
        .where(and(eq(accountReports.reporterId, reporter.id), eq(accountReports.reportedUserId, target.id)));

      expect((await reportUser({ userId: target.id, reason: 'HARASSMENT' })).data?.reportUser).toBe(true);
      expect(await findReports(reporter.id, target.id)).toHaveLength(2);
    });

    it('rejects unauthenticated submissions', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      authenticateAs(reporter);

      const body = await reportUser({ userId: target.id, reason: 'SPAM' }, '');
      expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
      expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
    });

    it('rejects banned reporters', async () => {
      const banned = await seedUser('banned', { isBanned: true });
      const target = await seedUser('target');
      authenticateAs(banned);

      const body = await reportUser({ userId: target.id, reason: 'SPAM' });
      expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await countAdmissions(banned.id)).toBe(0);
    });
  });

  // ─── Review metadata and durability ───────────────────────────────────────

  describe('review metadata and durability', () => {
    it('records administrator review metadata and clears the admin reference when the admin is deleted', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const [admin] = await dbHelper.db
        .insert(adminUsers)
        .values({
          email: 'admin@example.com',
          passwordHash: '$2a$12$placeholder',
          fullName: 'Moderation Admin',
          role: 'SUPER_ADMIN',
        })
        .returning();

      await dbHelper.db
        .insert(accountReports)
        .values({ reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM' });
      await dbHelper.db
        .update(accountReports)
        .set({ reviewedAt: new Date(), reviewedByAdminId: admin.id, reviewOutcome: 'NO_ACTION' })
        .where(eq(accountReports.reporterId, reporter.id));

      const [reviewed] = await findReports(reporter.id, target.id);
      expect(reviewed.reviewedAt).toBeInstanceOf(Date);
      expect(reviewed.reviewedByAdminId).toBe(admin.id);
      expect(reviewed.reviewOutcome).toBe('NO_ACTION');

      await dbHelper.db.delete(adminUsers).where(eq(adminUsers.id, admin.id));
      const [afterAdminDelete] = await findReports(reporter.id, target.id);
      expect(afterAdminDelete.reviewedByAdminId).toBeNull();
      expect(afterAdminDelete.reviewOutcome).toBe('NO_ACTION');
    });

    it('cascades every report involving a deleted account', async () => {
      const reporter = await seedUser('reporter');
      const target = await seedUser('target');
      const unrelated = await seedUser('unrelated');
      const [first, second] = await Promise.all([seedUser('first'), seedUser('second')]);

      await dbHelper.db.insert(accountReports).values([
        { reporterId: reporter.id, reportedUserId: target.id, reason: 'SPAM' },
        { reporterId: first.id, reportedUserId: target.id, reason: 'SPAM' },
        { reporterId: target.id, reportedUserId: second.id, reason: 'SPAM' },
        { reporterId: first.id, reportedUserId: unrelated.id, reason: 'SPAM' },
      ]);

      await dbHelper.db.delete(users).where(eq(users.id, target.id));

      const remaining = await dbHelper.db.select().from(accountReports);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].reporterId).toBe(first.id);
      expect(remaining[0].reportedUserId).toBe(unrelated.id);
    });

    it('exposes the indexes that back the open-pair, review queue, and quota lookups', async () => {
      const result = await dbHelper.pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'account_reports'`,
      );
      const names = result.rows.map((row) => row.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'account_reports_pkey',
          'unique_open_account_report_per_reporter_and_reported',
          'idx_account_reports_reported_created',
          'idx_account_reports_reporter_created',
        ]),
      );
    });
  });
});
