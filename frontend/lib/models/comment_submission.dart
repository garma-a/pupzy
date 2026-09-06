import 'dart:math';
import 'package:graphql_flutter/graphql_flutter.dart';

/// Generates an RFC 4122 compliant UUIDv4 for author-scoped durable client request IDs.
String generateClientRequestId() {
  final random = Random.secure();
  final values = List<int>.generate(16, (_) => random.nextInt(256));
  // Set version (4) and variant (RFC 4122: 10xxxxxx)
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;

  final buffer = StringBuffer();
  for (int i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) {
      buffer.write('-');
    }
    buffer.write(values[i].toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}

/// Target type for a discussion submission: top-level post comment or reply to a comment.
enum CommentTargetType {
  post,
  reply,
}

/// Structured error representing comment submission and image upload failures.
class CommentSubmissionError {
  final String? code;
  final String message;
  final bool isRetryable;
  final int? mediaPosition;

  const CommentSubmissionError({
    this.code,
    required this.message,
    this.isRetryable = false,
    this.mediaPosition,
  });

  /// Factory constructor for network errors (e.g. lost response, connection drop, socket exception).
  factory CommentSubmissionError.network({
    String? message,
    int? mediaPosition,
  }) {
    return CommentSubmissionError(
      code: 'NETWORK_ERROR',
      message: message ?? 'Network error. Please check your connection and retry.',
      isRetryable: true,
      mediaPosition: mediaPosition,
    );
  }

  /// Factory constructor for client-side preparation or validation failures.
  factory CommentSubmissionError.permanent({
    required String code,
    required String message,
    int? mediaPosition,
  }) {
    return CommentSubmissionError(
      code: code,
      message: message,
      isRetryable: false,
      mediaPosition: mediaPosition,
    );
  }

  /// Determines whether a known error code represents a retryable condition.
  static bool isCodeRetryable(String? code) {
    if (code == null) return false;
    switch (code) {
      case 'COMMENT_MEDIA_PROCESSING_FAILED':
      case 'COMMENT_MEDIA_NOT_READY':
      case 'RATE_LIMITED':
      case 'NETWORK_ERROR':
      case 'INTERNAL_SERVER_ERROR':
        return true;
      case 'COMMENT_MEDIA_INVALID_FORMAT':
      case 'COMMENT_MEDIA_TOO_LARGE':
      case 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED':
      case 'COMMENT_MEDIA_METADATA_FORBIDDEN':
      case 'COMMENT_MEDIA_BLOCKED':
      case 'COMMENT_MEDIA_CLAIM_CONFLICT':
      case 'COMMENT_MEDIA_NOT_AVAILABLE':
      case 'COMMENT_MEDIA_ALREADY_USED':
      case 'COMMENT_IMAGES_DISABLED':
      case 'CONFLICT':
      case 'VALIDATION_ERROR':
      case 'BAD_USER_INPUT':
      case 'FORBIDDEN':
      case 'NOT_FOUND':
        return false;
      default:
        return false;
    }
  }

  /// Maps standard error codes to user-friendly product messages.
  static String getFriendlyMessage(String? code, String serverMessage) {
    switch (code) {
      case 'COMMENT_MEDIA_INVALID_FORMAT':
        return 'Only static WebP images are supported. Please choose another image.';
      case 'COMMENT_MEDIA_TOO_LARGE':
        return 'Image exceeds the 100 KB limit. Please choose another image.';
      case 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED':
        return 'Image dimensions exceed 480x480 pixels.';
      case 'COMMENT_MEDIA_METADATA_FORBIDDEN':
        return 'Image contains embedded metadata. Please re-select.';
      case 'COMMENT_MEDIA_NOT_READY':
        return 'Media upload is still processing. Please retry.';
      case 'COMMENT_MEDIA_BLOCKED':
        return 'This image cannot be uploaded as it violates platform guidelines.';
      case 'COMMENT_MEDIA_CLAIM_CONFLICT':
        return 'Upload ticket is invalid. Please select the image again.';
      case 'COMMENT_MEDIA_NOT_AVAILABLE':
        return 'Media is no longer available. Please select the image again.';
      case 'COMMENT_MEDIA_ALREADY_USED':
        return 'Media has already been published. Please select a fresh image.';
      case 'COMMENT_MEDIA_PROCESSING_FAILED':
        return 'Media processing temporarily failed. Please retry.';
      case 'COMMENT_IMAGES_DISABLED':
        return 'Image attachments are temporarily disabled. You can still post text comments.';
      case 'CONFLICT':
        return 'A different comment with this request ID was already submitted. Please try again.';
      case 'RATE_LIMITED':
        return 'You are commenting too fast. Please wait a moment.';
      case 'NETWORK_ERROR':
        return 'Network error. Please check your connection and retry.';
      default:
        return serverMessage.isNotEmpty
            ? serverMessage
            : 'An unexpected error occurred. Please try again.';
    }
  }

  /// Parses a GraphQL [OperationException] into a structured [CommentSubmissionError].
  factory CommentSubmissionError.fromOperationException(
    OperationException? exception, {
    int? mediaPosition,
    String? fallbackMessage,
  }) {
    if (exception == null) {
      return CommentSubmissionError(
        code: null,
        message: fallbackMessage ?? 'Unknown error occurred.',
        isRetryable: false,
        mediaPosition: mediaPosition,
      );
    }

    if (exception.graphqlErrors.isNotEmpty) {
      final gqlErr = exception.graphqlErrors.first;
      final rawExt = gqlErr.extensions;
      final code = rawExt?['code']?.toString();

      int? resolvedMediaPos = mediaPosition;
      if (rawExt?['mediaPosition'] != null) {
        if (rawExt!['mediaPosition'] is int) {
          resolvedMediaPos = rawExt['mediaPosition'] as int;
        } else {
          resolvedMediaPos = int.tryParse(rawExt['mediaPosition'].toString());
        }
      }

      bool retryable;
      if (rawExt?['retryable'] is bool) {
        retryable = rawExt!['retryable'] as bool;
      } else {
        retryable = isCodeRetryable(code);
      }

      final friendlyMsg = getFriendlyMessage(code, gqlErr.message);

      return CommentSubmissionError(
        code: code,
        message: friendlyMsg,
        isRetryable: retryable,
        mediaPosition: resolvedMediaPos,
      );
    }

    // Network / Link exceptions
    return CommentSubmissionError.network(
      message: fallbackMessage,
      mediaPosition: mediaPosition,
    );
  }

  @override
  String toString() =>
      'CommentSubmissionError(code: $code, message: $message, isRetryable: $isRetryable, mediaPosition: $mediaPosition)';
}

/// Tracks the upload state, ticket, and bytes for an attached image in a submission.
class CommentSubmissionMediaItem {
  final int position;
  final List<int> bytes;
  Map<String, dynamic>? ticket;
  bool uploaded;
  CommentSubmissionError? error;
  bool isPermanentlyInvalid;

  CommentSubmissionMediaItem({
    required this.position,
    required this.bytes,
    this.ticket,
    this.uploaded = false,
    this.error,
    this.isPermanentlyInvalid = false,
  });

  String? get mediaId => ticket?['mediaId'] as String?;
  String? get uploadUrl => ticket?['uploadUrl'] as String?;

  bool get isTicketExpired {
    if (ticket == null) return false;
    final expStr = ticket!['expiresAt'] as String?;
    if (expStr == null) return false;
    final expDate = DateTime.tryParse(expStr);
    if (expDate == null) return false;
    return expDate.isBefore(DateTime.now());
  }

  bool get isEligibleForUploadRetry {
    if (isPermanentlyInvalid) return false;
    if (isTicketExpired) return false;
    if (ticket == null) return true;
    return !uploaded;
  }
}

/// Canonical pending submission retaining request identity, payload, media, and progress.
class CommentSubmission {
  final String clientRequestId;
  final String targetId;
  final CommentTargetType targetType;
  final String text;
  final List<CommentSubmissionMediaItem> mediaItems;
  CommentSubmissionError? lastError;
  final DateTime createdAt;

  CommentSubmission({
    required this.clientRequestId,
    required this.targetId,
    required this.targetType,
    required this.text,
    List<CommentSubmissionMediaItem>? mediaItems,
    this.lastError,
    DateTime? createdAt,
  })  : mediaItems = mediaItems ?? [],
        createdAt = createdAt ?? DateTime.now();

  bool get isReply => targetType == CommentTargetType.reply;

  List<String> get orderedMediaIds =>
      mediaItems.map((m) => m.mediaId).whereType<String>().toList();

  bool get allMediaUploaded =>
      mediaItems.isEmpty ||
      mediaItems.every((m) => m.uploaded && m.mediaId != null);

  bool get hasExpiredTickets => mediaItems.any((m) => m.isTicketExpired);

  bool get hasPermanentError =>
      (lastError != null && !lastError!.isRetryable) ||
      mediaItems.any((m) => m.isPermanentlyInvalid);

  /// Checks if a draft (text, target, attachments) matches this pending submission.
  bool matchesDraft({
    required String draftText,
    required String draftTargetId,
    required CommentTargetType draftTargetType,
    required List<List<int>> draftImagesBytes,
  }) {
    if (targetId != draftTargetId) return false;
    if (targetType != draftTargetType) return false;
    if (text != draftText) return false;
    if (mediaItems.length != draftImagesBytes.length) return false;

    for (int i = 0; i < mediaItems.length; i++) {
      final itemBytes = mediaItems[i].bytes;
      final draftBytes = draftImagesBytes[i];
      if (!_bytesEqual(itemBytes, draftBytes)) return false;
    }

    return true;
  }

  static bool _bytesEqual(List<int> a, List<int> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
