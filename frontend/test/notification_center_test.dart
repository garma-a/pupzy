import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/services/notification_center.dart';

import 'safety_test_support.dart';

class _FailingCountGraphQL extends FakeSafetyGraphQL {
  @override
  Future<(int? count, String? errorMessage)> fetchMyUnreadNotificationCount() async => (null, 'offline');
}

void main() {
  test('refresh takes the server count', () async {
    final center = NotificationCenter();
    await center.refresh(FakeSafetyGraphQL()..unreadCount = 4);
    expect(center.unreadCount, 4);
  });

  test('a failed refresh keeps the last known count instead of hiding the badge', () async {
    final center = NotificationCenter()..setUnreadCount(3);
    await center.refresh(_FailingCountGraphQL());
    expect(center.unreadCount, 3);
  });

  test('opening one notification lowers the count, never below zero', () {
    final center = NotificationCenter()..setUnreadCount(1);
    center.markedOneRead();
    center.markedOneRead();
    expect(center.unreadCount, 0);
  });

  test('listeners hear about changes only when the count actually changes', () {
    final center = NotificationCenter();
    var notified = 0;
    center.addListener(() => notified++);
    center.setUnreadCount(2);
    center.setUnreadCount(2);
    center.clear();
    expect(notified, 2);
  });

  test('a push arriving announces itself and refreshes the count', () async {
    final center = NotificationCenter();
    final arrivals = <void>[];
    center.arrivals.listen(arrivals.add);
    center.pushArrived(FakeSafetyGraphQL()..unreadCount = 7);
    await pumpEventQueue();
    expect(arrivals, hasLength(1));
    expect(center.unreadCount, 7);
  });
}
