import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/safety.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/report_sheet.dart';
import 'package:pupzy/widgets/safety_actions.dart';
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

  bool? sheetResult;

  Future<void> openSheet(
    WidgetTester tester, {
    required bool detailsRequiredForOther,
    List<ReportReasonOption> reasons = contentReportReasons,
  }) async {
    sheetResult = null;
    await tester.pumpWidget(
      safetyTestApp(
        graphql: graphql,
        events: events,
        child: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              sheetResult = await showReportSheet(
                context,
                title: 'Report Post',
                reasons: reasons,
                detailsRequiredForOther: detailsRequiredForOther,
                onSubmit: (reason, details) => graphql.reportPost(postId: 'p1', reason: reason, details: details),
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  bool submitEnabled(WidgetTester tester) => tester.widget<ElevatedButton>(find.byKey(const Key('reportSubmitButton'))).onPressed != null;

  Future<void> tapSubmit(WidgetTester tester) async {
    await tester.ensureVisible(find.byKey(const Key('reportSubmitButton')));
    await tester.tap(find.byKey(const Key('reportSubmitButton')));
    await tester.pumpAndSettle();
  }

  group('report sheet', () {
    testWidgets('submit stays disabled until a reason is chosen', (tester) async {
      useTallSurface(tester);
      await openSheet(tester, detailsRequiredForOther: true);
      expect(submitEnabled(tester), isFalse);

      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      expect(submitEnabled(tester), isTrue);
    });

    testWidgets('"Other" requires details on post/account reports, and sends them trimmed', (tester) async {
      useTallSurface(tester);
      await openSheet(tester, detailsRequiredForOther: true);

      await tester.tap(find.byKey(const Key('reportReason_OTHER')));
      await tester.pump();
      expect(submitEnabled(tester), isFalse, reason: 'OTHER without details must not be submittable');

      await tester.enterText(find.byKey(const Key('reportDetailsField')), '   ');
      await tester.pump();
      expect(submitEnabled(tester), isFalse, reason: 'whitespace-only details count as blank');

      await tester.enterText(find.byKey(const Key('reportDetailsField')), '  Fake listing, photos are stolen  ');
      await tester.pump();
      expect(submitEnabled(tester), isTrue);

      await tapSubmit(tester);
      expect(graphql.lastReportPost, {'postId': 'p1', 'reason': 'OTHER', 'details': 'Fake listing, photos are stolen'});
      expect(sheetResult, isTrue);
    });

    testWidgets('"Other" does NOT require details for comment reports (existing contract)', (tester) async {
      useTallSurface(tester);
      await openSheet(tester, detailsRequiredForOther: false);

      await tester.tap(find.byKey(const Key('reportReason_OTHER')));
      await tester.pump();
      expect(submitEnabled(tester), isTrue);
    });

    testWidgets('blank details are sent as null, not an empty string', (tester) async {
      useTallSurface(tester);
      await openSheet(tester, detailsRequiredForOther: true);
      await tester.tap(find.byKey(const Key('reportReason_SCAM')));
      await tester.pump();
      await tapSubmit(tester);
      expect(graphql.lastReportPost['details'], isNull);
      expect(graphql.lastReportPost['reason'], 'SCAM');
    });

    testWidgets('details field enforces the backend 500-character cap', (tester) async {
      useTallSurface(tester);
      await openSheet(tester, detailsRequiredForOther: true);
      final field = tester.widget<TextField>(find.byKey(const Key('reportDetailsField')));
      expect(field.maxLength, kReportDetailsMaxLength);
      expect(kReportDetailsMaxLength, 500);
    });

    testWidgets('already-reported closes the sheet with an "already reported" message', (tester) async {
      useTallSurface(tester);
      graphql.resultFor = (_) => const SafetyResult(ok: false, code: 'POST_ALREADY_REPORTED', message: 'raw backend text');
      await openSheet(tester, detailsRequiredForOther: true);
      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      await tapSubmit(tester);

      expect(sheetResult, isFalse);
      expect(toasts.messages, ["You've already reported this."]);
      expect(find.byKey(const Key('reportSubmitButton')), findsNothing, reason: 'sheet should be closed');
    });

    testWidgets('daily limit closes the sheet with the 10-per-day message', (tester) async {
      useTallSurface(tester);
      graphql.resultFor = (_) => const SafetyResult(ok: false, code: 'RATE_LIMITED', message: 'Daily report limit reached (10 per day)');
      await openSheet(tester, detailsRequiredForOther: true);
      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      await tapSubmit(tester);

      expect(sheetResult, isFalse);
      expect(toasts.messages, ["You've reached the daily limit of 10 reports. Try again later."]);
    });

    testWidgets('an unexpected failure keeps the sheet open and shows the server message', (tester) async {
      useTallSurface(tester);
      graphql.resultFor = (_) => const SafetyResult(ok: false, code: 'VALIDATION_ERROR', message: 'details too long');
      await openSheet(tester, detailsRequiredForOther: true);
      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      await tapSubmit(tester);

      expect(toasts.messages, ['details too long']);
      expect(find.byKey(const Key('reportSubmitButton')), findsOneWidget, reason: 'user can fix and retry');
      expect(submitEnabled(tester), isTrue);
    });
  });

  group('post safety menu journey', () {
    var blockedCallbacks = 0;

    Future<void> pumpMenu(WidgetTester tester, {LangProvider? lang}) async {
      blockedCallbacks = 0;
      await tester.pumpWidget(
        safetyTestApp(
          graphql: graphql,
          events: events,
          lang: lang,
          child: Center(
            child: PostSafetyMenu(postId: 'post-1', creatorId: 'creator-9', overlay: false, onBlocked: () => blockedCallbacks++),
          ),
        ),
      );
    }

    Future<void> openMenu(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('safetyMenuButton')));
      await tester.pumpAndSettle();
    }

    testWidgets('offers Report Post, Report Account and Block Account', (tester) async {
      useTallSurface(tester);
      await pumpMenu(tester);
      await openMenu(tester);
      expect(find.text('Report Post'), findsOneWidget);
      expect(find.text('Report Account'), findsOneWidget);
      expect(find.text('Block Account'), findsOneWidget);
    });

    testWidgets('report post → optional block: "Block" blocks the creator, bumps feeds, and fires onBlocked', (tester) async {
      useTallSurface(tester);
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Report Post'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      await tapSubmit(tester);

      expect(graphql.calls, ['reportPost'], reason: 'reporting alone must never block');
      expect(events.version, 0);
      expect(find.text('Block this account too?'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Block'));
      await tester.pumpAndSettle();

      expect(graphql.blockedIds, ['creator-9']);
      expect(events.version, 1, reason: 'feeds must be told to reload');
      expect(blockedCallbacks, 1);
      expect(toasts.messages, ["Thanks for reporting. We'll review it.", 'Account blocked.']);
    });

    testWidgets('report post → "Not now" leaves the relationship untouched', (tester) async {
      useTallSurface(tester);
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Report Post'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      await tapSubmit(tester);

      await tester.tap(find.text('Not now'));
      await tester.pumpAndSettle();

      expect(graphql.blockedIds, isEmpty);
      expect(events.version, 0);
      expect(blockedCallbacks, 0);
    });

    testWidgets('a failed report does not offer to block', (tester) async {
      useTallSurface(tester);
      graphql.resultFor = (op) => op == 'reportPost' ? const SafetyResult(ok: false, code: 'NOT_FOUND', message: 'gone') : SafetyResult.success;
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Report Post'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('reportReason_SPAM')));
      await tester.pump();
      await tapSubmit(tester);

      expect(find.text('Block this account too?'), findsNothing);
      expect(graphql.blockedIds, isEmpty);
    });

    testWidgets('Report Account attaches the post as evidence and uses account reasons', (tester) async {
      useTallSurface(tester);
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Report Account'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('reportReason_HARASSMENT')), findsOneWidget);
      expect(find.byKey(const Key('reportReason_DUPLICATE')), findsNothing, reason: 'content-only reasons are not offered for accounts');

      await tester.tap(find.byKey(const Key('reportReason_HARASSMENT')));
      await tester.pump();
      await tapSubmit(tester);

      expect(graphql.lastReportUser, {
        'userId': 'creator-9',
        'reason': 'HARASSMENT',
        'details': null,
        'sourceType': 'POST',
        'sourceId': 'post-1',
      });
    });

    testWidgets('Block Account asks for confirmation first; Cancel does nothing', (tester) async {
      useTallSurface(tester);
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Block Account'));
      await tester.pumpAndSettle();

      expect(find.textContaining("You won't see each other's content"), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(graphql.blockedIds, isEmpty);
      expect(blockedCallbacks, 0);
    });

    testWidgets('Block Account → Block commits, bumps feeds, fires onBlocked', (tester) async {
      useTallSurface(tester);
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Block Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Block'));
      await tester.pumpAndSettle();

      expect(graphql.blockedIds, ['creator-9']);
      expect(events.version, 1);
      expect(blockedCallbacks, 1);
    });

    testWidgets('a failed block does not bump feeds or fire onBlocked', (tester) async {
      useTallSurface(tester);
      graphql.resultFor = (op) => op == 'blockUser' ? const SafetyResult(ok: false, message: 'boom') : SafetyResult.success;
      await pumpMenu(tester);
      await openMenu(tester);
      await tester.tap(find.text('Block Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Block'));
      await tester.pumpAndSettle();

      expect(events.version, 0);
      expect(blockedCallbacks, 0);
      expect(toasts.messages, ['boom']);
    });

    testWidgets('renders in Arabic when the app language is Arabic', (tester) async {
      useTallSurface(tester);
      final lang = LangProvider();
      await lang.setLang(Lang.ar);
      await pumpMenu(tester, lang: lang);
      await openMenu(tester);

      expect(find.text('الإبلاغ عن المنشور'), findsOneWidget);
      expect(find.text('الإبلاغ عن الحساب'), findsOneWidget);
      expect(find.text('حظر الحساب'), findsOneWidget);
      expect(find.text('Report Post'), findsNothing);

      await tester.tap(find.text('الإبلاغ عن المنشور'));
      await tester.pumpAndSettle();
      expect(find.text('غير متعلق بالحيوانات'), findsOneWidget);
      expect(find.text('محتوى مزعج'), findsOneWidget);
    });
  });

  group('comment report flow', () {
    testWidgets('a comment report with a known author offers the block follow-up; a deleted author does not', (tester) async {
      useTallSurface(tester);

      Future<void> run(String? authorId) async {
        graphql.calls.clear();
        await tester.pumpWidget(
          safetyTestApp(
            graphql: graphql,
            events: events,
            child: Builder(
              builder: (context) => TextButton(
                onPressed: () => reportCommentFlow(context, commentId: 'c1', authorId: authorId),
                child: const Text('go'),
              ),
            ),
          ),
        );
        await tester.tap(find.text('go'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('reportReason_OTHER')));
        await tester.pump();
        await tapSubmit(tester); // OTHER without details is allowed for comments
      }

      await run('author-3');
      expect(graphql.lastReportComment, {'commentId': 'c1', 'reason': 'OTHER', 'details': null});
      expect(find.text('Block this account too?'), findsOneWidget);
      await tester.tap(find.text('Not now'));
      await tester.pumpAndSettle();

      await run(null);
      expect(find.text('Block this account too?'), findsNothing);
    });
  });
}
