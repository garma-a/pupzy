import * as fs from 'fs';
import * as path from 'path';
import { parse, Kind, ObjectTypeDefinitionNode, ObjectTypeExtensionNode } from 'graphql';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Cache } from 'cache-manager';
import { ForbiddenError, ValidationError } from '../common/errors/app.errors';
import type { Post } from '../database/schema';

describe('Rescue Discussion & Creator Closure Authority (Ticket 01)', () => {
  const POSTS_GRAPHQL_FILE = path.join(__dirname, 'posts.graphql');
  const COMMENTS_GRAPHQL_FILE = path.join(__dirname, '../comments/comments.graphql');

  describe('GraphQL Schema Verification', () => {
    it('verifies that no rescue-proof types or unsupported proof mutations exist in the schema', () => {
      const postsGql = fs.readFileSync(POSTS_GRAPHQL_FILE, 'utf8');
      const commentsGql = fs.readFileSync(COMMENTS_GRAPHQL_FILE, 'utf8');
      const fullSchemaText = `${postsGql}\n${commentsGql}`;
      const doc = parse(fullSchemaText);

      const typeNames = doc.definitions
        .filter((d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION)
        .map((d) => d.name.value);

      expect(typeNames).not.toContain('RescueProof');
      expect(typeNames).not.toContain('RescueProofMedia');
      expect(typeNames).not.toContain('RescueProofSubmitter');

      const mutationTypes = doc.definitions.filter(
        (d): d is ObjectTypeDefinitionNode | ObjectTypeExtensionNode =>
          (d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.OBJECT_TYPE_EXTENSION) &&
          d.name.value === 'Mutation',
      );
      expect(mutationTypes.length).toBeGreaterThan(0);

      const mutationFieldNames = mutationTypes.flatMap((t) => t.fields?.map((f) => f.name.value) ?? []);
      expect(mutationFieldNames).not.toContain('submitRescueProof');
      expect(mutationFieldNames).not.toContain('confirmRescueProof');
      expect(mutationFieldNames).not.toContain('rejectRescueProof');
      expect(mutationFieldNames).not.toContain('voteRescueResolution');
    });

    it('verifies that updatePostStatus mutation is exposed and takes PostStatus', () => {
      const postsGql = fs.readFileSync(POSTS_GRAPHQL_FILE, 'utf8');
      const doc = parse(postsGql);

      const mutationTypes = doc.definitions.filter(
        (d): d is ObjectTypeDefinitionNode | ObjectTypeExtensionNode =>
          (d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.OBJECT_TYPE_EXTENSION) &&
          d.name.value === 'Mutation',
      );
      const updateField = mutationTypes
        .flatMap((t) => t.fields ?? [])
        .find((f) => f.name.value === 'updatePostStatus');
      expect(updateField).toBeDefined();
    });
  });

  describe('Service Authority & Evidence Gate Invariants', () => {
    let service: PostsService;
    let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
    let mockCitiesService: jest.Mocked<Partial<CitiesService>>;
    let mockUploadService: jest.Mocked<Partial<UploadService>>;
    let mockViewFlushCron: jest.Mocked<Partial<ViewFlushCron>>;
    let mockUsersService: jest.Mocked<Partial<UsersService>>;
    let mockNotificationsService: jest.Mocked<Partial<NotificationsService>>;
    let mockCacheManager: jest.Mocked<Partial<Cache>>;

    const creatorId = '01920000-0000-7000-8000-000000000001';
    const nonOwnerId = '01920000-0000-7000-8000-000000000002';
    const rescuePostId = '01920000-0000-7000-8000-000000000010';

    const baseRescuePost: Post = {
      id: rescuePostId,
      creatorId,
      postType: 'RESCUE',
      status: 'ACTIVE',
      title: 'Injured stray dog near central park',
      description: 'Needs medical attention and transport',
      cityId: '01920000-0000-7000-8000-000000000099',
      address: 'Central Park Gate 3',
      latitude: 30.0444,
      longitude: 31.2357,
      species: 'DOG',
      gender: 'MALE',
      urgencyTier: 'CRITICAL',
      isUrgent: true,
      boostCount: 0,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
      moderationStatus: 'CLEAN',
      contactPhone: null,
      customDeclineReason: null,
      declineReason: null,
      expiresAt: null,
      lastInactivityNudgeAt: null,
      moderatedAt: null,
      moderationReason: null,
      moderatorId: null,
      reopenedAt: null,
      reopenedByAdminId: null,
      reopenReason: null,
      resolvedAt: null,
    };

    beforeEach(() => {
      mockPostsRepo = {
        findById: jest.fn(),
        updateStatus: jest.fn(),
        findLostReportType: jest.fn().mockResolvedValue(null),
      };
      mockCitiesService = {};
      mockUploadService = {};
      mockViewFlushCron = {};
      mockUsersService = { invalidateUserCacheById: jest.fn().mockResolvedValue(undefined) };
      mockNotificationsService = {};
      mockCacheManager = {};

      service = new PostsService(
        mockPostsRepo as PostsRepository,
        mockCitiesService as CitiesService,
        mockUploadService as UploadService,
        mockViewFlushCron as ViewFlushCron,
        mockUsersService as UsersService,
        mockNotificationsService as NotificationsService,
        mockCacheManager as Cache,
      );
    });

    it('allows creator to close rescue as RESOLVED without any comment, image, pin, or boost minimum', async () => {
      (mockPostsRepo.findById as jest.Mock).mockResolvedValue(baseRescuePost);
      (mockPostsRepo.updateStatus as jest.Mock).mockResolvedValue({
        ...baseRescuePost,
        status: 'RESOLVED',
        resolvedAt: new Date('2026-09-23T12:00:00Z'),
      });

      const result = await service.updatePostStatus(rescuePostId, creatorId, 'RESOLVED');

      expect(result.status).toBe('RESOLVED');
      expect(mockPostsRepo.findById).toHaveBeenCalledWith(rescuePostId);
      expect(mockPostsRepo.updateStatus).toHaveBeenCalledWith(rescuePostId, creatorId, 'RESOLVED');
    });

    it('strictly forbids non-owners from closing a rescue post', async () => {
      (mockPostsRepo.findById as jest.Mock).mockResolvedValue(baseRescuePost);

      await expect(service.updatePostStatus(rescuePostId, nonOwnerId, 'RESOLVED')).rejects.toThrow(ForbiddenError);
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects unsupported target statuses for rescue posts', async () => {
      (mockPostsRepo.findById as jest.Mock).mockResolvedValue(baseRescuePost);

      for (const invalidStatus of ['ADOPTED', 'SOLD', 'REUNITED']) {
        await expect(service.updatePostStatus(rescuePostId, creatorId, invalidStatus as 'ADOPTED')).rejects.toThrow(
          ValidationError,
        );
      }
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects repeated closure of an already resolved rescue post', async () => {
      (mockPostsRepo.findById as jest.Mock).mockResolvedValue({
        ...baseRescuePost,
        status: 'RESOLVED',
      });

      await expect(service.updatePostStatus(rescuePostId, creatorId, 'RESOLVED')).rejects.toThrow(ValidationError);
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('ensures supported non-rescue post types retain their distinct lifecycle behavior', async () => {
      const lostPetPost: Post = {
        ...baseRescuePost,
        id: '01920000-0000-7000-8000-000000000020',
        postType: 'LOST',
      };
      (mockPostsRepo.findById as jest.Mock).mockResolvedValue(lostPetPost);
      (mockPostsRepo.findLostReportType as jest.Mock).mockResolvedValue('LOST_PET');

      await expect(service.updatePostStatus(lostPetPost.id, creatorId, 'RESOLVED')).rejects.toThrow(ValidationError);

      (mockPostsRepo.updateStatus as jest.Mock).mockResolvedValue({
        ...lostPetPost,
        status: 'REUNITED',
      });
      const reunitedResult = await service.updatePostStatus(lostPetPost.id, creatorId, 'REUNITED');
      expect(reunitedResult.status).toBe('REUNITED');
    });
  });
});
