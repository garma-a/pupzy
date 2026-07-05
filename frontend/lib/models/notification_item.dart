enum NotificationType { like, comment, follow }

class NotificationItem {
  final String id;
  final String username;
  final String avatarUrl;
  final NotificationType type;
  final DateTime timestamp;
  final bool isRead;

  const NotificationItem({
    required this.id,
    required this.username,
    required this.avatarUrl,
    required this.type,
    required this.timestamp,
    this.isRead = false,
  });

  String get actionText {
    switch (type) {
      case NotificationType.like:
        return 'liked your post';
      case NotificationType.comment:
        return 'commented on your post';
      case NotificationType.follow:
        return 'started following you';
    }
  }
}
