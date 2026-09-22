import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/safety.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/owner_post_actions.dart';
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

  final closedWith = <String>[];
  var deleted = 0;

  Future<void> pumpBar(
    WidgetTester tester, {
    OwnerCloseAction? close = OwnerCloseAction.rescue,
    bool isClosed = false,
    LangProvider? lang,
  }) async {
    closedWith.clear();
    deleted = 0;
    await tester.pumpWidget(
      safetyTestApp(
        graphql: graphql,
        events: events,
        lang: lang,
        child: Align(
          alignment: Alignment.bottomCenter,
          child: OwnerPostActions(
            postId: 'post-7',
            close: close,
            isClosed: isClosed,
            onClosed: closedWith.add,
            onDeleted: () => deleted++,
          ),
        ),
      ),
    );
  }

  group('closing a post', () {
    for (final (name, action, expectedStatus, label) in [
      ('rescue', OwnerCloseAction.rescue, 'RESOLVED', 'Mark Resolved'),
      ('lost', OwnerCloseAction.lost, 'REUNITED', 'Mark Reunited'),
      ('adoption', OwnerCloseAction.adoption, 'ADOPTED', 'Mark Adopted'),
    ]) {
      testWidgets('$name posts move to $expectedStatus after confirmation', (tester) async {
        await pumpBar(tester, close: action);
        expect(find.text(label), findsOneWidget);

        await tester.tap(find.byKey(const Key('ownerCloseButton')));
        await tester.pumpAndSettle();
        expect(find.textContaining('cannot be undone'), findsOneWidget);
        expect(graphql.statusCalls, isEmpty, reason: 'nothing is sent before the user confirms');

        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();

        expect(graphql.statusCalls, [('post-7', expectedStatus)]);
        expect(closedWith, [expectedStatus]);
        expect(events.version, 1, reason: 'feeds must reload so the closed post leaves them');
        expect(toasts.messages, hasLength(1));
      });
    }

    testWidgets('Cancel sends nothing and changes nothing', (tester) async {
      await pumpBar(tester);
      await tester.tap(find.byKey(const Key('ownerCloseButton')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(graphql.statusCalls, isEmpty);
      expect(closedWith, isEmpty);
      expect(events.version, 0);
    });

    testWidgets('a failure keeps the post open, shows the server message, and does not refresh feeds', (tester) async {
      graphql.resultFor = (_) => const SafetyResult(ok: false, message: 'Invalid transition');
      await pumpBar(tester);
      await tester.tap(find.byKey(const Key('ownerCloseButton')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();

      expect(closedWith, isEmpty);
      expect(events.version, 0);
      expect(toasts.messages, ['Invalid transition']);
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('ownerCloseButton'))).onPressed, isNotNull, reason: 'can retry');
    });

    testWidgets('an already-closed post shows its final state and cannot be closed again', (tester) async {
      await pumpBar(tester, isClosed: true);
      expect(find.text('Resolved ✓'), findsOneWidget);
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('ownerCloseButton'))).onPressed, isNull);
    });

    testWidgets('mating posts have no terminal status, so only Delete is offered', (tester) async {
      await pumpBar(tester, close: null);
      expect(find.byKey(const Key('ownerDeleteButton')), findsOneWidget);
      expect(find.byKey(const Key('ownerCloseButton')), findsNothing);
    });
  });

  group('deleting a post', () {
    testWidgets('confirmed delete removes the post, refreshes feeds, and leaves the screen', (tester) async {
      await pumpBar(tester);
      await tester.tap(find.byKey(const Key('ownerDeleteButton')));
      await tester.pumpAndSettle();
      expect(find.text('Delete post?'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(graphql.deletedPostIds, ['post-7']);
      expect(events.version, 1);
      expect(deleted, 1);
      expect(toasts.messages, ['Post deleted']);
    });

    testWidgets('Cancel keeps the post', (tester) async {
      await pumpBar(tester);
      await tester.tap(find.byKey(const Key('ownerDeleteButton')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(graphql.deletedPostIds, isEmpty);
      expect(deleted, 0);
      expect(events.version, 0);
    });

    testWidgets('a failed delete stays on the screen with the server message', (tester) async {
      graphql.resultFor = (_) => const SafetyResult(ok: false, message: 'nope');
      await pumpBar(tester);
      await tester.tap(find.byKey(const Key('ownerDeleteButton')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(deleted, 0);
      expect(events.version, 0);
      expect(toasts.messages, ['nope']);
    });
  });

  testWidgets('renders in Arabic when the app language is Arabic', (tester) async {
    final lang = LangProvider();
    await lang.setLang(Lang.ar);
    await pumpBar(tester, close: OwnerCloseAction.adoption, lang: lang);
    expect(find.text('تحديد كمُتبنّى'), findsOneWidget);
    expect(find.text('حذف'), findsOneWidget);
    expect(find.text('Mark Adopted'), findsNothing);
  });
}
