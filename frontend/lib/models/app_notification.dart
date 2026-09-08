/// A real in-app notification from the backend notifications inbox.
/// Named `AppNotification` for clarity against the `Notification` GraphQL
/// type name it wraps.
class AppNotification {
  final String id;
  final String type; // NEW_UPVOTE, POST_SAVED, CONTACT_REQUEST_RECEIVED, etc.
  final String title;
  final String body;
  final String? relatedPostId;
  final bool isRead;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    this.relatedPostId,
    required this.isRead,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        type: json['type'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        relatedPostId: json['relatedPostId'] as String?,
        isRead: json['isRead'] as bool? ?? false,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        type: type,
        title: title,
        body: body,
        relatedPostId: relatedPostId,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
      );
}
