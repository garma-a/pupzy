import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/models/terms_info.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/services/terms_gate.dart';
import 'package:pupzy/widgets/comments_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'comments_sheet_test.dart' show FakeCommentsGraphQL, FakePicker, FakeUploader;
import 'safety_test_support.dart';

const _changedCopy =
    "Pupzy's Terms were just updated. Please review the new version and accept it to continue — your draft is kept.";

void main() {
  late FakeSafetyGraphQL graphql;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeSafetyGraphQL();
  });

  /// Pumps a button that runs a protected operation through
  /// [withTermsRecovery]. The operation "fails for Terms" [rejections] times.
  Future<List<String>> pumpOperation(WidgetTester tester, {int rejections = 1}) async {
    final attempts = <String>[];
    await tester.pumpWidget(safetyTestApp(
      graphql: graphql,
      events: SafetyEvents(),
      child: Builder(
        builder: (context) => ElevatedButton(
          onPressed: () async {
            final result = await withTermsRecovery(context, () async {
              if (attempts.length < rejections) {
                attempts.add('rejected');
                graphql.termsRequirement = const TermsRequirement(version: 'v2', url: 'https://example.org/terms/v2');
                return 'failed';
              }
              attempts.add('ok');
              return 'ok';
            });
            attempts.add('result:$result');
          },
          child: const Text('Submit'),
        ),
      ),
    ));
    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();
    return attempts;
  }

  testWidgets('a Terms rejection shows the new version and retries once after acceptance', (tester) async {
    final attempts = await pumpOperation(tester);
    expect(find.text(_changedCopy), findsOneWidget);
    expect(attempts, ['rejected'], reason: 'nothing is retried before the user accepts');

    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();

    expect(graphql.acceptedVersions, ['v2'], reason: 'the version from the error, not a cached one');
    expect(attempts, ['rejected', 'ok', 'result:ok']);
  });

  testWidgets('declining keeps the failed result and does not retry', (tester) async {
    final attempts = await pumpOperation(tester);
    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();

    expect(graphql.acceptedVersions, isEmpty);
    expect(attempts, ['rejected', 'result:failed']);
  });

  testWidgets('a second rejection does not loop', (tester) async {
    final attempts = await pumpOperation(tester, rejections: 5);
    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();

    expect(find.text(_changedCopy), findsNothing, reason: 'the sheet is shown once per submission');
    expect(attempts, ['rejected', 'rejected', 'result:failed']);
  });

  testWidgets('a newer version published while the sheet is open is shown, never auto-accepted', (tester) async {
    graphql.staleTermsVersions['v2'] = 'v3';
    final attempts = await pumpOperation(tester);

    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();
    expect(graphql.acceptedVersions, ['v2']);
    expect(find.text(_changedCopy), findsOneWidget, reason: 'still open, now showing v3');
    expect(attempts, ['rejected'], reason: 'nothing retried until v3 is accepted');

    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();
    expect(graphql.acceptedVersions, ['v2', 'v3']);
    expect(attempts, ['rejected', 'ok', 'result:ok']);
  });

  testWidgets('a Comment rejected for Terms keeps its draft and posts once after acceptance', (tester) async {
    final comments = FakeCommentsGraphQL()..createScript.add('code:TERMS_ACCEPTANCE_REQUIRED');
    ImagePickerPlatform.instance = FakePicker();
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(
      graphql: comments,
      events: SafetyEvents(),
      child: CommentsSheet(postId: 'post-1', allowImages: false, imageUploader: FakeUploader()),
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Add a comment...'), 'after new terms');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.send).last);
    // Send's spinner keeps turning behind the Terms sheet, so wait a fixed
    // time rather than for everything to settle.
    await tester.pump(const Duration(seconds: 1)); // the sheet starts opening
    await tester.pump(const Duration(seconds: 1)); // …and is fully open

    expect(find.text(_changedCopy), findsOneWidget);
    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();

    expect(comments.acceptedVersions, ['v2']);
    expect(comments.createIds, hasLength(2));
    expect(comments.createIds.toSet(), hasLength(1), reason: 'the retry is the same submission');
    expect(comments.server, hasLength(1));
    expect(find.text('text of new-0'), findsOneWidget);
  });
}
