import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/contact_request.dart';
import 'package:pupzy/screens/contact_requests_screen.dart';
import 'package:pupzy/services/safety_events.dart';

import 'safety_test_support.dart';

/// Regression guard for a bug that silently broke the approved-contact
/// handoff on every RESCUE/LOST/MATING post: the screens read
/// `ContactRequest.whatsappLink`, which `myContactRequests` never populates
/// (the backend only computes it inside approveContactRequest's response,
/// which goes to the post owner). The requester must ask for it explicitly
/// through the requester-only `getWhatsAppLink` query instead.
void main() {
  late FakeSafetyGraphQL graphql;
  late SafetyEvents events;
  late ToastRecorder toasts;

  ContactRequest request({required String id, required String status}) => ContactRequest(
        id: id,
        postId: 'post-1',
        message: 'Is the cat still there?',
        status: status,
        // Exactly as the server sends it on `myContactRequests` — null.
        whatsappLink: null,
        createdAt: DateTime.utc(2026, 9, 18, 12),
      );

  setUp(() {
    graphql = FakeSafetyGraphQL();
    events = SafetyEvents();
    toasts = ToastRecorder()..install();
  });

  tearDown(() => toasts.uninstall());

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      safetyTestApp(graphql: graphql, events: events, child: const ContactRequestsScreen()),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('an approved request asks the server for the link instead of reading the null field', (tester) async {
    graphql.myContactRequests = [request(id: 'req-7', status: 'APPROVED')];
    graphql.whatsAppLink = null;
    graphql.whatsAppLinkError = 'Owner contact is unavailable';

    await pumpScreen(tester);

    expect(find.textContaining('Approved'), findsOneWidget);
    await tester.tap(find.textContaining('Is the cat still there?'));
    await tester.pumpAndSettle();

    expect(graphql.whatsAppLinkLookups, ['req-7'],
        reason: 'the screen must fetch the link on demand — whatsappLink is always null here');
    expect(toasts.messages, ['Owner contact is unavailable'],
        reason: 'a failed lookup must explain itself instead of doing nothing');
  });

  testWidgets('a declined request never asks for a link', (tester) async {
    graphql.myContactRequests = [request(id: 'req-8', status: 'REJECTED')];

    await pumpScreen(tester);
    await tester.tap(find.textContaining('Is the cat still there?'));
    await tester.pumpAndSettle();

    expect(graphql.whatsAppLinkLookups, isEmpty);
  });

  testWidgets('a pending request is listed as awaiting, not as contactable', (tester) async {
    graphql.myContactRequests = [request(id: 'req-9', status: 'PENDING')];

    await pumpScreen(tester);

    expect(find.text('1 awaiting response'), findsOneWidget);
    expect(graphql.whatsAppLinkLookups, isEmpty);
  });
}
