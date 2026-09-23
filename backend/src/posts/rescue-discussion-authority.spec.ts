import * as fs from 'fs';
import * as path from 'path';
import { parse, Kind, ObjectTypeDefinitionNode, ObjectTypeExtensionNode, DocumentNode } from 'graphql';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors/app.errors';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { Cache } from 'cache-manager';
import type { Post } from '../database/schema';
import {
  canOwnerClose,
  canAdminResolve,
  ownerClosureTargets,
  POST_LIFECYCLE_SIDE_EFFECTS,
} from '../common/contracts/post-lifecycle.contract';
import {
  canPublishImageComment,
  assertImageCommentAllowed,
  IMAGE_COMMENT_ALLOWED_POST_TYPES,
} from '../comments/comment-image-eligibility';

/**
 * Ticket 01 Authority & Regression Contract:
 * - Rescue participants share updates through existing Comments, images, one creator-selected pin, and Boosts.
 * - Rescue screens/APIs do NOT expose unsupported proof submission/approval workflows.
 * - Creators retain the existing Rescued closure (ACTIVE -> RESOLVED) with NO evidence gate.
 * - Non-owners cannot close rescue posts.
 * - Supported non-rescue callers (e.g. FOUND_STRAY, LOST_PET, ADOPTION, PRODUCT, MATING) retain their behaviors.
 * - Administrative closure authority remains intact without evidence gate.
 */
describe('Ticket 01: Rescue Discussion Authority & Post Closure Contract', () => {
  const postsGraphqlPath = path.join(__dirname, 'posts.graphql');
  const commentsGraphqlPath = path.join(__dirname, '../comments/comments.graphql');

  let postsDoc: DocumentNode;
  let commentsDoc: DocumentNode;

  beforeAll(() => {
    postsDoc = parse(fs.readFileSync(postsGraphqlPath, 'utf8'));
    commentsDoc = parse(fs.readFileSync(commentsGraphqlPath, 'utf8'));
  });

  // ─── 1. GraphQL Schema & API Surface Contract ──────────────────────────

  describe('1. GraphQL Schema & API Surface Contract: Ordinary Discussion Preserved, Proof APIs Strictly Omitted', () => {
    it('verifies no rescue proof mutations or queries exist in the GraphQL API', () => {
      const allDocs = [postsDoc, commentsDoc];
      const allMutationFields: string[] = [];
      const allQueryFields: string[] = [];

      for (const doc of allDocs) {
        for (const def of doc.definitions) {
          if (def.kind === Kind.OBJECT_TYPE_EXTENSION || def.kind === Kind.OBJECT_TYPE_DEFINITION) {
            if (def.name.value === 'Mutation' && def.fields) {
              allMutationFields.push(...def.fields.map((f) => f.name.value));
            }
            if (def.name.value === 'Query' && def.fields) {
              allQueryFields.push(...def.fields.map((f) => f.name.value));
            }
          }
        }
      }

      const unsupportedProofOperations = [
        'submitRescueProof',
        'approveRescueProof',
        'rejectRescueProof',
        'requestRescueProof',
        'submitProof',
        'reviewProof',
        'voteResolution',
        'requestProof',
        'createProof',
        'updateProof',
        'rescueProof',
        'rescueProofs',
        'proofDetail',
        'proofs',
        'proofSubmissions',
      ];

      for (const forbidden of unsupportedProofOperations) {
        expect(allMutationFields).not.toContain(forbidden);
        expect(allQueryFields).not.toContain(forbidden);
      }
    });

    it('verifies Post and RescuePost types expose no proof workflow or evidence gate fields', () => {
      const postType = postsDoc.definitions.find(
        (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Post',
      );
      expect(postType).toBeDefined();

      const rescuePostType = postsDoc.definitions.find(
        (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'RescuePost',
      );
      expect(rescuePostType).toBeDefined();

      const postFieldNames = postType!.fields?.map((f) => f.name.value) ?? [];
      const rescueFieldNames = rescuePostType!.fields?.map((f) => f.name.value) ?? [];

      const forbiddenProofFields = [
        'proof',
        'proofs',
        'rescueProof',
        'evidenceProof',
        'proofStatus',
        'resolutionVotes',
        'isProofApproved',
        'proofApprovedAt',
        'proofSubmissionCount',
      ];

      for (const forbidden of forbiddenProofFields) {
        expect(postFieldNames).not.toContain(forbidden);
        expect(rescueFieldNames).not.toContain(forbidden);
      }
    });

    it('verifies Comment type retains ordinary discussion fields and omits proof/voting fields', () => {
      const commentType = commentsDoc.definitions.find(
        (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Comment',
      );
      expect(commentType).toBeDefined();

      const fieldNames = commentType!.fields?.map((f) => f.name.value) ?? [];

      // Required ordinary discussion fields
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('postId');
      expect(fieldNames).toContain('parentId');
      expect(fieldNames).toContain('author');
      expect(fieldNames).toContain('text');
      expect(fieldNames).toContain('status');
      expect(fieldNames).toContain('replyCount');
      expect(fieldNames).toContain('boostCount');
      expect(fieldNames).toContain('isBoostedByMe');
      expect(fieldNames).toContain('isPinned');
      expect(fieldNames).toContain('media');
      expect(fieldNames).toContain('createdAt');
      expect(fieldNames).toContain('updatedAt');

      // Strictly omitted proof workflow fields
      const forbiddenFields = [
        'proof',
        'resolutionVote',
        'evidenceProof',
        'unlockPhone',
        'phoneNumber',
        'phone',
        'proofStatus',
      ];
      for (const forbidden of forbiddenFields) {
        expect(fieldNames).not.toContain(forbidden);
      }
    });

    it('verifies ordinary discussion mutations and queries are intact', () => {
      const mutationExt = commentsDoc.definitions.find(
        (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Mutation',
      );
      expect(mutationExt).toBeDefined();
      const mutationFields = mutationExt!.fields?.map((f) => f.name.value) ?? [];

      expect(mutationFields).toContain('createComment');
      expect(mutationFields).toContain('createReply');
      expect(mutationFields).toContain('deleteComment');
      expect(mutationFields).toContain('toggleCommentBoost');
      expect(mutationFields).toContain('pinComment');
      expect(mutationFields).toContain('unpinComment');
      expect(mutationFields).toContain('requestCommentImageUploadUrl');

      const queryExt = commentsDoc.definitions.find(
        (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Query',
      );
      expect(queryExt).toBeDefined();
      const queryFields = queryExt!.fields?.map((f) => f.name.value) ?? [];

      expect(queryFields).toContain('comments');
      expect(queryFields).toContain('replies');
    });

    it('verifies post status update mutation updatePostStatus exists and has valid signature', () => {
      const mutationExt = postsDoc.definitions.find(
        (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Mutation',
      );
      expect(mutationExt).toBeDefined();

      const updatePostStatus = mutationExt!.fields?.find((f) => f.name.value === 'updatePostStatus');
      expect(updatePostStatus).toBeDefined();
      expect(updatePostStatus!.arguments?.map((a) => a.name.value)).toEqual(['postId', 'status']);
    });
  });

  // ─── 2. Rescue Closure Authority & Evidence Gate Independence ───────────

  describe('2. Rescue Closure Authority & Evidence Gate Independence (PostsService)', () => {
    let service: PostsService;
    let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
    let mockUsersService: jest.Mocked<Partial<UsersService>>;

    const validRescuePostId = '01916327-0000-7000-8000-000000000010';
    const creatorId = '01916327-0000-7000-8000-000000000011';
    const nonOwnerId = '01916327-0000-7000-8000-000000000012';

    beforeEach(() => {
      mockPostsRepo = {
        findById: jest.fn(),
        updateStatus: jest.fn(),
        findLostReportType: jest.fn().mockResolvedValue(null),
      };

      mockUsersService = {
        invalidateUserCacheById: jest.fn().mockResolvedValue(undefined),
      };

      service = new PostsService(
        mockPostsRepo as PostsRepository,
        {} as CitiesService,
        {} as UploadService,
        {} as ViewFlushCron,
        mockUsersService as UsersService,
        {} as NotificationsService,
        {} as Cache,
      );
    });

    it('allows creator to close an ACTIVE RESCUE post to RESOLVED with zero engagement (no evidence gate)', async () => {
      const zeroEngagementRescuePost = {
        id: validRescuePostId,
        creatorId,
        postType: 'RESCUE',
        status: 'ACTIVE',
        commentCount: 0,
        upvoteCount: 0,
        viewCount: 0,
        saveCount: 0,
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(zeroEngagementRescuePost);
      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({
        ...zeroEngagementRescuePost,
        status: 'RESOLVED',
      });

      const result = await service.updatePostStatus(validRescuePostId, creatorId, 'RESOLVED');

      expect(result.status).toBe('RESOLVED');
      expect(mockPostsRepo.updateStatus).toHaveBeenCalledWith(validRescuePostId, creatorId, 'RESOLVED');
      expect(mockUsersService.invalidateUserCacheById).toHaveBeenCalledWith(creatorId);
    });

    it('strictly rejects non-owner closure with ForbiddenError', async () => {
      const rescuePost = {
        id: validRescuePostId,
        creatorId,
        postType: 'RESCUE',
        status: 'ACTIVE',
        commentCount: 5,
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(rescuePost);

      await expect(service.updatePostStatus(validRescuePostId, nonOwnerId, 'RESOLVED')).rejects.toThrow(
        new ForbiddenError('You can only update the status of your own posts'),
      );
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects invalid closure status transitions for RESCUE with ValidationError', async () => {
      const rescuePost = {
        id: validRescuePostId,
        creatorId,
        postType: 'RESCUE',
        status: 'ACTIVE',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(rescuePost);

      const invalidTargets = ['REUNITED', 'ADOPTED', 'SOLD', 'EXPIRED', 'REMOVED'];
      for (const target of invalidTargets) {
        await expect(service.updatePostStatus(validRescuePostId, creatorId, target)).rejects.toThrow(ValidationError);
        expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
      }
    });

    it('rejects repeat closure on already RESOLVED rescue post with ValidationError', async () => {
      const alreadyResolvedPost = {
        id: validRescuePostId,
        creatorId,
        postType: 'RESCUE',
        status: 'RESOLVED',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(alreadyResolvedPost);

      await expect(service.updatePostStatus(validRescuePostId, creatorId, 'RESOLVED')).rejects.toThrow(
        new ValidationError('Post is already in "RESOLVED" status and cannot be changed'),
      );
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects closure on REMOVED rescue post with NotFoundError', async () => {
      const removedPost = {
        id: validRescuePostId,
        creatorId,
        postType: 'RESCUE',
        status: 'REMOVED',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(removedPost);

      await expect(service.updatePostStatus(validRescuePostId, creatorId, 'RESOLVED')).rejects.toThrow(
        new NotFoundError('Post', validRescuePostId),
      );
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('does not inspect comments, pins, images, or engagement counts when closing rescue post', async () => {
      const rescuePost = {
        id: validRescuePostId,
        creatorId,
        postType: 'RESCUE',
        status: 'ACTIVE',
        commentCount: 0,
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(rescuePost);
      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({
        ...rescuePost,
        status: 'RESOLVED',
      });

      await service.updatePostStatus(validRescuePostId, creatorId, 'RESOLVED');

      // Verifies findById and updateStatus are the only repo operations invoked
      expect(mockPostsRepo.findById).toHaveBeenCalledWith(validRescuePostId);
      expect(mockPostsRepo.updateStatus).toHaveBeenCalledWith(validRescuePostId, creatorId, 'RESOLVED');
      expect(mockPostsRepo.findLostReportType).not.toHaveBeenCalled();
    });
  });

  // ─── 3. Supported Non-Rescue Callers Retain Their Exact Behavior ─────────

  describe('3. Supported Non-Rescue Callers Retain Their Exact Closure Behavior', () => {
    let service: PostsService;
    let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
    let mockUsersService: jest.Mocked<Partial<UsersService>>;

    const postId = '01916327-0000-7000-8000-000000000020';
    const creatorId = '01916327-0000-7000-8000-000000000021';

    beforeEach(() => {
      mockPostsRepo = {
        findById: jest.fn(),
        updateStatus: jest.fn(),
        findLostReportType: jest.fn(),
      };

      mockUsersService = {
        invalidateUserCacheById: jest.fn().mockResolvedValue(undefined),
      };

      service = new PostsService(
        mockPostsRepo as PostsRepository,
        {} as CitiesService,
        {} as UploadService,
        {} as ViewFlushCron,
        mockUsersService as UsersService,
        {} as NotificationsService,
        {} as Cache,
      );
    });

    it('allows FOUND_STRAY to close as RESOLVED and REUNITED, rejecting other outcomes', async () => {
      const foundStrayPost = {
        id: postId,
        creatorId,
        postType: 'LOST',
        status: 'ACTIVE',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(foundStrayPost);
      mockPostsRepo.findLostReportType = jest.fn().mockResolvedValue('FOUND_STRAY');
      mockPostsRepo.updateStatus = jest
        .fn()
        .mockImplementation((_pid: string, _uid: string, status: string): Promise<Post> =>
          Promise.resolve({ ...foundStrayPost, status } as unknown as Post),
        );

      // RESOLVED accepted
      const resolved = await service.updatePostStatus(postId, creatorId, 'RESOLVED');
      expect(resolved.status).toBe('RESOLVED');

      // REUNITED accepted
      const reunited = await service.updatePostStatus(postId, creatorId, 'REUNITED');
      expect(reunited.status).toBe('REUNITED');

      // Invalid targets rejected
      for (const invalid of ['ADOPTED', 'SOLD']) {
        await expect(service.updatePostStatus(postId, creatorId, invalid)).rejects.toThrow(ValidationError);
      }
    });

    it('allows LOST_PET to close as REUNITED, rejecting RESOLVED', async () => {
      const lostPetPost = {
        id: postId,
        creatorId,
        postType: 'LOST',
        status: 'ACTIVE',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(lostPetPost);
      mockPostsRepo.findLostReportType = jest.fn().mockResolvedValue('LOST_PET');

      // RESOLVED rejected
      await expect(service.updatePostStatus(postId, creatorId, 'RESOLVED')).rejects.toThrow(ValidationError);
      expect(mockPostsRepo.updateStatus).not.toHaveBeenCalled();

      // REUNITED accepted
      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({ ...lostPetPost, status: 'REUNITED' });
      const reunited = await service.updatePostStatus(postId, creatorId, 'REUNITED');
      expect(reunited.status).toBe('REUNITED');
    });

    it('allows ADOPTION to close as ADOPTED, rejecting RESOLVED', async () => {
      const adoptionPost = {
        id: postId,
        creatorId,
        postType: 'ADOPTION',
        status: 'ACTIVE',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(adoptionPost);

      await expect(service.updatePostStatus(postId, creatorId, 'RESOLVED')).rejects.toThrow(ValidationError);

      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({ ...adoptionPost, status: 'ADOPTED' });
      const adopted = await service.updatePostStatus(postId, creatorId, 'ADOPTED');
      expect(adopted.status).toBe('ADOPTED');
    });

    it('allows PRODUCT to close as SOLD, rejecting RESOLVED', async () => {
      const productPost = {
        id: postId,
        creatorId,
        postType: 'PRODUCT',
        status: 'ACTIVE',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(productPost);

      await expect(service.updatePostStatus(postId, creatorId, 'RESOLVED')).rejects.toThrow(ValidationError);

      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({ ...productPost, status: 'SOLD' });
      const sold = await service.updatePostStatus(postId, creatorId, 'SOLD');
      expect(sold.status).toBe('SOLD');
    });

    it('allows MATING to close as RESOLVED, rejecting REUNITED/SOLD', async () => {
      const matingPost = {
        id: postId,
        creatorId,
        postType: 'MATING',
        status: 'ACTIVE',
      } as unknown as Post;

      mockPostsRepo.findById = jest.fn().mockResolvedValue(matingPost);

      for (const invalid of ['REUNITED', 'SOLD', 'ADOPTED']) {
        await expect(service.updatePostStatus(postId, creatorId, invalid)).rejects.toThrow(ValidationError);
      }

      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({ ...matingPost, status: 'RESOLVED' });
      const resolved = await service.updatePostStatus(postId, creatorId, 'RESOLVED');
      expect(resolved.status).toBe('RESOLVED');
    });
  });

  // ─── 4. Administrator Rescue Closure Authority ──────────────────────────

  describe('4. Administrator Rescue Closure Authority (Post Lifecycle Contract)', () => {
    it('authorizes admin resolution to RESOLVED for ACTIVE RESCUE posts without evidence gate', () => {
      expect(canAdminResolve('RESCUE', 'ACTIVE', 'RESOLVED')).toBe(true);
      expect(canOwnerClose('RESCUE', 'ACTIVE', 'RESOLVED')).toBe(true);
      expect(ownerClosureTargets('RESCUE')).toEqual(['RESOLVED']);
    });

    it('rejects admin resolution for non-ACTIVE or invalid outcome on RESCUE', () => {
      expect(canAdminResolve('RESCUE', 'RESOLVED', 'RESOLVED')).toBe(false);
      expect(canAdminResolve('RESCUE', 'REMOVED', 'RESOLVED')).toBe(false);
      expect(canAdminResolve('RESCUE', 'EXPIRED', 'RESOLVED')).toBe(false);
      expect(canAdminResolve('RESCUE', 'ACTIVE', 'REUNITED')).toBe(false);
      expect(canAdminResolve('RESCUE', 'ACTIVE', 'ADOPTED')).toBe(false);
      expect(canAdminResolve('RESCUE', 'ACTIVE', 'SOLD')).toBe(false);
    });

    it('retains admin resolution rules for supported non-rescue types', () => {
      // LOST FOUND_STRAY accepts RESOLVED and REUNITED
      expect(canAdminResolve('LOST', 'ACTIVE', 'RESOLVED', 'FOUND_STRAY')).toBe(true);
      expect(canAdminResolve('LOST', 'ACTIVE', 'REUNITED', 'FOUND_STRAY')).toBe(true);

      // LOST LOST_PET accepts REUNITED only
      expect(canAdminResolve('LOST', 'ACTIVE', 'RESOLVED', 'LOST_PET')).toBe(false);
      expect(canAdminResolve('LOST', 'ACTIVE', 'REUNITED', 'LOST_PET')).toBe(true);

      // ADOPTION accepts ADOPTED only
      expect(canAdminResolve('ADOPTION', 'ACTIVE', 'ADOPTED')).toBe(true);
      expect(canAdminResolve('ADOPTION', 'ACTIVE', 'RESOLVED')).toBe(false);

      // PRODUCT accepts SOLD only
      expect(canAdminResolve('PRODUCT', 'ACTIVE', 'SOLD')).toBe(true);
      expect(canAdminResolve('PRODUCT', 'ACTIVE', 'RESOLVED')).toBe(false);

      // MATING accepts RESOLVED only
      expect(canAdminResolve('MATING', 'ACTIVE', 'RESOLVED')).toBe(true);
      expect(canAdminResolve('MATING', 'ACTIVE', 'REUNITED')).toBe(false);
    });

    it('verifies owner closure side effects: cache invalidation and interaction termination without audit rows', () => {
      const ownerEffects = POST_LIFECYCLE_SIDE_EFFECTS.OWNER_CLOSE;
      expect(ownerEffects.userPostCountDelta).toBe('NONE');
      expect(ownerEffects.invalidateOwnerUserCache).toBe(true);
      expect(ownerEffects.moderationAudit).toBe(false);
      expect(ownerEffects.ownerNotification).toBeNull();
      expect(ownerEffects.terminatePendingInteractions).toBe(true);
    });
  });

  // ─── 5. Ordinary Rescue Discussion, Pin Permissions, Boosts & Images ────

  describe('5. Ordinary Rescue Discussion, Pin Permissions, Boosts & Images', () => {
    it('permits image comment attachments on RESCUE and LOST, rejecting other types', () => {
      expect(IMAGE_COMMENT_ALLOWED_POST_TYPES).toEqual(['RESCUE', 'LOST']);

      expect(canPublishImageComment('RESCUE')).toBe(true);
      expect(canPublishImageComment('LOST')).toBe(true);

      expect(canPublishImageComment('ADOPTION')).toBe(false);
      expect(canPublishImageComment('PRODUCT')).toBe(false);
      expect(canPublishImageComment('MATING')).toBe(false);

      expect(() => assertImageCommentAllowed('RESCUE')).not.toThrow();
      expect(() => assertImageCommentAllowed('LOST')).not.toThrow();
      expect(() => assertImageCommentAllowed('ADOPTION')).toThrow();
      expect(() => assertImageCommentAllowed('PRODUCT')).toThrow();
      expect(() => assertImageCommentAllowed('MATING')).toThrow();
    });
  });
});
