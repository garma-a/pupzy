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

/// A discussion Comment on a Post.
class Comment {
  final String id;
  final String postId;
  final CommentAuthor author;
  final String text;
  final String status;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Comment({
    required this.id,
    required this.postId,
    required this.author,
    required this.text,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Comment.fromJson(Map<String, dynamic> json) => Comment(
        id: json['id'] as String,
        postId: json['postId'] as String,
        author: CommentAuthor.fromJson(json['author'] as Map<String, dynamic>),
        text: json['text'] as String,
        status: json['status'] as String? ?? 'ACTIVE',
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );
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
