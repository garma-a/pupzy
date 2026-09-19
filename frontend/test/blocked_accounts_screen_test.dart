import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/blocked_user.dart';
import 'package:pupzy/models/safety.dart';
import 'package:pupzy/screens/blocked_accounts_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

void main() {
  late FakeSafetyGraphQL graphql;
  late SafetyEvents events;
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeSafetyGraphQL();
    events = SafetyEvents();
    toasts = ToastRecorder()..install();
  });

  tearDown(() => toasts.uninstall());

  void useTallSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpScreen(WidgetTester tester, {LangProvider? lang}) async {
    await tester.pumpWidget(safetyTestApp(graphql: graphql, events: events, lang: lang, child: const BlockedAccountsScreen()));
    await tester.pumpAndSettle();
  }

  group('BlockedUser model', () {
    test('parses a BlockedUserEdge', () {
      final user = BlockedUser.fromEdge({
        'node': {'id': 'u1', 'fullName': 'Mona', 'fullNameArabic': 'منى', 'profilePictureUrl': 'https://x/y.png', 'isVerified': true},
        'blockedAt': '2026-09-18T12:00:00.000Z',
        'cursor': 'abc',
      });
      expect(user.id, 'u1');
      expect(user.isVerified, isTrue);
      expect(user.profilePictureUrl, 'https://x/y.png');
      expect(user.blockedAt, DateTime.utc(2026, 9, 18, 12));
    });

    test('tolerates a profile that was never completed (null names, no photo)', () {
      final user = BlockedUser.fromEdge({
        'node': {'id': 'u2', 'fullName': null, 'fullNameArabic': null, 'profilePictureUrl': null, 'isVerified': false},
        'blockedAt': '2026-09-18T12:00:00.000Z',
        'cursor': 'abc',
      });
      expect(user.displayName(arabic: false), isNull);
      expect(user.displayName(arabic: true), isNull);
    });

    test('display name prefers the active language and falls back to the other', () {
      final both = blockedUser('a', name: 'Mona', arabic: 'منى');
      expect(both.displayName(arabic: false), 'Mona');
      expect(both.displayName(arabic: true), 'منى');
      expect(blockedUser('b', name: 'Only English').displayName(arabic: true), 'Only English');
      expect(blockedUser('c', arabic: 'عربي فقط').displayName(arabic: false), 'عربي فقط');
      expect(blockedUser('d', name: '   ').displayName(arabic: false), isNull, reason: 'blank names are treated as absent');
    });
  });

  group('Blocked Accounts screen', () {
    testWidgets('shows the empty state', (tester) async {
      useTallSurface(tester);
      await pumpScreen(tester);
      expect(find.text("You haven't blocked anyone."), findsOneWidget);
    });

    testWidgets('lists blocked accounts with name, badge, date and Unblock', (tester) async {
      useTallSurface(tester);
      graphql.blockedPages = (_) => [blockedUser('u1', name: 'Mona', arabic: 'منى', verified: true), blockedUser('u2')];
      await pumpScreen(tester);

      expect(find.text('Mona'), findsOneWidget);
      expect(find.byIcon(Icons.verified), findsOneWidget, reason: 'only the verified account gets the badge');
      expect(find.text('Pupzy user'), findsOneWidget, reason: 'anonymous placeholder for a null name');
      expect(find.textContaining('Blocked on'), findsNWidgets(2));
      expect(find.byKey(const Key('unblock_u1')), findsOneWidget);
      expect(find.byKey(const Key('unblock_u2')), findsOneWidget);
      expect(find.textContaining('blocked you'), findsNothing, reason: 'never reveal block direction');
    });

    testWidgets('renders Arabic names and copy when the app language is Arabic', (tester) async {
      useTallSurface(tester);
      final lang = LangProvider();
      await lang.setLang(Lang.ar);
      graphql.blockedPages = (_) => [blockedUser('u1', name: 'Mona', arabic: 'منى')];
      await pumpScreen(tester, lang: lang);

      expect(find.text('منى'), findsOneWidget);
      expect(find.text('Mona'), findsNothing);
      expect(find.text('الحسابات المحظورة'), findsOneWidget);
      expect(find.text('إلغاء الحظر'), findsOneWidget);
      expect(find.textContaining('تم الحظر في'), findsOneWidget);
    });

    testWidgets('Unblock asks for confirmation; Cancel keeps the row', (tester) async {
      useTallSurface(tester);
      graphql.blockedPages = (_) => [blockedUser('u1', name: 'Mona')];
      await pumpScreen(tester);

      await tester.tap(find.byKey(const Key('unblock_u1')));
      await tester.pumpAndSettle();
      expect(find.textContaining('may appear in your feed again'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(graphql.unblockedIds, isEmpty);
      expect(find.text('Mona'), findsOneWidget);
      expect(events.version, 0);
    });

    testWidgets('confirmed Unblock removes the row and tells feeds to reload', (tester) async {
      useTallSurface(tester);
      graphql.blockedPages = (_) => [blockedUser('u1', name: 'Mona'), blockedUser('u2', name: 'Sara')];
      await pumpScreen(tester);

      await tester.tap(find.byKey(const Key('unblock_u1')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Unblock'));
      await tester.pumpAndSettle();

      expect(graphql.unblockedIds, ['u1']);
      expect(find.text('Mona'), findsNothing);
      expect(find.text('Sara'), findsOneWidget);
      expect(events.version, 1);
      expect(toasts.messages, ['Account unblocked.']);
    });

    testWidgets('a failed Unblock keeps the row and does not bump feeds', (tester) async {
      useTallSurface(tester);
      graphql.blockedPages = (_) => [blockedUser('u1', name: 'Mona')];
      graphql.resultFor = (_) => const SafetyResult(ok: false, message: 'server said no');
      await pumpScreen(tester);

      await tester.tap(find.byKey(const Key('unblock_u1')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Unblock'));
      await tester.pumpAndSettle();

      expect(find.text('Mona'), findsOneWidget);
      expect(events.version, 0);
      expect(toasts.messages, ['server said no']);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('unblock_u1'))).onPressed, isNotNull, reason: 'can retry');
    });

    testWidgets('a first page that fits on screen still loads the next page (no scroll needed)', (tester) async {
      useTallSurface(tester);
      final firstPage = [for (var i = 0; i < 5; i++) blockedUser('u$i', name: 'Person $i')];
      final secondPage = [for (var i = 5; i < 8; i++) blockedUser('u$i', name: 'Person $i')];
      graphql.blockedPages = (after) => after == null ? firstPage : secondPage;
      graphql.hasNext = (after) => after == null;
      await pumpScreen(tester);

      expect(graphql.calls, ['fetchBlockedUsers(after: null)', 'fetchBlockedUsers(after: cursor-u4)']);
      expect(find.text('Person 7'), findsOneWidget);
    });

    testWidgets('on a small screen the next page loads only when the end is reached, using the last endCursor', (tester) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final firstPage = [for (var i = 0; i < 20; i++) blockedUser('u$i', name: 'Person $i')];
      final secondPage = [for (var i = 20; i < 23; i++) blockedUser('u$i', name: 'Person $i')];
      graphql.blockedPages = (after) => after == null ? firstPage : secondPage;
      graphql.hasNext = (after) => after == null;

      await tester.pumpWidget(safetyTestApp(graphql: graphql, events: events, child: const BlockedAccountsScreen()));
      await tester.pump();
      await tester.pump();

      expect(graphql.calls, ['fetchBlockedUsers(after: null)'], reason: 'the end of the list is far off-screen');
      for (var i = 0; i < 8 && graphql.calls.length < 2; i++) {
        await tester.drag(find.byType(ListView), const Offset(0, -1500));
        await tester.pump();
        await tester.pump();
      }

      expect(graphql.calls, ['fetchBlockedUsers(after: null)', 'fetchBlockedUsers(after: cursor-u19)']);
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView), const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(find.text('Person 22'), findsOneWidget);
      expect(graphql.calls.length, 2, reason: 'no third request once hasNextPage is false');
    });
  });
}
