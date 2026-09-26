import 'package:image_picker/image_picker.dart';

import '../utils/presigned_upload.dart';
import '../utils/webp_compress.dart';
import 'graphql_service.dart';

/// Result of preparing and uploading one Comment photo.
class CommentImageUpload {
  /// The upload ticket to attach to `createComment`, on success.
  final String? mediaId;

  /// Backend `extensions.code` for a ticket rejection, or a `CLIENT_…` code
  /// for a failure on the device (compression, the upload PUT itself).
  final String? errorCode;
  final String? errorMessage;

  const CommentImageUpload({this.mediaId, this.errorCode, this.errorMessage});

  bool get ok => mediaId != null;
}

/// Compresses a photo to the Comment image format (static WebP, at most
/// 480 px and 100 KB, no metadata), requests an upload ticket and PUTs the
/// bytes to storage. Never throws: every failure comes back as a result, so
/// the composer can keep the draft and offer Retry.
class CommentImageUploader {
  const CommentImageUploader();

  static const compressionFailed = 'CLIENT_COMPRESSION_FAILED';
  static const uploadFailed = 'CLIENT_UPLOAD_FAILED';

  Future<CommentImageUpload> upload(GraphQLService graphql, XFile image) async {
    try {
      final bytes = await compressToWebpUnderLimit(image);
      if (bytes == null) return const CommentImageUpload(errorCode: compressionFailed);
      final (ticket, code, message) = await graphql.requestCommentImageUploadUrl(
        contentType: 'image/webp',
        fileSizeBytes: bytes.length,
      );
      if (ticket == null) return CommentImageUpload(errorCode: code ?? uploadFailed, errorMessage: message);
      final uploaded = await putToPresignedUrl(ticket['uploadUrl'] as String, bytes, 'image/webp');
      if (!uploaded) return const CommentImageUpload(errorCode: uploadFailed);
      return CommentImageUpload(mediaId: ticket['mediaId'] as String);
    } catch (_) {
      return const CommentImageUpload(errorCode: uploadFailed);
    }
  }
}
