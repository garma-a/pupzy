import { sql } from 'drizzle-orm';
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
import { cities, users, type User } from '../database/schema';
import { TermsRepository } from './terms.repository';
import { TermsService } from './terms.service';
import { TermsResolver } from './terms.resolver';
import { TermsAcceptanceGuard } from './terms-acceptance.guard';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { UsersResolver } from '../users/users.resolver';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { AccountDeletionService } from '../users/account-deletion.service';
import { PostsService } from '../posts/posts.service';
import { PostsResolver } from '../posts/posts.resolver';
import { CommentsService } from '../comments/comments.service';
import { CommentsResolver } from '../comments/comments.resolver';
import { ContactsService } from '../contacts/contacts.service';
import { ContactsResolver } from '../contacts/contacts.resolver';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { AdoptionsResolver } from '../adoptions/adoptions.resolver';
import { MatingService } from '../mating/mating.service';
import { MatingResolver } from '../mating/mating.resolver';
import { CitiesService } from '../cities/cities.service';
import { GqlExceptionFilter } from '../common/filters/gql-exception.filter';
import { FirebaseAuthGuard } from '../auth/firebase.guard';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

const TERMS_QUERY = `
  query Terms {
    terms {
      currentVersion
      termsUrl
      acceptedVersion
      acceptedAt
      acceptanceRequired
    }
  }
`;

const ACCEPT_TERMS_MUTATION = `
  mutation AcceptTerms($input: AcceptTermsInput!) {
    acceptTerms(input: $input) {
      currentVersion
      termsUrl
      acceptedVersion
      acceptedAt
      acceptanceRequired
    }
  }
`;

interface GqlErrorBody {
  message: string;
  extensions?: { code?: string; currentVersion?: string; termsUrl?: string };
}

interface GqlResponseBody {
  data?: Record<string, unknown> | null;
  errors?: GqlErrorBody[];
}

describe('Terms Acceptance (integration)', () => {
  let dbHelper: TestDatabaseHelper;
  let app: INestApplication | undefined;
  let usersRepo: UsersRepository;
  let accountDeletionRepo: AccountDeletionRepository;
  let usersService: UsersService;
  let mockVerifyIdToken: jest.Mock;
  let mockCacheManager: jest.Mocked<Cache>;
  let cacheStore: Map<string, unknown>;
  let termsConfig: { version: string | null; url: string | null };
  let sequence = 0;

  let postsServiceMock: {
    createRescuePost: jest.Mock;
    createLostPost: jest.Mock;
    createAdoptionPost: jest.Mock;
    createProductPost: jest.Mock;
    getHelpFeed: jest.Mock;
    reportPost: jest.Mock;
  };
  let commentsServiceMock: { createComment: jest.Mock; createReply: jest.Mock };
  let contactsServiceMock: { requestContact: jest.Mock };
  let adoptionsServiceMock: { submitApplication: jest.Mock };
  let matingServiceMock: { createMatingPost: jest.Mock };
  let accountDeletionServiceMock: { initiateDeletion: jest.Mock };
  let citiesServiceMock: { findById: jest.Mock; findNearest: jest.Mock };

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
      app = undefined;
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    jest.clearAllMocks();

    sequence = 0;
    termsConfig = { version: '2026-09-01', url: 'https://pupzy.net/terms' };

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

    usersRepo = new UsersRepository(dbHelper.db);
    accountDeletionRepo = new AccountDeletionRepository(dbHelper.db);
    citiesServiceMock = {
      findById: jest.fn((id: string) => Promise.resolve({ id })),
      findNearest: jest.fn(() => Promise.resolve({ id: generateUuidV7() })),
    };
    const citiesService = citiesServiceMock as unknown as CitiesService;

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'PHONE_ENCRYPTION_KEY') return 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
        if (key === 'TERMS_VERSION') return termsConfig.version ?? undefined;
        if (key === 'TERMS_URL') return termsConfig.url ?? undefined;
        return undefined;
      }),
    } as unknown as ConfigService;

    usersService = new UsersService(usersRepo, citiesService, accountDeletionRepo, config, mockCacheManager);

    postsServiceMock = {
      createRescuePost: jest.fn().mockResolvedValue({ id: 'post-rescue-1' }),
      createLostPost: jest.fn().mockResolvedValue({ id: 'post-lost-1' }),
      createAdoptionPost: jest.fn().mockResolvedValue({ id: 'post-adoption-1' }),
      createProductPost: jest.fn().mockResolvedValue({ id: 'post-product-1' }),
      getHelpFeed: jest.fn().mockResolvedValue({ edges: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      reportPost: jest.fn().mockResolvedValue(true),
    };
    commentsServiceMock = {
      createComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
      createReply: jest.fn().mockResolvedValue({ id: 'reply-1' }),
    };
    contactsServiceMock = { requestContact: jest.fn().mockResolvedValue({ id: 'contact-1' }) };
    adoptionsServiceMock = { submitApplication: jest.fn().mockResolvedValue({ id: 'application-1' }) };
    matingServiceMock = { createMatingPost: jest.fn().mockResolvedValue({ id: 'post-mating-1' }) };
    accountDeletionServiceMock = {
      initiateDeletion: jest.fn().mockResolvedValue({
        status: 'PENDING',
        deletionId: 'deletion-1',
        progressToken: null,
        message: 'accepted',
        acceptedAt: new Date(),
        completedAt: null,
      }),
    };
  });

  async function initTestApp(): Promise<INestApplication> {
    const termsService = new TermsService(
      {
        get: jest.fn((key: string) => {
          if (key === 'TERMS_VERSION') return termsConfig.version ?? undefined;
          if (key === 'TERMS_URL') return termsConfig.url ?? undefined;
          return undefined;
        }),
      } as unknown as ConfigService,
      new TermsRepository(dbHelper.db),
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          typePaths: [join(process.cwd(), 'src/**/*.graphql')],
          context: ({ req }: { req: unknown }) => ({ req }),
        }),
      ],
      providers: [
        TermsResolver,
        { provide: TermsService, useValue: termsService },
        UsersResolver,
        { provide: UsersService, useValue: usersService },
        { provide: AccountDeletionService, useValue: accountDeletionServiceMock },
        PostsResolver,
        { provide: PostsService, useValue: postsServiceMock },
        CommentsResolver,
        { provide: CommentsService, useValue: commentsServiceMock },
        ContactsResolver,
        { provide: ContactsService, useValue: contactsServiceMock },
        AdoptionsResolver,
        { provide: AdoptionsService, useValue: adoptionsServiceMock },
        MatingResolver,
        { provide: MatingService, useValue: matingServiceMock },
        { provide: AccountDeletionRepository, useValue: accountDeletionRepo },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: FIREBASE_ADMIN_TOKEN, useValue: {} },
        { provide: APP_GUARD, useClass: FirebaseAuthGuard },
        { provide: APP_GUARD, useClass: TermsAcceptanceGuard },
        { provide: APP_FILTER, useClass: GqlExceptionFilter },
      ],
    }).compile();

    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  async function seedUser(options: { acceptedVersion?: string; acceptedAt?: Date } = {}): Promise<User> {
    sequence += 1;
    const uid = `fb-terms-${sequence}-${generateUuidV7()}`;
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: uid,
        email: `${uid}@example.com`,
        fullName: 'Terms User',
        termsAcceptedVersion: options.acceptedVersion ?? null,
        termsAcceptedAt: options.acceptedAt ?? null,
      })
      .returning();
    return user;
  }

  function authenticateAs(user: User): void {
    mockVerifyIdToken.mockResolvedValue({
      uid: user.firebaseUserId,
      auth_time: Math.floor(Date.now() / 1000) - 5,
      firebase: { sign_in_provider: 'google.com' },
    });
  }

  async function gql(query: string, variables?: Record<string, unknown>): Promise<GqlResponseBody> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const req = request(app!.getHttpServer()).post('/graphql');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    req.set('Authorization', 'Bearer valid-firebase-token');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const res = (await req.send({ query, variables })) as { body: GqlResponseBody };
    return res.body;
  }

  function errorCode(body: GqlResponseBody): string | undefined {
    return body.errors?.[0]?.extensions?.code;
  }

  const protectedOperations: Array<{ name: string; query: string; variables: Record<string, unknown> }> = [
    {
      name: 'createRescuePost',
      query: `mutation ($input: CreateRescuePostInput!) { createRescuePost(input: $input) { id } }`,
      variables: {
        input: {
          title: 'Injured cat',
          description: 'Needs help',
          coordinates: { latitude: 30.04, longitude: 31.23 },
          species: 'CAT',
          conditionSummary: 'Broken leg',
          reporterRole: 'ON_SITE',
          isLifeThreatening: true,
          hasVisibleSeriousInjury: true,
          isInDangerousLocation: false,
          canAnimalMoveOrEscape: true,
        },
      },
    },
    {
      name: 'createLostPost',
      query: `mutation ($input: CreateLostPostInput!) { createLostPost(input: $input) { id } }`,
      variables: {
        input: {
          title: 'Missing cat',
          description: 'Orange tabby',
          coordinates: { latitude: 30.04, longitude: 31.23 },
          reportType: 'LOST_PET',
          species: 'CAT',
        },
      },
    },
    {
      name: 'createAdoptionPost',
      query: `mutation ($input: CreateAdoptionPostInput!) { createAdoptionPost(input: $input) { id } }`,
      variables: {
        input: {
          title: 'Adopt me',
          description: 'Friendly cat',
          coordinates: { latitude: 30.04, longitude: 31.23 },
          petName: 'Luna',
          species: 'CAT',
          gender: 'FEMALE',
          vaccinated: true,
          neutered: false,
          priorPetExperienceRequired: false,
        },
      },
    },
    {
      name: 'createProductPost',
      query: `mutation ($input: CreateProductPostInput!) { createProductPost(input: $input) { id } }`,
      variables: {
        input: {
          title: 'Pet crate',
          description: 'Barely used',
          coordinates: { latitude: 30.04, longitude: 31.23 },
          category: 'ACCESSORIES',
          condition: 'LIKE_NEW',
          isFree: true,
        },
      },
    },
    {
      name: 'createMatingPost',
      query: `mutation ($input: CreateMatingPostInput!) { createMatingPost(input: $input) { id } }`,
      variables: {
        input: {
          petName: 'Rex',
          species: 'DOG',
          breed: 'Labrador',
          gender: 'MALE',
          ageValue: 3,
          ageUnit: 'YEARS',
          isPurebred: true,
          cityId: generateUuidV7(),
          mediaIds: [],
        },
      },
    },
    {
      name: 'createComment',
      query: `mutation ($input: CreateCommentInput!) { createComment(input: $input) { id } }`,
      variables: { input: { clientRequestId: 'req-comment-1', postId: generateUuidV7(), text: 'A comment' } },
    },
    {
      name: 'createReply',
      query: `mutation ($input: CreateReplyInput!) { createReply(input: $input) { id } }`,
      variables: { input: { clientRequestId: 'req-reply-1', commentId: generateUuidV7(), text: 'A reply' } },
    },
    {
      name: 'requestContact',
      query: `mutation ($postId: ID!, $message: String!) { requestContact(postId: $postId, message: $message) { id } }`,
      variables: { postId: generateUuidV7(), message: 'Please share your contact' },
    },
    {
      name: 'submitAdoptionApplication',
      query: `mutation ($input: SubmitAdoptionApplicationInput!) { submitAdoptionApplication(input: $input) { id } }`,
      variables: {
        input: {
          targetPostId: generateUuidV7(),
          livingSituation: 'APARTMENT',
          hasOutdoorAccess: false,
          hasOtherPetsAtHome: false,
          hasChildrenAtHome: false,
          whyAdopt: 'I can provide a loving home',
          consentHomeVisit: false,
          canProvideVetReference: false,
        },
      },
    },
  ];

  function protectedOperation(name: string): { name: string; query: string; variables: Record<string, unknown> } {
    const operation = protectedOperations.find((candidate) => candidate.name === name);
    if (!operation) throw new Error(`Missing protected operation fixture: ${name}`);
    return operation;
  }

  describe('terms state and acceptance', () => {
    it('reports the configured version/URL and requires acceptance for a new account', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const body = await gql(TERMS_QUERY);

      expect(body.errors).toBeUndefined();
      expect(body.data?.terms).toEqual({
        currentVersion: '2026-09-01',
        termsUrl: 'https://pupzy.net/terms',
        acceptedVersion: null,
        acceptedAt: null,
        acceptanceRequired: true,
      });
    });

    it('records acceptance once and preserves the original timestamp on repeat acceptance', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const first = await gql(ACCEPT_TERMS_MUTATION, { input: { version: '2026-09-01' } });
      expect(first.errors).toBeUndefined();
      const firstTerms = first.data?.acceptTerms as Record<string, unknown>;
      expect(firstTerms.acceptedVersion).toBe('2026-09-01');
      expect(firstTerms.acceptanceRequired).toBe(false);
      expect(firstTerms.acceptedAt).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 30));

      const second = await gql(ACCEPT_TERMS_MUTATION, { input: { version: '2026-09-01' } });
      expect(second.errors).toBeUndefined();
      const secondTerms = second.data?.acceptTerms as Record<string, unknown>;
      expect(secondTerms.acceptedAt).toBe(firstTerms.acceptedAt);

      const persisted = await usersRepo.findById(user.id);
      expect(persisted?.termsAcceptedVersion).toBe('2026-09-01');
      expect(persisted?.termsAcceptedAt?.toISOString()).toBe(new Date(firstTerms.acceptedAt as string).toISOString());

      const state = await gql(TERMS_QUERY);
      expect(state.data?.terms).toMatchObject({ acceptedVersion: '2026-09-01', acceptanceRequired: false });
    });

    it('rejects unknown/stale versions with a stable error and keeps the gate closed', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const rejected = await gql(ACCEPT_TERMS_MUTATION, { input: { version: '2025-01-01' } });
      expect(errorCode(rejected)).toBe('TERMS_VERSION_MISMATCH');
      expect(rejected.errors?.[0]?.extensions?.currentVersion).toBe('2026-09-01');

      const persisted = await usersRepo.findById(user.id);
      expect(persisted?.termsAcceptedVersion).toBeNull();

      const blocked = await gql(
        protectedOperation('createComment').query,
        protectedOperation('createComment').variables,
      );
      expect(errorCode(blocked)).toBe('TERMS_ACCEPTANCE_REQUIRED');
    });

    it('does not allow acceptance to be smuggled through a publication input', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const body = await gql(`mutation ($input: CreateCommentInput!) { createComment(input: $input) { id } }`, {
        input: {
          clientRequestId: 'req-smuggle-1',
          postId: generateUuidV7(),
          text: 'Trying to bypass',
          termsAcceptedVersion: '2026-09-01',
        },
      });

      expect(body.errors?.length).toBeGreaterThan(0);
      expect(body.data?.createComment).toBeFalsy();
      expect(commentsServiceMock.createComment).not.toHaveBeenCalled();
    });
  });

  describe('protected publication and submission operations', () => {
    it.each(protectedOperations.map((operation) => [operation.name, operation] as const))(
      'rejects %s without current acceptance',
      async (_name, operation) => {
        app = await initTestApp();
        const user = await seedUser();
        authenticateAs(user);

        const body = await gql(operation.query, operation.variables);

        expect(errorCode(body)).toBe('TERMS_ACCEPTANCE_REQUIRED');
        expect(body.errors?.[0]?.extensions?.currentVersion).toBe('2026-09-01');
        expect(body.errors?.[0]?.extensions?.termsUrl).toBe('https://pupzy.net/terms');
      },
    );

    it('allows post, comment and contact submissions once the current version is accepted', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const accepted = await gql(ACCEPT_TERMS_MUTATION, { input: { version: '2026-09-01' } });
      expect(accepted.errors).toBeUndefined();

      const rescue = await gql(
        protectedOperation('createRescuePost').query,
        protectedOperation('createRescuePost').variables,
      );
      expect(rescue.errors).toBeUndefined();
      expect(postsServiceMock.createRescuePost).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ title: 'Injured cat' }),
      );

      const comment = await gql(
        protectedOperation('createComment').query,
        protectedOperation('createComment').variables,
      );
      expect(comment.errors).toBeUndefined();
      expect(commentsServiceMock.createComment).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ clientRequestId: 'req-comment-1' }),
      );

      const contact = await gql(
        protectedOperation('requestContact').query,
        protectedOperation('requestContact').variables,
      );
      expect(contact.errors).toBeUndefined();
      expect(contactsServiceMock.requestContact).toHaveBeenCalledWith(
        user.id,
        expect.any(String),
        'Please share your contact',
      );

      const application = await gql(
        protectedOperation('submitAdoptionApplication').query,
        protectedOperation('submitAdoptionApplication').variables,
      );
      expect(application.errors).toBeUndefined();
      expect(adoptionsServiceMock.submitApplication).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ whyAdopt: 'I can provide a loving home' }),
      );
    });

    it('makes every earlier acceptance insufficient after the published version changes', async () => {
      const user = await seedUser({ acceptedVersion: '2026-09-01', acceptedAt: new Date() });
      authenticateAs(user);

      app = await initTestApp();
      const before = await gql(
        protectedOperation('createComment').query,
        protectedOperation('createComment').variables,
      );
      expect(before.errors).toBeUndefined();

      await app.close();
      termsConfig = { version: '2026-10-01', url: 'https://pupzy.net/terms' };
      app = await initTestApp();

      const state = await gql(TERMS_QUERY);
      expect(state.data?.terms).toMatchObject({
        currentVersion: '2026-10-01',
        acceptedVersion: '2026-09-01',
        acceptanceRequired: true,
      });

      const blocked = await gql(
        protectedOperation('createComment').query,
        protectedOperation('createComment').variables,
      );
      expect(errorCode(blocked)).toBe('TERMS_ACCEPTANCE_REQUIRED');

      const reaccepted = await gql(ACCEPT_TERMS_MUTATION, { input: { version: '2026-10-01' } });
      expect(reaccepted.errors).toBeUndefined();
      expect(reaccepted.data?.acceptTerms).toMatchObject({ acceptedVersion: '2026-10-01', acceptanceRequired: false });

      const allowed = await gql(
        protectedOperation('createComment').query,
        protectedOperation('createComment').variables,
      );
      expect(allowed.errors).toBeUndefined();
      expect(commentsServiceMock.createComment).toHaveBeenCalled();
    });
  });

  describe('operations that must remain available without acceptance', () => {
    it('keeps browsing, onboarding, reporting and account deletion usable', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const me = await gql(`query { me { id email } }`);
      expect(me.errors).toBeUndefined();
      expect((me.data?.me as Record<string, unknown>).id).toBe(user.id);

      const feed = await gql(
        `query { helpFeed(viewerLocation: { latitude: 30.04, longitude: 31.23 }) { edges { node { id } } pageInfo { hasNextPage } } }`,
      );
      expect(feed.errors).toBeUndefined();
      expect(postsServiceMock.getHelpFeed).toHaveBeenCalled();

      const report = await gql(`mutation ($postId: ID!) { reportPost(input: { postId: $postId, reason: SPAM }) }`, {
        postId: generateUuidV7(),
      });
      expect(report.errors).toBeUndefined();
      expect(report.data?.reportPost).toBe(true);

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
      citiesServiceMock.findNearest.mockResolvedValue({ id: city.id });

      const onboarding = await gql(
        `mutation ($input: CompleteProfileInput!) { completeProfile(input: $input) { id } }`,
        {
          input: {
            fullName: 'Onboarded User',
            phoneNumber: '+201012345678',
            location: { latitude: 30.04, longitude: 31.23 },
          },
        },
      );
      expect(onboarding.errors).toBeUndefined();
      expect((onboarding.data?.completeProfile as Record<string, unknown>).id).toBe(user.id);

      const deletion = await gql(
        `mutation ($input: DeleteMyAccountInput!) { deleteMyAccount(input: $input) { status deletionId } }`,
        { input: { confirm: true } },
      );
      expect(deletion.errors).toBeUndefined();
      expect(deletion.data?.deleteMyAccount).toMatchObject({ status: 'PENDING', deletionId: 'deletion-1' });
      expect(accountDeletionServiceMock.initiateDeletion).toHaveBeenCalled();
    });

    it('stays schema-compatible: onboarding input has no terms field and acceptance requires a version', async () => {
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const onboardingFields = await gql(`query { __type(name: "CompleteProfileInput") { inputFields { name } } }`);
      expect(onboardingFields.errors).toBeUndefined();
      const fieldNames = (
        (onboardingFields.data?.__type as { inputFields: Array<{ name: string }> }).inputFields ?? []
      ).map((field) => field.name);
      expect(fieldNames).toEqual(['fullName', 'phoneNumber', 'cityId', 'location', 'languagePreference']);
      expect(fieldNames).not.toContain('termsAcceptedVersion');
      expect(fieldNames).not.toContain('acceptedTerms');

      const acceptFields = await gql(
        `query { __type(name: "AcceptTermsInput") { inputFields { name type { kind } } } }`,
      );
      expect(acceptFields.errors).toBeUndefined();
      expect(acceptFields.data?.__type).toEqual({
        inputFields: [{ name: 'version', type: { kind: 'NON_NULL' } }],
      });
    });

    it('leaves the gate inactive while no terms are configured and allows publication', async () => {
      termsConfig = { version: null, url: null };
      app = await initTestApp();
      const user = await seedUser();
      authenticateAs(user);

      const state = await gql(TERMS_QUERY);
      expect(state.errors).toBeUndefined();
      expect(state.data?.terms).toEqual({
        currentVersion: null,
        termsUrl: null,
        acceptedVersion: null,
        acceptedAt: null,
        acceptanceRequired: false,
      });

      const comment = await gql(
        protectedOperation('createComment').query,
        protectedOperation('createComment').variables,
      );
      expect(comment.errors).toBeUndefined();
      expect(commentsServiceMock.createComment).toHaveBeenCalled();
    });
  });

  describe('account isolation', () => {
    it('keeps acceptance per account: another account still needs to accept', async () => {
      app = await initTestApp();
      const accepted = await seedUser({ acceptedVersion: '2026-09-01', acceptedAt: new Date() });
      const fresh = await seedUser();
      authenticateAs(accepted);

      const acceptedState = await gql(TERMS_QUERY);
      expect(acceptedState.data?.terms).toMatchObject({ acceptanceRequired: false });

      authenticateAs(fresh);
      const freshState = await gql(TERMS_QUERY);
      expect(freshState.data?.terms).toMatchObject({ acceptedVersion: null, acceptanceRequired: true });
    });
  });
});
