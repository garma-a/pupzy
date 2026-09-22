import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/app_notification.dart';
import 'package:pupzy/screens/notifications_panel.dart';
import 'package:pupzy/screens/rescue_detail_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

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

  Future<void> pumpPanel(WidgetTester tester, {LangProvider? lang}) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), lang: lang, child: const NotificationsPanel()));
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
}
