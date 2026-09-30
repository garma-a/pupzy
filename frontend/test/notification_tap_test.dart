import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/app_notification.dart';
import 'package:pupzy/screens/notifications_panel.dart';
import 'package:pupzy/models/post_detail.dart';
import 'package:pupzy/screens/adoption_detail_screen.dart';
import 'package:pupzy/screens/rescue_detail_screen.dart';
import 'package:pupzy/services/notification_center.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'detail_test_support.dart';
import 'safety_test_support.dart';

AppNotification _unread(String id, String title) => AppNotification(
      id: id,
      type: 'NEW_COMMENT',
      title: title,
      body: 'Someone commented.',
      relatedPostId: null,
      isRead: false,
      createdAt: DateTime.utc(2026, 9, 18, 12),
    );

AppNotification _notification({String? postId}) => AppNotification(
      id: 'n1',
      type: 'POST_REMOVED_BY_ADMIN',
      title: 'Your post was removed',
      body: 'It broke our rules.',
      relatedPostId: postId,
      isRead: false,
      createdAt: DateTime.utc(2026, 9, 18, 12),
    );

void main() {
  late FakeSafetyGraphQL graphql;
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeSafetyGraphQL();
    toasts = ToastRecorder()..install();
  });

  tearDown(() => toasts.uninstall());

  Future<void> pumpPanel(WidgetTester tester, {LangProvider? lang, NotificationCenter? center}) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(
      graphql: graphql,
      events: SafetyEvents(),
      lang: lang,
      notificationCenter: center,
      child: const NotificationsPanel(),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('tapping a notification whose post is gone explains it instead of doing nothing', (tester) async {
    graphql.notifications = [_notification(postId: 'gone-post')];
    graphql.postDetailResult = null;
    await pumpPanel(tester);

    await tester.tap(find.text('Your post was removed'));
    await tester.pumpAndSettle();

    expect(graphql.calls, contains('fetchPostDetail(gone-post)'));
    expect(toasts.messages, ["This content isn't available."]);
    expect(find.byType(RescueDetailScreen), findsNothing, reason: 'must not navigate to a post that cannot be opened');
    expect(find.text('Your post was removed'), findsOneWidget, reason: 'the panel stays open');
    expect(graphql.readNotificationIds, ['n1'], reason: 'it is still marked read');
  });

  testWidgets('a server error message is shown as-is', (tester) async {
    graphql.notifications = [_notification(postId: 'p')];
    graphql.postDetailError = 'Network exploded';
    await pumpPanel(tester);

    await tester.tap(find.text('Your post was removed'));
    await tester.pumpAndSettle();

    expect(toasts.messages, ['Network exploded']);
  });

  testWidgets('the unavailable message is Arabic when the app language is Arabic', (tester) async {
    final lang = LangProvider();
    await lang.setLang(Lang.ar);
    graphql.notifications = [_notification(postId: 'gone-post')];
    await pumpPanel(tester, lang: lang);

    await tester.tap(find.text('Your post was removed'));
    await tester.pumpAndSettle();

    expect(toasts.messages, ['هذا المحتوى غير متاح.']);
  });

  testWidgets('a notification with no related post does nothing visible (no toast, no lookup)', (tester) async {
    graphql.notifications = [_notification(postId: null)];
    await pumpPanel(tester);

    await tester.tap(find.text('Your post was removed'));
    await tester.pumpAndSettle();

    expect(toasts.messages, isEmpty);
    expect(graphql.calls.where((c) => c.startsWith('fetchPostDetail')), isEmpty);
  });

  group('mark all as read', () {
    testWidgets('the action appears only while something is unread', (tester) async {
      graphql.notifications = [_unread('a', 'First'), _unread('b', 'Second')];
      await pumpPanel(tester);

      expect(find.text('Mark all read'), findsOneWidget);

      await tester.tap(find.text('Mark all read'));
      await tester.pumpAndSettle();

      expect(graphql.markAllReadCalls, 1);
      expect(find.text('Mark all read'), findsNothing,
          reason: 'with nothing left unread the action has no purpose');
      expect(find.text('First'), findsOneWidget, reason: 'the list itself stays put');
    });

    testWidgets('a failed call puts the unread state back and says why', (tester) async {
      graphql.notifications = [_unread('a', 'First')];
      graphql.markAllReadError = 'Could not reach the server';
      await pumpPanel(tester);

      await tester.tap(find.text('Mark all read'));
      await tester.pumpAndSettle();

      expect(toasts.messages, ['Could not reach the server']);
      expect(find.text('Mark all read'), findsOneWidget,
          reason: 'the optimistic update must roll back so the user can retry');
    });

    testWidgets('an all-read inbox never offers the action', (tester) async {
      graphql.notifications = [_unread('a', 'First').copyWith(isRead: true)];
      await pumpPanel(tester);

      expect(find.text('Mark all read'), findsNothing);
      expect(graphql.markAllReadCalls, 0);
    });
  });

  group('unread badge stays in step with the inbox', () {
    testWidgets('opening the inbox corrects the badge to the server count', (tester) async {
      final center = NotificationCenter()..setUnreadCount(9);
      graphql.notifications = [_unread('a', 'First'), _unread('b', 'Second')];
      await pumpPanel(tester, center: center);

      expect(center.unreadCount, 2);
    });

    testWidgets('opening an unread notification lowers the badge at once', (tester) async {
      final center = NotificationCenter();
      graphql.notifications = [_unread('a', 'First'), _unread('b', 'Second')];
      await pumpPanel(tester, center: center);

      await tester.tap(find.text('First'));
      await tester.pumpAndSettle();

      expect(center.unreadCount, 1);
      expect(graphql.readNotificationIds, ['a']);
    });

    testWidgets('mark all read clears the badge, and a failure restores it', (tester) async {
      final center = NotificationCenter();
      graphql.notifications = [_unread('a', 'First')];
      await pumpPanel(tester, center: center);
      await tester.tap(find.text('Mark all read'));
      await tester.pumpAndSettle();
      expect(center.unreadCount, 0);

      graphql.markAllReadError = 'Could not reach the server';
      // A new one arrives; this time the server rejects "mark all read".
      graphql.notifications = [_unread('b', 'Second')];
      graphql.unreadCount = 1;
      center.pushArrived(graphql);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mark all read'));
      await tester.pumpAndSettle();
      expect(center.unreadCount, 1);
    });
  });

  testWidgets('a push arriving while the inbox is open shows up in it', (tester) async {
    final center = NotificationCenter();
    graphql.notifications = [_unread('a', 'First')];
    await pumpPanel(tester, center: center);
    expect(find.text('Someone replied'), findsNothing);

    graphql.notifications = [_unread('b', 'Someone replied'), _unread('a', 'First')];
    center.pushArrived(graphql);
    await tester.pumpAndSettle();

    expect(find.text('Someone replied'), findsOneWidget);
    expect(center.unreadCount, 2);
  });

  testWidgets('scrolling to the end loads older notifications', (tester) async {
    graphql.notifications = [for (var i = 0; i < 45; i++) _unread('n$i', 'Notification $i')];
    await pumpPanel(tester);
    expect(find.text('Notification 44'), findsNothing);

    await tester.scrollUntilVisible(find.text('Notification 44'), 400, scrollable: find.byType(Scrollable).last);
    await tester.pumpAndSettle();

    expect(find.text('Notification 44'), findsOneWidget);
    expect(graphql.calls, contains('fetchMyNotifications(30)'));
  });

  group('completion and reopening notifications open their Post', () {
    for (final (type, postType, screen) in [
      ('RESCUE_COMPLETED', 'RESCUE', RescueDetailScreen),
      ('RESCUE_REOPENED', 'RESCUE', RescueDetailScreen),
      ('POST_COMPLETED', 'ADOPTION', AdoptionDetailScreen),
      ('POST_REOPENED', 'ADOPTION', AdoptionDetailScreen),
    ]) {
      testWidgets(type, (tester) async {
        final detail = FakeDetailGraphQL()
          ..postDetailResult = post(postType, status: type.endsWith('COMPLETED') ? 'RESOLVED' : 'ACTIVE')
          ..rescue = const RescuePostExtension(species: 'DOG', conditionSummary: 'Limping', reporterRole: 'REPORTING')
          ..adoption = AdoptionPostExtension.fromJson({'petName': 'Nala', 'species': 'CAT', 'gender': 'FEMALE'})
          ..notifications = [
            AppNotification(
              id: 'n-$type',
              type: type,
              title: 'Update on a post you followed',
              body: 'Body',
              relatedPostId: 'post-$postType',
              isRead: false,
              createdAt: DateTime.utc(2026, 9, 25),
            ),
          ];
        graphql = detail;
        tester.view.physicalSize = const Size(2000, 3200);
        tester.view.devicePixelRatio = 2;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), child: const NotificationsPanel()));
        await tester.pumpAndSettle();

        await tester.tap(find.text('Update on a post you followed'));
        await tester.pumpAndSettle();

        expect(find.byType(screen), findsOneWidget);
        expect(graphql.readNotificationIds, ['n-$type']);
      });
    }

    testWidgets('a deceased rescue opened from a notification shows the deceased outcome', (tester) async {
      final detail = FakeDetailGraphQL()
        ..postDetailResult = post('RESCUE', status: 'ANIMAL_DECEASED')
        ..rescue = const RescuePostExtension(species: 'DOG', conditionSummary: 'Limping', reporterRole: 'REPORTING')
        ..notifications = [
          AppNotification(
            id: 'n1',
            type: 'RESCUE_COMPLETED',
            title: 'Rescue closed',
            body: 'The rescue was closed (animal deceased).',
            relatedPostId: 'post-RESCUE',
            isRead: false,
            createdAt: DateTime.utc(2026, 9, 25),
          ),
        ];
      graphql = detail;
      tester.view.physicalSize = const Size(2000, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), child: const NotificationsPanel()));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.flag_outlined), findsOneWidget, reason: 'completion has a neutral icon, not a success one');
      await tester.tap(find.text('Rescue closed'));
      await tester.pumpAndSettle();

      expect(find.byType(RescueDetailScreen), findsOneWidget);
      expect(find.text('This rescue was closed because the animal died.'), findsOneWidget);
      expect(find.textContaining('Rescued'), findsNothing);
    });
  });
}
