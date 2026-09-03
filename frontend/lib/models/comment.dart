/// The author of a comment as returned by GraphQL discussion queries.
class CommentAuthor {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;
  final bool isVerified;

  const CommentAuthor({
    required this.id,
    this.fullName,
    this.fullNameArabic,
    this.profilePictureUrl,
    required this.isVerified,
  });

  factory CommentAuthor.fromJson(Map<String, dynamic> json) => CommentAuthor(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        fullNameArabic: json['fullNameArabic'] as String?,
        profilePictureUrl: json['profilePictureUrl'] as String?,
        isVerified: json['isVerified'] as bool? ?? false,
      );

  String displayName(String languageCode) {
    if (languageCode == 'ar' && fullNameArabic != null && fullNameArabic!.isNotEmpty) {
      return fullNameArabic!;
    }
    return fullName ?? 'User';
  }
}

/// A discussion Comment or Reply on a Post.
class Comment {
  final String id;
  final String postId;
  final String? parentId;
  final CommentAuthor? author;
  final String text;
  final String status;
  final int replyCount;
  final int boostCount;
  final bool isBoostedByMe;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Comment({
    required this.id,
    required this.postId,
    this.parentId,
    this.author,
    required this.text,
    required this.status,
    this.replyCount = 0,
    this.boostCount = 0,
    this.isBoostedByMe = false,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isDeleted => status == 'DELETED';
  bool get isReply => parentId != null;

  factory Comment.fromJson(Map<String, dynamic> json) => Comment(
        id: json['id'] as String,
        postId: json['postId'] as String,
        parentId: json['parentId'] as String?,
        author: json['author'] != null
            ? CommentAuthor.fromJson(json['author'] as Map<String, dynamic>)
            : null,
        text: json['text'] as String,
        status: json['status'] as String? ?? 'ACTIVE',
        replyCount: json['replyCount'] as int? ?? 0,
        boostCount: json['boostCount'] as int? ?? 0,
        isBoostedByMe: json['isBoostedByMe'] as bool? ?? false,
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );

  Comment copyWith({
    String? id,
    String? postId,
    String? parentId,
    CommentAuthor? author,
    String? text,
    String? status,
    int? replyCount,
    int? boostCount,
    bool? isBoostedByMe,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Comment(
      id: id ?? this.id,
      postId: postId ?? this.postId,
      parentId: parentId ?? this.parentId,
      author: author ?? this.author,
      text: text ?? this.text,
      status: status ?? this.status,
      replyCount: replyCount ?? this.replyCount,
      boostCount: boostCount ?? this.boostCount,
      isBoostedByMe: isBoostedByMe ?? this.isBoostedByMe,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

/// Keyset-paginated comments connection.
class CommentConnection {
  final List<Comment> comments;
  final String? endCursor;
  final bool hasNextPage;

  const CommentConnection({
    required this.comments,
    this.endCursor,
    required this.hasNextPage,
  });
}
