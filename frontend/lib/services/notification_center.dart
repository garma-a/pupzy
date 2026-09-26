import 'dart:async';

import 'package:flutter/foundation.dart';

import 'graphql_service.dart';

/// App-wide notification state shared by the bell badge, the inbox and the
/// push service, so every one of them stays in step: a push arriving, an
/// inbox item being opened, or "Mark all read" updates the badge everywhere
/// at once instead of only after the inbox closes.
class NotificationCenter extends ChangeNotifier {
  int _unreadCount = 0;
  final _arrivals = StreamController<void>.broadcast();

  int get unreadCount => _unreadCount;

  /// Fires when a push arrives while the app is open, so an inbox that is on
  /// screen can pull the new item in.
  Stream<void> get arrivals => _arrivals.stream;

  /// Re-reads the unread count from the server. Keeps the last known count
  /// when the request fails rather than flashing the badge off.
  Future<void> refresh(GraphQLService graphql) async {
    final (count, _) = await graphql.fetchMyUnreadNotificationCount();
    if (count != null) setUnreadCount(count);
  }

  void setUnreadCount(int count) {
    final next = count < 0 ? 0 : count;
    if (next == _unreadCount) return;
    _unreadCount = next;
    notifyListeners();
  }

  /// One notification was opened (and marked read).
  void markedOneRead() => setUnreadCount(_unreadCount - 1);

  /// A push arrived while the app was open.
  void pushArrived(GraphQLService graphql) {
    if (!_arrivals.isClosed) _arrivals.add(null);
    refresh(graphql);
  }

  /// Signed out — the next account starts from its own count.
  void clear() => setUnreadCount(0);

  @override
  void dispose() {
    _arrivals.close();
    super.dispose();
  }
}
