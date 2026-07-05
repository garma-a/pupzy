enum PostType { general, adoption, rescue, product }

class Comment {
  final String id;
  final String username;
  final String avatarUrl;
  final String text;
  final DateTime timestamp;

  const Comment({
    required this.id,
    required this.username,
    required this.avatarUrl,
    required this.text,
    required this.timestamp,
  });
}

class Post {
  final String id;
  final String username;
  final String avatarUrl;
  final List<String> imageUrls;
  final String caption;
  final DateTime timestamp;
  final PostType type;
  int likeCount;
  int commentCount;
  int shareCount;
  bool isLiked;
  bool isBookmarked;
  final List<Comment> comments;

  Post({
    required this.id,
    required this.username,
    required this.avatarUrl,
    required this.imageUrls,
    required this.caption,
    required this.timestamp,
    this.type = PostType.general,
    this.likeCount = 0,
    this.commentCount = 0,
    this.shareCount = 0,
    this.isLiked = false,
    this.isBookmarked = false,
    this.comments = const [],
  });
}
