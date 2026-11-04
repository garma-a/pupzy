import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/adoption_application.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/adopt_card_button.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'detail_test_support.dart';
import 'safety_test_support.dart';

AdoptionApplication _application(String status, {String postId = 'post-1'}) => AdoptionApplication.fromJson({
      'id': 'app-$postId-$status',
      'targetPostId': postId,
      'status': status,
      'livingSituation': 'APARTMENT',
      'whyAdopt': 'why',
      'applicant': {'id': 'viewer-1', 'fullName': 'Me'},
      'createdAt': DateTime.utc(2026, 9, 1).toIso8601String(),
    });

void main() {
  late FakeDetailGraphQL graphql;
  late int openedDetails;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeDetailGraphQL();
    openedDetails = 0;
  });

  Widget button({String creatorId = 'owner-1', int applicationCheck = 0}) => safetyTestApp(
        graphql: graphql,
        events: SafetyEvents(),
        child: AdoptCardButton(
          postId: 'post-1',
          creatorId: creatorId,
          myUserId: 'viewer-1',
          applicationCheck: applicationCheck,
          onOpenDetails: () => openedDetails++,
        ),
      );

  ElevatedButton shown(WidgetTester tester) => tester.widget<ElevatedButton>(find.byType(ElevatedButton));

  testWidgets('offers to adopt when the viewer has not applied', (tester) async {
    graphql.myApplications = [_application('PENDING', postId: 'another-post')];
    await tester.pumpWidget(button());
    await tester.pumpAndSettle();

    expect(find.text('Ask to adopt'), findsOneWidget);
    expect(shown(tester).onPressed, isNotNull);
  });

  testWidgets('a pending application shows as sent, not as a new request', (tester) async {
    graphql.myApplications = [_application('PENDING')];
    await tester.pumpWidget(button());
    await tester.pumpAndSettle();

    expect(find.text('Application Sent ✓'), findsOneWidget);
    expect(find.text('Ask to adopt'), findsNothing);
    expect(shown(tester).onPressed, isNull);
  });

  testWidgets('an approved application offers WhatsApp', (tester) async {
    graphql.myApplications = [_application('APPROVED')];
    await tester.pumpWidget(button());
    await tester.pumpAndSettle();

    expect(find.text('Message Owner on WhatsApp'), findsOneWidget);
    expect(shown(tester).onPressed, isNotNull);
  });

  testWidgets('a declined application says so', (tester) async {
    graphql.myApplications = [_application('REJECTED')];
    await tester.pumpWidget(button());
    await tester.pumpAndSettle();

    expect(find.text('Application Declined'), findsOneWidget);
    expect(shown(tester).onPressed, isNull);
  });

  testWidgets('on the viewer\'s own listing it opens the listing instead', (tester) async {
    await tester.pumpWidget(button(creatorId: 'viewer-1'));
    await tester.pumpAndSettle();

    expect(find.text('View details'), findsOneWidget);
    await tester.tap(find.text('View details'));
    expect(openedDetails, 1);
  });

  testWidgets('re-checks when asked, e.g. after applying from the listing', (tester) async {
    await tester.pumpWidget(button());
    await tester.pumpAndSettle();
    expect(find.text('Ask to adopt'), findsOneWidget);

    graphql.myApplications = [_application('PENDING')];
    await tester.pumpWidget(button(applicationCheck: 1));
    await tester.pumpAndSettle();

    expect(find.text('Application Sent ✓'), findsOneWidget);
  });
}
