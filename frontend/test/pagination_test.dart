import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/adoption_application.dart';
import 'package:pupzy/models/contact_request.dart';
import 'package:pupzy/models/post_detail.dart';
import 'package:pupzy/screens/adoption_detail_screen.dart';
import 'package:pupzy/screens/contact_requests_screen.dart';
import 'package:pupzy/screens/my_adoption_applications_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/adoption_applications_owner_section.dart';
import 'package:pupzy/widgets/contact_requests_owner_section.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'detail_test_support.dart';
import 'safety_test_support.dart';

ContactRequest request(int i, {String status = 'PENDING'}) => ContactRequest.fromJson({
      'id': 'req-$i',
      'postId': 'post-ADOPTION',
      'message': 'request $i',
      'status': status,
      'requester': {'id': 'user-$i', 'fullName': 'Person $i'},
      'createdAt': DateTime.utc(2026, 9, 1).add(Duration(minutes: 1000 - i)).toIso8601String(),
    });

AdoptionApplication application(int i, {String status = 'PENDING', String postId = 'post-other'}) =>
    AdoptionApplication.fromJson({
      'id': 'app-$i',
      'targetPostId': postId,
      'status': status,
      'livingSituation': 'APARTMENT',
      'whyAdopt': 'why $i',
      'applicant': {'id': 'applicant-$i', 'fullName': 'Applicant $i'},
      'createdAt': DateTime.utc(2026, 9, 1).add(Duration(minutes: 1000 - i)).toIso8601String(),
    });

void main() {
  late FakeDetailGraphQL graphql;
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeDetailGraphQL();
    toasts = ToastRecorder()..install();
  });
  tearDown(() => toasts.uninstall());

  /// Phone-sized, so a full-screen list's footer starts off-screen.
  Future<void> pump(WidgetTester tester, Widget child) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), child: child));
    await tester.pumpAndSettle();
  }

  Future<void> scrollToEnd(WidgetTester tester) async {
    for (var i = 0; i < 30; i++) {
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -1500));
      await tester.pumpAndSettle();
    }
  }

  group('My contact requests', () {
    testWidgets('the 51st request is reachable, without duplicates', (tester) async {
      graphql.myContactRequests = [for (var i = 0; i < 55; i++) request(i)];
      await pump(tester, const ContactRequestsScreen());
      expect(find.text('20+ awaiting response'), findsOneWidget);

      await scrollToEnd(tester);

      expect(find.text('"request 50"'), findsOneWidget);
      expect(find.text('"request 54"'), findsOneWidget);
      expect(find.text('55 awaiting response'), findsOneWidget, reason: 'every page loaded, none twice');
      expect(find.text("That's everything"), findsOneWidget);
    });

    testWidgets('a failed page offers Retry and then continues', (tester) async {
      graphql.myContactRequests = [for (var i = 0; i < 30; i++) request(i)];
      graphql.failNextLoadMore = true;
      await pump(tester, const ContactRequestsScreen());
      await scrollToEnd(tester);

      expect(find.text("Couldn't load more."), findsOneWidget);
      expect(find.text('"request 29"'), findsNothing);

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      await scrollToEnd(tester);

      expect(find.text('"request 29"'), findsOneWidget);
      expect(find.text("Couldn't load more."), findsNothing);
    });
  });

  testWidgets('My applications: the 51st application is reachable', (tester) async {
    graphql.myApplications = [for (var i = 0; i < 52; i++) application(i)];
    await pump(tester, const MyAdoptionApplicationsScreen());
    await scrollToEnd(tester);
    expect(find.textContaining('why 51'), findsOneWidget);
  });

  group('owner pending sections', () {
    Widget scrollable(Widget section) => SingleChildScrollView(child: section);

    testWidgets('contact requests: the 21st is reachable with Show more', (tester) async {
      graphql.postRequests = [for (var i = 0; i < 25; i++) request(i)];
      await pump(tester, scrollable(const ContactRequestsOwnerSection(postId: 'post-ADOPTION')));
      expect(find.text('Interested people (20+)'), findsOneWidget);
      expect(find.text('Person 20'), findsNothing);

      await tester.ensureVisible(find.text('Show more'));
      await tester.tap(find.text('Show more'));
      await tester.pumpAndSettle();

      expect(find.text('Person 20'), findsOneWidget);
      expect(find.text('Interested people (25)'), findsOneWidget);
      expect(find.text('Show more'), findsNothing);
    });

    testWidgets('answering every loaded request brings in the next page', (tester) async {
      graphql.postRequests = [for (var i = 0; i < 22; i++) request(i)];
      await pump(tester, scrollable(const ContactRequestsOwnerSection(postId: 'post-ADOPTION')));

      for (var i = 0; i < 20; i++) {
        final approve = find.text('Accept').first;
        await tester.ensureVisible(approve);
        await tester.tap(approve);
        await tester.pumpAndSettle();
      }

      expect(find.text('Person 20'), findsOneWidget, reason: 'the section did not disappear');
      expect(find.text('Person 21'), findsOneWidget);
    });

    testWidgets('adoption applications: the 21st is reachable with Show more', (tester) async {
      graphql.postApplications = [for (var i = 0; i < 21; i++) application(i, postId: 'post-ADOPTION')];
      await pump(tester, scrollable(const AdoptionApplicationsOwnerSection(postId: 'post-ADOPTION')));
      expect(find.text('Adoption applications (20+)'), findsOneWidget);

      await tester.ensureVisible(find.text('Show more'));
      await tester.tap(find.text('Show more'));
      await tester.pumpAndSettle();

      expect(find.text('Adoption applications (21)'), findsOneWidget);
    });
  });

  group('adoption detail', () {
    Future<void> pumpDetail(WidgetTester tester) async {
      tester.view.physicalSize = const Size(2000, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      graphql
        ..meId = 'viewer-1'
        ..postDetailResult = post('ADOPTION')
        ..adoption = AdoptionPostExtension.fromJson({'petName': 'Nala', 'species': 'CAT', 'gender': 'FEMALE'});
      await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), child: const AdoptionDetailScreen(postId: 'post-ADOPTION')));
      await tester.pumpAndSettle();
    }

    testWidgets('an older approved application still offers WhatsApp, not a new application', (tester) async {
      graphql.myApplications = [
        for (var i = 0; i < 120; i++) application(i),
        application(999, status: 'APPROVED', postId: 'post-ADOPTION'),
      ];
      await pumpDetail(tester);

      expect(find.text('Message Owner on WhatsApp'), findsOneWidget);
      expect(find.text('Ask to adopt'), findsNothing);
      expect(graphql.myApplicationCursors.length, greaterThan(2), reason: 'searched past the first page');
    });

    testWidgets('with no application anywhere, it offers to apply', (tester) async {
      graphql.myApplications = [for (var i = 0; i < 60; i++) application(i)];
      await pumpDetail(tester);
      expect(find.text('Ask to adopt'), findsOneWidget);
    });
  });
}
