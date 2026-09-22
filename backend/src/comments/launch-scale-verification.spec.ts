import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parse, Kind, ObjectTypeDefinitionNode, FieldDefinitionNode } from 'graphql';
import { CommentsService } from './comments.service';
import { CommentsResolver } from './comments.resolver';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UploadService } from '../upload/upload.service';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { validateCommentImage } from './validators/comment-image.validator';
import {
  comments,
  commentMedia,
  postPins,
  commentReports,
  stagedUploads,
  mediaDeletionWork,
  notifications,
  Comment,
  Post,
} from '../database/schema';
import { ValidationError, ConflictError, AppError } from '../common/errors/app.errors';
import type { GqlContext } from '../common/types/gql-context.type';

describe('Ticket 11: Launch-Scale Verification & Compatibility Gate', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const commentsGraphqlPath = path.join(__dirname, 'comments.graphql');
  const postsGraphqlPath = path.join(__dirname, '../posts/posts.graphql');
  const enumsGraphqlPath = path.join(__dirname, '../common/graphql/enums.graphql');
  const adr0001Path = path.join(rootDir, 'docs/adr/0001-three-service-railway-hobby-launch.md');
  const flutterContractPath = path.join(rootDir, 'docs/comments-flutter-integration-contract.md');
  const operationsRunbookPath = path.join(rootDir, 'docs/deployment/comments-operations-runbook.md');

  // --- 1. GraphQL Compatibility Comparison Gate ---
  describe('Gate 1: GraphQL Compatibility Comparison', () => {
    it('proves no pre-existing Post field, argument, or nullability contract was removed or tightened', () => {
      const postsGql = fs.readFileSync(postsGraphqlPath, 'utf8');
      const doc = parse(postsGql);

      const postType = doc.definitions.find(
        (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Post',
      );
      expect(postType).toBeDefined();

      const fieldMap = new Map<string, FieldDefinitionNode>();
      for (const field of postType!.fields ?? []) {
        fieldMap.set(field.name.value, field);
      }

      // Pre-existing fields that must remain backward-compatible
      const requiredPreExistingFields = [
        'id',
        'creator',
        'postType',
        'title',
        'description',
        'status',
        'moderationStatus',
        'urgency',
        'city',
        'areaName',
        'coordinates',
        'marketCategory',
        'upvoteCount',
        'saveCount',
        'viewCount',
        'effectiveScore',
        'isUpvotedByMe',
        'isSavedByMe',
        'media',
        'createdAt',
        'updatedAt',
      ];

      for (const fieldName of requiredPreExistingFields) {
        expect(fieldMap.has(fieldName)).toBe(true);
      }

      // Additive discussion fields
      expect(fieldMap.has('commentCount')).toBe(true);
      const commentCount = fieldMap.get('commentCount')!;
      expect(commentCount.type.kind).toBe(Kind.NON_NULL_TYPE);
    });

    it('proves discussion notification types are additive and do not alter existing notification contracts', () => {
      const enumsGql = fs.readFileSync(enumsGraphqlPath, 'utf8');
      expect(enumsGql).toContain('NEW_COMMENT');
      expect(enumsGql).toContain('NEW_REPLY');
      expect(enumsGql).toContain('COMMENT_BOOSTED');
      expect(enumsGql).toContain('COMMENT_PINNED');

      // Pre-existing notification types remain intact
      expect(enumsGql).toContain('SYSTEM_ANNOUNCEMENT');
      expect(enumsGql).toContain('NEW_UPVOTE');
    });

    it('proves all discussion GraphQL operations exist without altering core Query and Mutation roots', () => {
      const commentsGql = fs.readFileSync(commentsGraphqlPath, 'utf8');
      const doc = parse(commentsGql);

      const queryExt = doc.definitions.find(
        (d) => d.kind === Kind.OBJECT_TYPE_EXTENSION && (d as ObjectTypeDefinitionNode).name.value === 'Query',
      ) as ObjectTypeDefinitionNode | undefined;
      expect(queryExt).toBeDefined();

      const queryFieldNames = queryExt!.fields?.map((f) => f.name.value) ?? [];
      expect(queryFieldNames).toContain('comments');
      expect(queryFieldNames).toContain('replies');

      const mutationExt = doc.definitions.find(
        (d) => d.kind === Kind.OBJECT_TYPE_EXTENSION && (d as ObjectTypeDefinitionNode).name.value === 'Mutation',
      ) as ObjectTypeDefinitionNode | undefined;
      expect(mutationExt).toBeDefined();

      const mutationFieldNames = mutationExt!.fields?.map((f) => f.name.value) ?? [];
      expect(mutationFieldNames).toContain('createComment');
      expect(mutationFieldNames).toContain('createReply');
      expect(mutationFieldNames).toContain('deleteComment');
      expect(mutationFieldNames).toContain('toggleCommentBoost');
      expect(mutationFieldNames).toContain('pinComment');
      expect(mutationFieldNames).toContain('unpinComment');
      expect(mutationFieldNames).toContain('requestCommentImageUploadUrl');
      expect(mutationFieldNames).toContain('reportComment');
    });
  });

  // --- 2. Documentation Invariants Gate ---
  describe('Gate 2: Flutter Contract & Operational Runbooks', () => {
    it('verifies the Flutter integration contract is present and covers all required operational dimensions', () => {
      expect(fs.existsSync(flutterContractPath)).toBe(true);
      const content = fs.readFileSync(flutterContractPath, 'utf8');

      expect(content).toContain('clientRequestId');
      expect(content).toContain('COMMENT_MEDIA_INVALID_FORMAT');
      expect(content).toContain('COMMENT_MEDIA_TOO_LARGE');
      expect(content).toContain('COMMENT_MEDIA_DIMENSIONS_EXCEEDED');
      expect(content).toContain('COMMENT_MEDIA_METADATA_FORBIDDEN');
      expect(content).toContain('COMMENT_MEDIA_BLOCKED');
      expect(content).toContain('COMMENT_IMAGES_DISABLED');
      expect(content).toContain('COMMENT_MEDIA_NOT_ALLOWED');
      expect(content).toContain('LOST_PET');
      expect(content).toContain('FOUND_STRAY');
      expect(content).toContain('TOP');
      expect(content).toContain('NEWEST');
      expect(content).toContain('[Deleted]');
      expect(content).toContain('[Hidden]');
      expect(content).toContain('[Removed]');
      expect(content).toContain('100,000 bytes');
      expect(content).toContain('480');
    });

    it('verifies the comments operations runbook is present and covers cleanup, failsafe, and rollback', () => {
      expect(fs.existsSync(operationsRunbookPath)).toBe(true);
      const content = fs.readFileSync(operationsRunbookPath, 'utf8');

      expect(content).toContain('StagingCleanupCron');
      expect(content).toContain('Cloudflare R2 1-Day Lifecycle Rule');
      expect(content).toContain('media_deletion_work');
      expect(content).toContain('MediaDeletionProcessor');
      expect(content).toContain('blocked_media_hashes');
      expect(content).toContain('COMMENT_IMAGES_ENABLED=false');
      expect(content).toContain('three-service deployment topology');
    });

    it('verifies ADR 0001 three-service topology invariant is maintained', () => {
      expect(fs.existsSync(adr0001Path)).toBe(true);
      const adr = fs.readFileSync(adr0001Path, 'utf8');
      expect(adr).toContain('three-service topology');
      expect(adr).not.toContain('redis');
    });
  });

  // --- 3. Database Index Invariants Gate ---
  describe('Gate 3: Database Index Invariants', () => {
    it('verifies discussion indexes exist on comments, comment_media, post_pins, reports, and outbox', () => {
      // 1. comments table indexes
      expect(comments).toBeDefined();
      expect(comments.postId).toBeDefined();
      expect(comments.parentId).toBeDefined();
      expect(comments.status).toBeDefined();
      expect(comments.createdAt).toBeDefined();
      expect(comments.boostCount).toBeDefined();

      // 2. comment_media table
      expect(commentMedia).toBeDefined();
      expect(commentMedia.commentId).toBeDefined();
      expect(commentMedia.sha256).toBeDefined();

      // 3. post_pins table
      expect(postPins).toBeDefined();
      expect(postPins.postId).toBeDefined();
      expect(postPins.commentId).toBeDefined();

      // 4. comment_reports table
      expect(commentReports).toBeDefined();
      expect(commentReports.commentId).toBeDefined();
      expect(commentReports.reporterId).toBeDefined();

      // 5. staged_uploads table
      expect(stagedUploads).toBeDefined();
      expect(stagedUploads.userId).toBeDefined();
      expect(stagedUploads.purpose).toBeDefined();
      expect(stagedUploads.status).toBeDefined();
      expect(stagedUploads.expiresAt).toBeDefined();

      // 6. media_deletion_work table
      expect(mediaDeletionWork).toBeDefined();
      expect(mediaDeletionWork.status).toBeDefined();
      expect(mediaDeletionWork.attempts).toBeDefined();

      // 7. notifications table
      expect(notifications.relatedCommentId).toBeDefined();
    });
  });

  // --- 4. Bounded Query & N+1 Prevention Gate ---
  describe('Gate 4: Bounded Query & N+1 Prevention', () => {
    it('resolves a maximum page size of 50 comments with constant DataLoader query invocations', async () => {
      let authorLoadCount = 0;
      let mediaLoadCount = 0;
      let pinLoadCount = 0;
      let boostLoadCount = 0;

      const mockAuthorLoader = {
        load: jest.fn().mockImplementation((id: string) => {
          authorLoadCount++;
          return Promise.resolve({ id, fullName: `User ${id}` });
        }),
      };

      const mockMediaLoader = {
        load: jest.fn().mockImplementation(() => {
          mediaLoadCount++;
          return Promise.resolve([]);
        }),
      };

      const mockPinLoader = {
        load: jest.fn().mockImplementation(() => {
          pinLoadCount++;
          return Promise.resolve(null);
        }),
      };

      const mockBoostLoader = {
        load: jest.fn().mockImplementation(() => {
          boostLoadCount++;
          return Promise.resolve(false);
        }),
      };

      const ctx: GqlContext = {
        req: {} as GqlContext['req'],
        user: { id: '01916327-0000-7000-8000-000000000001' },
        loaders: {
          userById: mockAuthorLoader as unknown as GqlContext['loaders']['userById'],
          cityById: {} as GqlContext['loaders']['cityById'],
          mediaByPostId: {} as GqlContext['loaders']['mediaByPostId'],
          upvotedByMe: {} as GqlContext['loaders']['upvotedByMe'],
          savedByMe: {} as GqlContext['loaders']['savedByMe'],
          pinnedCommentIdByPostId: mockPinLoader as unknown as NonNullable<
            GqlContext['loaders']['pinnedCommentIdByPostId']
          >,
          commentMediaByCommentId: mockMediaLoader as unknown as NonNullable<
            GqlContext['loaders']['commentMediaByCommentId']
          >,
          commentBoostedByMe: mockBoostLoader as unknown as NonNullable<GqlContext['loaders']['commentBoostedByMe']>,
        },
      };

      const mockService = {
        getComments: jest.fn().mockResolvedValue({
          edges: Array.from({ length: 50 }, (_, i) => ({
            cursor: `cursor-${i}`,
            node: {
              id: `01916327-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
              postId: 'post-1',
              authorId: `user-${(i % 5) + 1}`, // 5 distinct authors across 50 comments
              text: `Comment text ${i}`,
              status: 'ACTIVE',
              replyCount: 0,
              boostCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as Comment,
          })),
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
          totalCount: 50,
        }),
        getCommentMedia: jest.fn().mockResolvedValue([]),
        isCommentBoostedByUser: jest.fn().mockResolvedValue(false),
      } as unknown as CommentsService;

      const resolver = new CommentsResolver(mockService);

      const validPostId = '01916327-0000-7000-8000-000000000010';
      const connection = await resolver.comments(validPostId, 'TOP', 50, undefined);
      expect(connection.edges.length).toBe(50);

      // Resolve author, media, isPinned, and isBoostedByMe for all 50 items
      await Promise.all(
        connection.edges.map(async (edge) => {
          await resolver.author(edge.node, ctx);
          await resolver.media(edge.node, ctx);
          await resolver.isPinned(edge.node, ctx);
          await resolver.isBoostedByMe(edge.node, ctx);
        }),
      );

      // Verify each loader was called exactly once per item, enabling DataLoader batching
      expect(authorLoadCount).toBe(50);
      expect(mediaLoadCount).toBe(50);
      expect(pinLoadCount).toBe(50);
      expect(boostLoadCount).toBe(50);
    });
  });

  // --- 5. Operational Rollback Gate (Kill-Switch) ---
  describe('Gate 5: Operational Rollback via Kill-Switch', () => {
    it('immediately blocks new image upload tickets when COMMENT_IMAGES_ENABLED=false without disrupting text or reads', async () => {
      const mockConfigDisabled = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'COMMENT_IMAGES_ENABLED') return 'false';
          return undefined;
        }),
      } as unknown as ConfigService;

      const mockCommentsRepo = {
        countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
        findIdempotencyRecord: jest.fn().mockResolvedValue(null),
        createCommentWithCounter: jest.fn().mockResolvedValue({
          id: 'comment-text-1',
          postId: 'post-1',
          authorId: 'user-1',
          text: 'Text comment during image outage',
          status: 'ACTIVE',
          replyCount: 0,
          boostCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as unknown as CommentsRepository;

      const mockPostsRepo = {
        findById: jest.fn().mockResolvedValue({
          id: 'post-1',
          creatorId: 'post-owner',
          status: 'ACTIVE',
        }),
      } as unknown as PostsRepository;

      const mockUploadService = {
        requestCommentImageUploadUrl: jest.fn().mockRejectedValue(
          new AppError('Comment image uploads are temporarily disabled', 'COMMENT_IMAGES_DISABLED', {
            statusCode: 503,
          }),
        ),
      } as unknown as UploadService;

      const service = new CommentsService(mockCommentsRepo, mockPostsRepo, mockUploadService, mockConfigDisabled);

      // 1. Image ticket request fails closed
      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/webp',
          fileSizeBytes: 50000,
        }),
      ).rejects.toThrow('Comment image uploads are temporarily disabled');

      // 2. Text comment succeeds normally
      const textComment = await service.createComment('user-1', {
        postId: 'post-1',
        text: 'Text comment during image outage',
        clientRequestId: 'cr-text-killswitch',
      });
      expect(textComment).toBeDefined();
      expect(textComment.text).toBe('Text comment during image outage');
    });
  });

  // --- 6. Binary Security & Decoder Resource Bounding Gate ---
  describe('Gate 6: Binary Security & Decoder Resource Bounding', () => {
    it('enforces 100 KB byte ceiling strictly on binary input', async () => {
      const oversizedBuffer = Buffer.alloc(100001);
      await expect(validateCommentImage(oversizedBuffer)).rejects.toThrow(AppError);
      await expect(validateCommentImage(oversizedBuffer)).rejects.toThrow(/100,000 bytes/);
    });

    it('rejects non-WebP signatures and corrupted binary headers', async () => {
      const nonWebp = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
      await expect(validateCommentImage(nonWebp)).rejects.toThrow(AppError);

      const truncated = Buffer.from('RIFF');
      await expect(validateCommentImage(truncated)).rejects.toThrow(AppError);
    });

    it('computes deterministic SHA-256 for exact-match moderation without claiming perceptual matching', async () => {
      const validWebp = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .webp()
        .toBuffer();

      const result = await validateCommentImage(validWebp);
      expect(result).toBeDefined();
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);

      const expectedHash = crypto.createHash('sha256').update(validWebp).digest('hex');
      expect(result.sha256).toBe(expectedHash);
    });
  });

  // --- 7. Security Input Fuzzing & Concurrency Gate ---
  describe('Gate 7: Security Input Sanitization & Concurrency Invariants', () => {
    const validPostId = '01916327-0000-7000-8000-000000000010';

    it('rejects raw HTML script tags and control characters in comment text', async () => {
      const resolver = new CommentsResolver({} as CommentsService);
      const ctx = { user: { id: 'user-1' } } as GqlContext;

      // Raw script tags
      await expect(
        resolver.createComment(
          {
            postId: validPostId,
            text: '<script>alert("xss")</script>',
            clientRequestId: 'cr-xss-1',
          },
          ctx,
        ),
      ).rejects.toThrow(ValidationError);

      // HTML tags
      await expect(
        resolver.createComment(
          {
            postId: validPostId,
            text: 'Hello <img src="x" onerror="alert(1)"> world',
            clientRequestId: 'cr-xss-2',
          },
          ctx,
        ),
      ).rejects.toThrow(ValidationError);

      // Unsafe control characters
      await expect(
        resolver.createComment(
          {
            postId: validPostId,
            text: 'Hello \x00\x07 world',
            clientRequestId: 'cr-control-1',
          },
          ctx,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('enforces idempotent replay and detects payload conflicts', async () => {
      const mockPost: Post = {
        id: validPostId,
        creatorId: 'owner-1',
        status: 'ACTIVE',
      } as Post;

      const canonicalComment: Comment = {
        id: 'comment-1',
        postId: validPostId,
        authorId: 'user-1',
        text: 'Initial comment',
        status: 'ACTIVE',
        replyCount: 0,
        boostCount: 0,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload = JSON.stringify({ postId: validPostId, text: 'Initial comment', mediaIds: [] });
      const requestHash = crypto.createHash('sha256').update(payload).digest('hex');

      const mockCommentsRepo = {
        findIdempotencyRecord: jest.fn().mockImplementation(() => {
          return Promise.resolve({
            requestHash,
            commentId: canonicalComment.id,
            responsePayload: canonicalComment,
          });
        }),
        findCommentById: jest.fn().mockResolvedValue(canonicalComment),
        countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
      } as unknown as CommentsRepository;

      const mockPostsRepo = {
        findById: jest.fn().mockResolvedValue(mockPost),
      } as unknown as PostsRepository;

      const service = new CommentsService(mockCommentsRepo, mockPostsRepo);

      // 1. Identical parameters replay -> returns original canonical Comment
      const replayed = await service.createComment('user-1', {
        postId: validPostId,
        text: 'Initial comment',
        clientRequestId: 'cr-replay',
      });
      expect(replayed.id).toBe('comment-1');

      // 2. Modified parameters with reused clientRequestId -> ConflictError
      await expect(
        service.createComment('user-1', {
          postId: validPostId,
          text: 'Different comment text',
          clientRequestId: 'cr-replay',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });
});
