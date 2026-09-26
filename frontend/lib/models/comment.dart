/// An image attached to a top-level Comment (never to a Reply).
class CommentMedia {
  final String id;
  final String publicUrl;
  final int width;
  final int height;
  final int displayOrder;

  const CommentMedia({
    required this.id,
    required this.publicUrl,
    required this.width,
    required this.height,
    required this.displayOrder,
  });

  factory CommentMedia.fromJson(Map<String, dynamic> json) => CommentMedia(
        id: json['id'] as String,
        publicUrl: json['publicUrl'] as String,
        width: json['width'] as int? ?? 0,
        height: json['height'] as int? ?? 0,
        displayOrder: json['displayOrder'] as int? ?? 0,
      );
}

/// The author of a Comment. Nullable on the backend (e.g. deleted account),
/// so every field here is optional.
class CommentAuthor {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;

  const CommentAuthor({
    required this.id,
    this.fullName,
    this.fullNameArabic,
    this.profilePictureUrl,
  });

  factory CommentAuthor.fromJson(Map<String, dynamic> json) => CommentAuthor(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        fullNameArabic: json['fullNameArabic'] as String?,
        profilePictureUrl: json['profilePictureUrl'] as String?,
      );
}

/// A top-level Comment or a Reply beneath one. Replies never carry [media]
/// (enforced server-side) and always have a non-null [parentId].
/// Outcome of `createComment` / `createReply`.
class CommentMutationResult {
  /// The canonical Comment or Reply on success.
  final Comment? comment;

  /// The backend's stable `extensions.code`, when it answered with an error.
  final String? errorCode;
  final String? errorMessage;

  const CommentMutationResult({this.comment, this.errorCode, this.errorMessage});

  /// No answer reached the app (offline, timeout, dropped response): the
  /// server may or may not have saved it, so a retry must reuse the same
  /// `clientRequestId` and payload to get the canonical result back.
  bool get outcomeUnknown => comment == null && errorCode == null && errorMessage == null;
}

class Comment {
  final String id;
  final String postId;
  final String? parentId;
  final CommentAuthor? author;
  final String text;
  final String status; // ACTIVE, IMAGE_HIDDEN, HIDDEN, DELETED, REMOVED
  final int replyCount;
  final int boostCount;
  final bool isBoostedByMe;
  final bool isPinned;
  final List<CommentMedia> media;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Comment({
    required this.id,
    required this.postId,
    this.parentId,
    this.author,
    required this.text,
    required this.status,
    required this.replyCount,
    required this.boostCount,
    required this.isBoostedByMe,
    required this.isPinned,
    required this.media,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isReply => parentId != null;

  /// Image was stripped by moderation but the text is still shown.
  bool get imageWasHidden => status == 'IMAGE_HIDDEN';

  factory Comment.fromJson(Map<String, dynamic> json) {
    final authorJson = json['author'] as Map<String, dynamic>?;
    final mediaList = (json['media'] as List<dynamic>? ?? [])
        .map((m) => CommentMedia.fromJson(m as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder));

    return Comment(
      id: json['id'] as String,
      postId: json['postId'] as String,
      parentId: json['parentId'] as String?,
      author: authorJson != null ? CommentAuthor.fromJson(authorJson) : null,
      text: json['text'] as String,
      status: json['status'] as String? ?? 'ACTIVE',
      replyCount: json['replyCount'] as int? ?? 0,
      boostCount: json['boostCount'] as int? ?? 0,
      isBoostedByMe: json['isBoostedByMe'] as bool? ?? false,
      isPinned: json['isPinned'] as bool? ?? false,
      media: mediaList,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String? ?? json['createdAt'] as String),
    );
  }

  Comment copyWith({int? boostCount, bool? isBoostedByMe, bool? isPinned, int? replyCount}) {
    return Comment(
      id: id,
      postId: postId,
      parentId: parentId,
      author: author,
      text: text,
      status: status,
      replyCount: replyCount ?? this.replyCount,
      boostCount: boostCount ?? this.boostCount,
      isBoostedByMe: isBoostedByMe ?? this.isBoostedByMe,
      isPinned: isPinned ?? this.isPinned,
      media: media,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}
