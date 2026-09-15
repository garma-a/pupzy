/// A real in-app notification from the backend notifications inbox.
/// Named `AppNotification` for clarity against the `Notification` GraphQL
/// type name it wraps.
class AppNotification {
  final String id;
  final String type; // NEW_UPVOTE, POST_SAVED, CONTACT_REQUEST_RECEIVED, NEW_COMMENT, NEW_REPLY, COMMENT_BOOSTED, COMMENT_PINNED, etc.
  final String title;
  final String body;
  final String? relatedPostId;
  final String? relatedCommentId;
  final bool isRead;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    this.relatedPostId,
    this.relatedCommentId,
    required this.isRead,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        type: json['type'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        relatedPostId: json['relatedPostId'] as String?,
        relatedCommentId: json['relatedCommentId'] as String?,
        isRead: json['isRead'] as bool? ?? false,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        type: type,
        title: title,
        body: body,
        relatedPostId: relatedPostId,
        relatedCommentId: relatedCommentId,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
      );
}
