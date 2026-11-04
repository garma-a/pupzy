import { join } from 'node:path';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import request from 'supertest';
import { CitiesService } from '../cities/cities.service';
import { GqlExceptionFilter } from '../common/filters/gql-exception.filter';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import { MatingRepository } from '../mating/mating.repository';
import { MatingResolver } from '../mating/mating.resolver';
import { MatingService } from '../mating/mating.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadService } from '../upload/upload.service';
import { UsersService } from '../users/users.service';
import { PostsRepository } from './posts.repository';
import { PostsResolver } from './posts.resolver';
import { PostsService } from './posts.service';
import { ViewFlushCron } from './view-flush.cron';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

const USER_ID = '01916327-0000-7000-8000-000000000001';
const CITY_ID = '01916327-0000-7000-8000-000000000002';
const MEDIA_ID = '01916327-0000-7000-8000-000000000003';
const POST_ID = '01916327-0000-7000-8000-000000000004';
interface MutationReply {
  errors?: Array<{ message: string; extensions: { code: string } }>;
  data?: Record<string, { id: string }>;
}
const common = {
  title: 'Post photo requirement regression',
  description: 'A valid description for the photo publication checks.',
  coordinates: { latitude: 30.0444, longitude: 31.2357 },
};
const cases = [
  {
    mutation: 'createRescuePost',
    inputType: 'CreateRescuePostInput',
    input: {
      ...common,
      species: 'DOG',
      conditionSummary: 'Animal needs help nearby',
      reporterRole: 'ON_SITE',
      isLifeThreatening: false,
      hasVisibleSeriousInjury: false,
      isInDangerousLocation: false,
      canAnimalMoveOrEscape: true,
    },
  },
  {
    mutation: 'createLostPost',
    inputType: 'CreateLostPostInput',
    input: {
      ...common,
      reportType: 'LOST_PET',
      species: 'DOG',
      dateLastSeen: '2026-11-01',
      hasMedicalNeeds: false,
      isElderlyOrVeryYoung: false,
      lastSeenNearHazard: false,
    },
  },
  {
    mutation: 'createLostPost',
    inputType: 'CreateLostPostInput',
    input: {
      ...common,
      reportType: 'FOUND_STRAY',
      species: 'DOG',
      dateFound: '2026-11-01',
      currentCondition: 'HEALTHY',
      isCurrentlySafeWithReporter: true,
    },
  },
  {
    mutation: 'createAdoptionPost',
    inputType: 'CreateAdoptionPostInput',
    input: {
      ...common,
      petName: 'Max',
      species: 'DOG',
      gender: 'MALE',
      vaccinated: true,
      neutered: false,
      priorPetExperienceRequired: false,
    },
  },
  {
    mutation: 'createProductPost',
    inputType: 'CreateProductPostInput',
    input: { ...common, category: 'CARE', condition: 'NEW', isFree: true },
  },
  {
    mutation: 'createMatingPost',
    inputType: 'CreateMatingPostInput',
    input: {
      cityId: CITY_ID,
      petName: 'Max',
      species: 'DOG',
      breed: 'Retriever',
      gender: 'MALE',
      ageValue: 2,
      ageUnit: 'YEARS',
      isPurebred: false,
    },
  },
];

describe('Post publication photo requirement over GraphQL HTTP', () => {
  let app: INestApplication<Server>;
  const writePost = jest.fn<Promise<{ id: string }>, [unknown, unknown, unknown[]]>();
  const upload = { getExpectedMediaUrls: jest.fn(), finalizeMedia: jest.fn(), markMediaFailed: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          typePaths: [join(process.cwd(), 'src/**/*.graphql')],
          context: () => ({ user: { id: USER_ID } }),
        }),
      ],
      providers: [
        PostsResolver,
        PostsService,
        MatingResolver,
        MatingService,
        {
          provide: PostsRepository,
          useValue: {
            createRescuePost: writePost,
            createLostPost: writePost,
            createAdoptionPost: writePost,
            createProductPost: writePost,
          },
        },
        { provide: MatingRepository, useValue: { createMatingPost: writePost } },
        {
          provide: CitiesService,
          useValue: {
            findById: () => Promise.resolve({ id: CITY_ID, governorate: 'Cairo', centerPoint: [31.2357, 30.0444] }),
            findNearest: () => Promise.resolve({ id: CITY_ID, governorate: 'Cairo', centerPoint: [31.2357, 30.0444] }),
          },
        },
        { provide: UploadService, useValue: upload },
        { provide: UsersService, useValue: { invalidateUserCacheById: () => Promise.resolve(undefined) } },
        { provide: ViewFlushCron, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: {} },
        { provide: APP_FILTER, useClass: GqlExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(false);
    await app.init();
  });

  afterAll(async () => app?.close());

  beforeEach(() => {
    jest.resetAllMocks();
    writePost.mockResolvedValue({ id: POST_ID });
    upload.getExpectedMediaUrls.mockResolvedValue({
      publicUrl: 'https://cdn.example.com/photo.jpg',
      cloudflareStorageKey: 'posts/photo.jpg',
      fileContentType: 'image/jpeg',
    });
    upload.finalizeMedia.mockResolvedValue(undefined);
  });

  describe.each(cases)('$mutation', ({ mutation, inputType, input }) => {
    const publish = (media: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `mutation Publish($input: ${inputType}!) { ${mutation}(input: $input) { id } }`,
          variables: { input: { ...input, ...media } },
        });

    it.each([{}, { mediaIds: [] }])(
      'rejects missing photos without claiming uploads or writing a Post: %j',
      async (media) => {
        // MATING already has a non-null GraphQL field: preserve its existing
        // schema-level rejection when the field is omitted altogether.
        if (mutation === 'createMatingPost' && !('mediaIds' in media)) {
          const response = await publish(media).expect(400);
          const reply = response.body as MutationReply;
          expect(reply.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
          expect(writePost).not.toHaveBeenCalled();
          return;
        }
        const response = await publish(media).expect(200);
        const reply = response.body as MutationReply;
        expect(reply.errors).toHaveLength(1);
        expect(reply.errors?.[0]?.message).toMatch(/at least one photo/i);
        expect(reply.errors?.[0]?.extensions.code).toBe('VALIDATION_ERROR');
        expect(writePost).not.toHaveBeenCalled();
        expect(upload.getExpectedMediaUrls).not.toHaveBeenCalled();
        expect(upload.finalizeMedia).not.toHaveBeenCalled();
      },
    );

    it('does not persist a Post when the selected photo never reached storage', async () => {
      upload.getExpectedMediaUrls.mockRejectedValue(new NotFoundError('Staged media', MEDIA_ID));
      const response = await publish({ mediaIds: [MEDIA_ID] }).expect(200);
      const reply = response.body as MutationReply;
      expect(reply.errors?.[0]?.extensions.code).toBe('NOT_FOUND');
      expect(writePost).not.toHaveBeenCalled();
      expect(upload.finalizeMedia).not.toHaveBeenCalled();
    });

    it('does not persist a Post when photo finalization fails', async () => {
      upload.finalizeMedia.mockRejectedValue(new ValidationError('Image upload failed. Please try again.'));
      const response = await publish({ mediaIds: [MEDIA_ID] }).expect(200);
      const reply = response.body as MutationReply;
      expect(reply.errors?.[0]?.extensions.code).toBe('VALIDATION_ERROR');
      expect(writePost).not.toHaveBeenCalled();
    });

    it('still accepts the installed app payload after a photo is verified and finalized', async () => {
      const response = await publish({ mediaIds: [MEDIA_ID] }).expect(200);
      const reply = response.body as MutationReply;
      expect(reply.errors).toBeUndefined();
      expect(reply.data?.[mutation]?.id).toBe(POST_ID);
      expect(upload.finalizeMedia).toHaveBeenCalledWith(MEDIA_ID, USER_ID, expect.any(String));
      expect(writePost).toHaveBeenCalledTimes(1);
      expect(writePost.mock.calls[0][2]).toMatchObject([{ publicUrl: 'https://cdn.example.com/photo.jpg' }]);
      expect(upload.finalizeMedia.mock.invocationCallOrder[0]).toBeLessThan(writePost.mock.invocationCallOrder[0]);
    });
  });
});
