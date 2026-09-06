import '../models/comment.dart';
import '../models/comment_submission.dart';
import '../services/graphql_service.dart';

/// Result of executing a comment or reply submission.
class CommentSubmissionResult {
  final bool success;
  final Comment? comment;
  final CommentSubmissionError? error;
  final CommentSubmission submission;

  const CommentSubmissionResult({
    required this.success,
    this.comment,
    this.error,
    required this.submission,
  });
}

/// Manages canonical pending submission identity, upload progress, and retries.
class CommentSubmissionManager {
  CommentSubmission? _currentSubmission;

  /// The currently active pending submission, if any.
  CommentSubmission? get currentSubmission => _currentSubmission;

  /// Whether a pending submission is currently stored.
  bool get hasSubmission => _currentSubmission != null;

  /// Explicitly discards the active pending submission.
  void reset() {
    _currentSubmission = null;
  }

  /// Prepares or reuses a canonical submission based on current draft content.
  ///
  /// - If the draft matches the active submission and the submission is eligible for retry,
  ///   the existing submission (and its stable clientRequestId, tickets, upload progress) is reused.
  /// - If text, target, or attachments changed intentionally, or if media tickets expired,
  ///   a distinct submission identity is generated with a fresh clientRequestId.
  CommentSubmission prepareSubmission({
    required String targetId,
    required CommentTargetType targetType,
    required String text,
    required List<List<int>> compressedImagesBytes,
  }) {
    final existing = _currentSubmission;
    if (existing != null) {
      final matches = existing.matchesDraft(
        draftText: text,
        draftTargetId: targetId,
        draftTargetType: targetType,
        draftImagesBytes: compressedImagesBytes,
      );

      if (matches) {
        // Check for expired tickets or permanent media errors
        if (existing.hasExpiredTickets || existing.hasPermanentError) {
          // AC 6: Expired or permanently invalid media cannot reuse the old request ID
          // with different/refreshed media IDs. Reset identity.
          _currentSubmission = null;
        } else {
          return existing;
        }
      } else {
        // AC 5: Intentional changes create a distinct submission identity.
        _currentSubmission = null;
      }
    }

    final newSubmission = CommentSubmission(
      clientRequestId: generateClientRequestId(),
      targetId: targetId,
      targetType: targetType,
      text: text,
      mediaItems: List.generate(
        compressedImagesBytes.length,
        (i) => CommentSubmissionMediaItem(
          position: i,
          bytes: compressedImagesBytes[i],
        ),
      ),
    );

    _currentSubmission = newSubmission;
    return newSubmission;
  }

  /// Executes the staged upload and creation pipeline with progress tracking and ticket reuse.
  Future<CommentSubmissionResult> execute({
    required GraphQLService graphql,
    required CommentSubmission submission,
  }) async {
    // 1. Process media items sequentially (request ticket + upload to R2)
    for (int i = 0; i < submission.mediaItems.length; i++) {
      final item = submission.mediaItems[i];

      // Step A: Request ticket if not yet acquired
      if (item.ticket == null) {
        final (ticket, ticketError) = await graphql.requestCommentImageUploadUrl(
          contentType: 'image/webp',
          fileSizeBytes: item.bytes.length,
          mediaPosition: item.position,
        );

        if (ticketError != null || ticket == null) {
          final err = ticketError ??
              CommentSubmissionError.network(
                message: 'Failed to request upload ticket.',
                mediaPosition: item.position,
              );
          item.error = err;
          item.isPermanentlyInvalid = !err.isRetryable;
          submission.lastError = err;
          return CommentSubmissionResult(
            success: false,
            error: err,
            submission: submission,
          );
        }

        item.ticket = ticket;
      }

      // Step B: Direct upload to R2 if not yet completed
      if (!item.uploaded) {
        if (item.isTicketExpired) {
          final err = CommentSubmissionError.permanent(
            code: 'COMMENT_MEDIA_NOT_AVAILABLE',
            message: 'Upload ticket expired. Please try again.',
            mediaPosition: item.position,
          );
          item.error = err;
          item.isPermanentlyInvalid = true;
          submission.lastError = err;
          return CommentSubmissionResult(
            success: false,
            error: err,
            submission: submission,
          );
        }

        final uploadUrl = item.uploadUrl;
        if (uploadUrl == null) {
          final err = CommentSubmissionError.permanent(
            code: 'COMMENT_MEDIA_NOT_AVAILABLE',
            message: 'Missing upload URL for media ticket.',
            mediaPosition: item.position,
          );
          item.error = err;
          item.isPermanentlyInvalid = true;
          submission.lastError = err;
          return CommentSubmissionResult(
            success: false,
            error: err,
            submission: submission,
          );
        }

        final (uploadOk, uploadError) = await graphql.uploadCommentImageToR2(
          uploadUrl: uploadUrl,
          bytes: item.bytes,
          contentType: 'image/webp',
          mediaPosition: item.position,
        );

        if (!uploadOk) {
          final err = uploadError ??
              CommentSubmissionError.network(
                message: 'Failed to upload image.',
                mediaPosition: item.position,
              );
          item.error = err;
          item.isPermanentlyInvalid = !err.isRetryable;
          submission.lastError = err;
          return CommentSubmissionResult(
            success: false,
            error: err,
            submission: submission,
          );
        }

        item.uploaded = true;
        item.error = null;
      }
    }

    // 2. Publish comment or reply
    if (submission.isReply) {
      final (createdReply, replyError) = await graphql.createReply(
        clientRequestId: submission.clientRequestId,
        commentId: submission.targetId,
        text: submission.text,
      );

      if (replyError != null || createdReply == null) {
        final err = replyError ??
            CommentSubmissionError.network(
              message: 'Failed to publish reply.',
            );
        submission.lastError = err;
        return CommentSubmissionResult(
          success: false,
          error: err,
          submission: submission,
        );
      }

      // Success: clear submission state and return
      reset();
      return CommentSubmissionResult(
        success: true,
        comment: createdReply,
        submission: submission,
      );
    } else {
      final mediaIds = submission.orderedMediaIds;
      final (createdComment, commentError) = await graphql.createComment(
        clientRequestId: submission.clientRequestId,
        postId: submission.targetId,
        text: submission.text,
        mediaIds: mediaIds.isNotEmpty ? mediaIds : null,
      );

      if (commentError != null || createdComment == null) {
        final err = commentError ??
            CommentSubmissionError.network(
              message: 'Failed to publish comment.',
            );
        submission.lastError = err;

        // If permanent error on media, mark relevant media item permanently invalid
        if (!err.isRetryable && err.mediaPosition != null) {
          final pos = err.mediaPosition!;
          if (pos >= 0 && pos < submission.mediaItems.length) {
            submission.mediaItems[pos].isPermanentlyInvalid = true;
          }
        }

        return CommentSubmissionResult(
          success: false,
          error: err,
          submission: submission,
        );
      }

      // Success: clear submission state and return
      reset();
      return CommentSubmissionResult(
        success: true,
        comment: createdComment,
        submission: submission,
      );
    }
  }
}
