import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/comment.dart';
import 'package:pupzy/models/comment_submission.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/utils/comment_submission_manager.dart';

/// Test double for GraphQLService simulating various network, R2, and backend outcomes.
class FakeGraphQLService implements GraphQLService {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  int requestTicketCallCount = 0;
  int uploadR2CallCount = 0;
  int createCommentCallCount = 0;
  int createReplyCallCount = 0;

  // Controllable behaviors
  CommentSubmissionError? nextTicketError;
  Map<String, dynamic>? Function(int fileSizeBytes, int? mediaPosition)? ticketFactory;

  CommentSubmissionError? nextUploadError;
  bool Function(String uploadUrl, List<int> bytes, int? mediaPosition)? uploadHandler;

  CommentSubmissionError? nextCreateCommentError;
  Comment? Function(String clientRequestId, String postId, String text, List<String>? mediaIds)? createCommentHandler;

  CommentSubmissionError? nextCreateReplyError;
  Comment? Function(String clientRequestId, String commentId, String text)? createReplyHandler;

  final List<String> submittedClientRequestIds = [];
  final List<List<String>?> submittedMediaIdsList = [];

  void resetCounts() {
    requestTicketCallCount = 0;
    uploadR2CallCount = 0;
    createCommentCallCount = 0;
    createReplyCallCount = 0;
    submittedClientRequestIds.clear();
    submittedMediaIdsList.clear();
  }

  @override
  Future<(Map<String, dynamic>? ticket, CommentSubmissionError? error)> requestCommentImageUploadUrl({
    required String contentType,
    required int fileSizeBytes,
    int? mediaPosition,
  }) async {
    requestTicketCallCount++;
    if (nextTicketError != null) {
      final err = nextTicketError;
      nextTicketError = null;
      return (null, err);
    }
    if (ticketFactory != null) {
      return (ticketFactory!(fileSizeBytes, mediaPosition), null);
    }
    final pos = mediaPosition ?? 0;
    return ({
      'mediaId': 'media-id-$pos-${DateTime.now().microsecondsSinceEpoch}',
      'uploadUrl': 'https://r2.example.com/staging/media-$pos',
      'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
    }, null);
  }

  @override
  Future<(bool success, CommentSubmissionError? error)> uploadCommentImageToR2({
    required String uploadUrl,
    required List<int> bytes,
    String contentType = 'image/webp',
    int? mediaPosition,
  }) async {
    uploadR2CallCount++;
    if (nextUploadError != null) {
      final err = nextUploadError;
      nextUploadError = null;
      return (false, err);
    }
    if (uploadHandler != null) {
      final ok = uploadHandler!(uploadUrl, bytes, mediaPosition);
      return (ok, ok ? null : CommentSubmissionError.network(message: 'Upload failed', mediaPosition: mediaPosition));
    }
    return (true, null);
  }

  @override
  Future<(Comment? comment, CommentSubmissionError? error)> createComment({
    required String clientRequestId,
    required String postId,
    required String text,
    List<String>? mediaIds,
  }) async {
    createCommentCallCount++;
    submittedClientRequestIds.add(clientRequestId);
    submittedMediaIdsList.add(mediaIds);

    if (nextCreateCommentError != null) {
      final err = nextCreateCommentError;
      nextCreateCommentError = null;
      return (null, err);
    }
    if (createCommentHandler != null) {
      final res = createCommentHandler!(clientRequestId, postId, text, mediaIds);
      return (res, res == null ? CommentSubmissionError.network(message: 'Network dropped') : null);
    }
    return (Comment(
      id: 'comment-canonical-1',
      postId: postId,
      author: const CommentAuthor(id: 'author-1', fullName: 'User 1', isVerified: false),
      text: text,
      status: 'ACTIVE',
      replyCount: 0,
      boostCount: 0,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      media: [],
    ), null);
  }

  @override
  Future<(Comment? comment, CommentSubmissionError? error)> createReply({
    required String clientRequestId,
    required String commentId,
    required String text,
  }) async {
    createReplyCallCount++;
    submittedClientRequestIds.add(clientRequestId);

    if (nextCreateReplyError != null) {
      final err = nextCreateReplyError;
      nextCreateReplyError = null;
      return (null, err);
    }
    if (createReplyHandler != null) {
      final res = createReplyHandler!(clientRequestId, commentId, text);
      return (res, res == null ? CommentSubmissionError.network(message: 'Network dropped') : null);
    }
    return (Comment(
      id: 'reply-canonical-1',
      postId: 'post-1',
      parentId: commentId,
      author: const CommentAuthor(id: 'author-1', fullName: 'User 1', isVerified: false),
      text: text,
      status: 'ACTIVE',
      replyCount: 0,
      boostCount: 0,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      media: [],
    ), null);
  }
}

void main() {
  group('CommentSubmission & CommentSubmissionManager (Ticket 07)', () {
    late FakeGraphQLService graphql;
    late CommentSubmissionManager manager;

    setUp(() {
      graphql = FakeGraphQLService();
      manager = CommentSubmissionManager();
    });

    test('AC 1: Canonical submission retains client request ID, target, text, and media across retries', () async {
      final img1 = [1, 2, 3, 4];
      final img2 = [5, 6, 7, 8];

      final sub1 = manager.prepareSubmission(
        targetId: 'post-123',
        targetType: CommentTargetType.post,
        text: 'Hello world',
        compressedImagesBytes: [img1, img2],
      );

      final reqId = sub1.clientRequestId;
      expect(reqId, isNotEmpty);
      expect(sub1.mediaItems.length, 2);

      // Re-preparing with identical draft preserves the exact submission and clientRequestId
      final sub2 = manager.prepareSubmission(
        targetId: 'post-123',
        targetType: CommentTargetType.post,
        text: 'Hello world',
        compressedImagesBytes: [img1, img2],
      );

      expect(identical(sub1, sub2), isTrue);
      expect(sub2.clientRequestId, reqId);
    });

    test('AC 3: Transient upload failure on 2nd image retains 1st image ticket & upload progress', () async {
      final img1 = [10, 20, 30];
      final img2 = [40, 50, 60];

      // Fail upload on image 2
      graphql.uploadHandler = (url, bytes, pos) {
        if (pos == 1) return false;
        return true;
      };

      final sub = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Two images attached',
        compressedImagesBytes: [img1, img2],
      );

      // First execution attempt
      final res1 = await manager.execute(graphql: graphql, submission: sub);

      expect(res1.success, isFalse);
      expect(res1.error?.mediaPosition, 1);
      expect(graphql.requestTicketCallCount, 2); // Requested tickets for both
      expect(graphql.uploadR2CallCount, 2); // Uploaded item 0 (ok), item 1 (failed)
      expect(sub.mediaItems[0].uploaded, isTrue);
      expect(sub.mediaItems[1].uploaded, isFalse);

      final firstImageMediaId = sub.mediaItems[0].mediaId;
      final secondImageMediaId = sub.mediaItems[1].mediaId;
      expect(firstImageMediaId, isNotNull);
      expect(secondImageMediaId, isNotNull);

      // Reset mock counts and make upload succeed on retry
      graphql.resetCounts();
      graphql.uploadHandler = (url, bytes, pos) => true;

      // Retry execution with the same pending submission
      final res2 = await manager.execute(graphql: graphql, submission: sub);

      expect(res2.success, isTrue);
      // Crucial: Ticket request should NOT have been called again for item 0 or 1!
      expect(graphql.requestTicketCallCount, 0);
      // Crucial: Item 0 should NOT have been uploaded again! Only item 1 uploaded!
      expect(graphql.uploadR2CallCount, 1);
      // createComment called with canonical request ID and original ordered media IDs
      expect(graphql.createCommentCallCount, 1);
      expect(graphql.submittedClientRequestIds.single, sub.clientRequestId);
      expect(graphql.submittedMediaIdsList.single, [firstImageMediaId, secondImageMediaId]);
    });

    test('AC 2: Lost successful create response retries with identical request ID and payload', () async {
      final img = [1, 2, 3];
      final sub = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Network timeout after server commit',
        compressedImagesBytes: [img],
      );

      // Simulate lost network response on createComment
      graphql.nextCreateCommentError = CommentSubmissionError.network(
        message: 'SocketException: OS Error: Connection timed out',
      );

      final res1 = await manager.execute(graphql: graphql, submission: sub);
      expect(res1.success, isFalse);
      expect(res1.error?.isRetryable, isTrue);
      expect(manager.hasSubmission, isTrue);

      final originalRequestId = sub.clientRequestId;
      final originalMediaId = sub.mediaItems[0].mediaId;

      // On retry: identical clientRequestId and identical mediaId are sent
      graphql.resetCounts();
      final res2 = await manager.execute(graphql: graphql, submission: sub);

      expect(res2.success, isTrue);
      expect(graphql.createCommentCallCount, 1);
      expect(graphql.submittedClientRequestIds.single, originalRequestId);
      expect(graphql.submittedMediaIdsList.single, [originalMediaId]);
      expect(manager.hasSubmission, isFalse); // Cleared upon success
    });

    test('AC 4: Structured error codes, media position, and retryability', () {
      final errRateLimit = CommentSubmissionError(
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        isRetryable: true,
      );
      expect(errRateLimit.isRetryable, isTrue);
      expect(CommentSubmissionError.isCodeRetryable('RATE_LIMITED'), isTrue);

      final errFormat = CommentSubmissionError.permanent(
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Unsupported format',
        mediaPosition: 0,
      );
      expect(errFormat.isRetryable, isFalse);
      expect(errFormat.mediaPosition, 0);

      final netErr = CommentSubmissionError.network(mediaPosition: 1);
      expect(netErr.code, 'NETWORK_ERROR');
      expect(netErr.isRetryable, isTrue);
      expect(netErr.mediaPosition, 1);
    });

    test('AC 5: Intentional changes to text, target, or images generate a distinct submission identity', () {
      final img1 = [1, 2, 3];
      final sub1 = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Initial text',
        compressedImagesBytes: [img1],
      );
      final reqId1 = sub1.clientRequestId;

      // Text edit -> new identity
      final sub2 = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Edited text',
        compressedImagesBytes: [img1],
      );
      expect(sub2.clientRequestId, isNot(equals(reqId1)));

      // Adding an image -> new identity
      final sub3 = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Edited text',
        compressedImagesBytes: [img1, [4, 5, 6]],
      );
      expect(sub3.clientRequestId, isNot(equals(sub2.clientRequestId)));

      // Changing target (e.g. to reply) -> new identity
      final sub4 = manager.prepareSubmission(
        targetId: 'comment-parent-1',
        targetType: CommentTargetType.reply,
        text: 'Edited text',
        compressedImagesBytes: [],
      );
      expect(sub4.clientRequestId, isNot(equals(sub3.clientRequestId)));
      expect(sub4.isReply, isTrue);
    });

    test('AC 6: Expired tickets trigger new submission identity upon draft refresh', () {
      final img = [9, 8, 7];
      final sub = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Expired ticket scenario',
        compressedImagesBytes: [img],
      );

      // Simulate expired ticket
      sub.mediaItems[0].ticket = {
        'mediaId': 'm-expired-1',
        'uploadUrl': 'https://r2.example.com/expired',
        'expiresAt': DateTime.now().subtract(const Duration(minutes: 5)).toIso8601String(),
      };
      expect(sub.hasExpiredTickets, isTrue);

      final reqIdOld = sub.clientRequestId;

      // prepareSubmission detects expired ticket and creates a fresh submission identity
      final refreshedSub = manager.prepareSubmission(
        targetId: 'post-1',
        targetType: CommentTargetType.post,
        text: 'Expired ticket scenario',
        compressedImagesBytes: [img],
      );

      expect(refreshedSub.clientRequestId, isNot(equals(reqIdOld)));
      expect(refreshedSub.hasExpiredTickets, isFalse);
    });

    test('AC 7: Text-only comments and replies preserve safe request identity and skip media', () async {
      // 1. Text-only comment
      final textCommentSub = manager.prepareSubmission(
        targetId: 'post-text-1',
        targetType: CommentTargetType.post,
        text: 'Pure text discussion',
        compressedImagesBytes: [],
      );

      graphql.nextCreateCommentError = CommentSubmissionError.network();
      final res1 = await manager.execute(graphql: graphql, submission: textCommentSub);
      expect(res1.success, isFalse);
      expect(graphql.requestTicketCallCount, 0); // No tickets requested
      expect(graphql.uploadR2CallCount, 0); // No uploads

      // Retry text comment
      final textReqId = textCommentSub.clientRequestId;
      final res2 = await manager.execute(graphql: graphql, submission: textCommentSub);
      expect(res2.success, isTrue);
      expect(graphql.submittedClientRequestIds.last, textReqId);
      expect(graphql.submittedMediaIdsList.last, isNull);

      // 2. Text reply
      final replySub = manager.prepareSubmission(
        targetId: 'parent-comment-1',
        targetType: CommentTargetType.reply,
        text: 'Reply to parent',
        compressedImagesBytes: [],
      );

      final replyReqId = replySub.clientRequestId;
      final res3 = await manager.execute(graphql: graphql, submission: replySub);
      expect(res3.success, isTrue);
      expect(graphql.createReplyCallCount, 1);
      expect(graphql.submittedClientRequestIds.last, replyReqId);
    });
  });
}
