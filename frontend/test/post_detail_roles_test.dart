import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/adoption_application.dart';
import 'package:pupzy/models/contact_request.dart';
import 'package:pupzy/models/mating_detail.dart';
import 'package:pupzy/models/post_detail.dart';
import 'package:pupzy/screens/adoption_detail_screen.dart';
import 'package:pupzy/screens/mating_detail_screen.dart';
import 'package:pupzy/screens/product_detail_screen.dart';
import 'package:pupzy/screens/rescue_detail_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/owner_post_actions.dart';
import 'package:pupzy/widgets/safety_actions.dart';

import 'safety_test_support.dart';

/// UI half of the post type × role matrix (the API half is
/// backend/test/live/post-matrix.live-spec.ts): for every post type, the
/// owner sees owner controls and no report/block menu; any other viewer sees
/// report/block and the type's way of reaching the owner, and never owner
/// controls.
class FakeDetailGraphQL extends FakeSafetyGraphQL {
  String meId = 'viewer-1';
  RescuePostExtension? rescue;
  LostPostExtension? lost;
  AdoptionPostExtension? adoption;
  ProductPostExtension? product;
  MatingDetails? mating;
  List<AdoptionApplication> myApplications = [];
  String? renewError;
  int renewCalls = 0;

  @override
  Future<Map<String, dynamic>?> fetchMe() async => {'id': meId, 'fullName': 'Me', 'profileComplete': true};
  @override
  Future<void> recordView(String postId) async {}
  @override
  Future<(RescuePostExtension?, String?)> fetchRescuePostDetail(String postId) async => (rescue, null);
  @override
  Future<(LostPostExtension?, String?)> fetchLostPostDetail(String postId) async => (lost, null);
  @override
  Future<(AdoptionPostExtension?, String?)> fetchAdoptionPostDetail(String postId) async => (adoption, null);
  @override
  Future<(ProductPostExtension?, String?)> fetchProductPostDetail(String postId) async => (product, null);
  @override
  Future<(MatingDetails?, String?)> fetchMatingPostDetail(String postId) async => (mating, null);
  @override
  Future<(List<AdoptionApplication>, String?)> fetchMyAdoptionApplications({int first = 20}) async => (List.of(myApplications), null);
  @override
  Future<(bool, String?)> renewPost(String postId) async {
    renewCalls++;
    return (renewError == null, renewError);
  }
  @override
  Future<(List<ContactRequest>, String?)> fetchPostContactRequests({required String postId, String? status, int first = 20}) async =>
      (<ContactRequest>[], null);
  @override
  Future<(List<AdoptionApplication>, String?)> fetchPostAdoptionApplications({required String postId, String? status, int first = 20}) async =>
      (<AdoptionApplication>[], null);
}

const ownerId = 'owner-1';

PostDetail post(String type, {String status = 'ACTIVE'}) => PostDetail.fromJson({
      'id': 'post-$type',
      'postType': type,
      'title': 'A $type post',
      'description': 'Description long enough to read.',
      'status': status,
      'urgency': type == 'RESCUE' || type == 'LOST' ? 'URGENT' : null,
      'city': {'id': 'c1', 'nameEnglish': 'Qasr Al-Nile', 'nameArabic': 'قصر النيل', 'governorate': 'Cairo'},
      'coordinates': type == 'RESCUE' || type == 'LOST' ? {'latitude': 30.04, 'longitude': 31.23} : null,
      'media': <Object>[],
      'creator': {'id': ownerId, 'fullName': 'Olivia Owner', 'createdAt': '2026-01-01T00:00:00Z'},
      'upvoteCount': 0,
      'saveCount': 0,
      'viewCount': 0,
      'commentCount': 0,
      'createdAt': '2026-09-20T10:00:00Z',
      'nearestVetClinics': <Object>[],
    });

class Case {
  const Case(this.name, this.type, this.screen, this.viewerAction, {this.reportType, this.headline});
  final String name;
  /// What the screen shows as its heading (pet name for adoption/mating).
  final String? headline;
  final String type;
  final Widget Function(String id) screen;
  final String viewerAction;
  final String? reportType;
}

final cases = [
  Case('RESCUE', 'RESCUE', (id) => RescueDetailScreen(postId: id), 'Post Update'),
  Case('LOST_PET', 'LOST', (id) => RescueDetailScreen(postId: id), 'Contact', reportType: 'LOST_PET'),
  Case('FOUND_STRAY', 'LOST', (id) => RescueDetailScreen(postId: id), 'Contact', reportType: 'FOUND_STRAY'),
  Case('ADOPTION', 'ADOPTION', (id) => AdoptionDetailScreen(postId: id), 'Ask to adopt', headline: 'Nala'),
  Case('PRODUCT', 'PRODUCT', (id) => ProductDetailScreen(postId: id), 'WhatsApp'),
  Case('MATING', 'MATING', (id) => MatingDetailScreen(postId: id), 'Contact Owner', headline: 'Duke'),
];

void main() {
  late FakeDetailGraphQL graphql;

  Future<void> pumpDetail(WidgetTester tester, Case c, {required bool asOwner, String status = 'ACTIVE', void Function(FakeDetailGraphQL)? setUp}) async {
    // Wide on purpose: the test font draws every glyph as a full em square,
    // so text is far wider than on a phone and would report false overflows.
    // Small-screen layout is checked on a real device instead.
    tester.view.physicalSize = const Size(2000, 3200);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);
    graphql = FakeDetailGraphQL()
      ..meId = asOwner ? ownerId : 'viewer-1'
      ..postDetailResult = post(c.type, status: status)
      ..rescue = const RescuePostExtension(species: 'DOG', conditionSummary: 'Limping but alert', reporterRole: 'REPORTING')
      ..lost = c.reportType == null
          ? null
          : LostPostExtension.fromJson({'reportType': c.reportType, 'species': 'CAT', 'petName': 'Mishmish'})
      ..adoption = AdoptionPostExtension.fromJson({'petName': 'Nala', 'species': 'CAT', 'gender': 'FEMALE'})
      ..product = ProductPostExtension.fromJson({'category': 'ACCESSORIES', 'condition': 'USED', 'priceAmount': 250, 'isFree': false})
      ..mating = MatingDetails.fromJson({
        'petName': 'Duke',
        'species': 'DOG',
        'breed': 'Golden Retriever',
        'gender': 'MALE',
        'ageValue': 3,
        'ageUnit': 'YEARS',
        'isPurebred': true,
        'hasPedigreeCertificate': false,
        'vaccinated': true,
        'dewormed': true,
      });
    setUp?.call(graphql);
    await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), child: c.screen('post-${c.type}')));
    await tester.pumpAndSettle();
  }

  for (final c in cases) {
    group(c.name, () {
      testWidgets('owner sees owner controls and no report/block menu', (tester) async {
        await pumpDetail(tester, c, asOwner: true);
        expect(find.text(c.headline ?? 'A ${c.type} post'), findsWidgets);
        if (c.type == 'PRODUCT') {
          expect(find.text('Mark Sold'), findsOneWidget);
        } else {
          expect(find.byType(OwnerPostActions), findsOneWidget);
        }
        expect(find.text('Delete'), findsOneWidget);
        expect(find.byType(PostSafetyMenu), findsNothing);
        expect(find.textContaining(c.viewerAction), findsNothing, reason: 'owners are not offered to contact themselves');
      });

      testWidgets('viewer sees report/block and the way to reach the owner, never owner controls', (tester) async {
        await pumpDetail(tester, c, asOwner: false);
        expect(find.text(c.headline ?? 'A ${c.type} post'), findsWidgets);
        expect(find.byType(OwnerPostActions), findsNothing);
        expect(find.text('Delete'), findsNothing);
        expect(find.text('Mark Sold'), findsNothing);
        expect(find.byType(PostSafetyMenu), findsOneWidget);
        expect(find.textContaining(c.viewerAction), findsWidgets);
      });
    });
  }

  // ── Item 3: no new contact requests / applications on completed Posts ──

  ElevatedButton buttonLabelled(WidgetTester tester, String label) =>
      tester.widget<ElevatedButton>(find.ancestor(of: find.text(label), matching: find.byType(ElevatedButton)).first);

  ContactRequest request(String status) => ContactRequest.fromJson({
        'id': 'req-1',
        'postId': 'p',
        'message': 'Is the pet still here?',
        'status': status,
        'createdAt': '2026-09-21T10:00:00Z',
      });

  AdoptionApplication application(String status) => AdoptionApplication.fromJson({
        'id': 'app-1',
        'targetPostId': 'post-ADOPTION',
        'status': status,
        'livingSituation': 'APARTMENT',
        'whyAdopt': 'We have room and time.',
        'createdAt': '2026-09-21T10:00:00Z',
      });

  final contactCases = [
    (cases[1], 'REUNITED', 'Reunited — no new requests'),
    (cases[2], 'RESOLVED', 'Resolved — no new requests'),
    (cases[5], 'RESOLVED', 'Resolved — no new requests'),
  ];
  for (final (c, status, closedLabel) in contactCases) {
    group('${c.name} closed as $status', () {
      testWidgets('a new visitor sees the outcome instead of a request button', (tester) async {
        await pumpDetail(tester, c, asOwner: false, status: status);
        expect(find.text(closedLabel), findsOneWidget);
        expect(buttonLabelled(tester, closedLabel).onPressed, isNull);
        expect(find.text(c.viewerAction), findsNothing);
      });

      testWidgets('an approved requester can still reach the owner on WhatsApp', (tester) async {
        await pumpDetail(tester, c, asOwner: false, status: status, setUp: (g) => g.myContactRequests.add(request('APPROVED')));
        expect(buttonLabelled(tester, 'Message on WhatsApp').onPressed, isNotNull);
      });
    });
  }

  testWidgets('a Post that closes while open updates its button after a request fails', (tester) async {
    await pumpDetail(tester, cases[1], asOwner: false);
    expect(buttonLabelled(tester, 'Contact').onPressed, isNotNull);

    await tester.tap(find.text('Contact'));
    await tester.pumpAndSettle();
    // The owner closes the Post meanwhile; the request is rejected and the
    // visitor closes the sheet.
    graphql.postDetailResult = post('LOST', status: 'REUNITED');
    Navigator.of(tester.element(find.byType(BottomSheet))).pop();
    await tester.pumpAndSettle();

    expect(find.text('Reunited — no new requests'), findsOneWidget);
    expect(buttonLabelled(tester, 'Reunited — no new requests').onPressed, isNull);
  });

  group('ADOPTION closed', () {
    testWidgets('an adopted listing takes no new applications', (tester) async {
      await pumpDetail(tester, cases[3], asOwner: false, status: 'ADOPTED');
      expect(buttonLabelled(tester, 'Adopted — no new applications').onPressed, isNull);
      expect(find.text('Ask to adopt'), findsNothing);
    });

    testWidgets('an expired listing says so and takes no new applications', (tester) async {
      await pumpDetail(tester, cases[3], asOwner: false, status: 'EXPIRED');
      expect(buttonLabelled(tester, 'Listing expired').onPressed, isNull);
    });

    testWidgets('an approved applicant keeps WhatsApp after adoption', (tester) async {
      await pumpDetail(tester, cases[3], asOwner: false, status: 'ADOPTED', setUp: (g) => g.myApplications.add(application('APPROVED')));
      expect(buttonLabelled(tester, 'Message Owner on WhatsApp').onPressed, isNotNull);
    });

    testWidgets('a pending applicant still sees their application, not a closed label', (tester) async {
      await pumpDetail(tester, cases[3], asOwner: false, status: 'ADOPTED', setUp: (g) => g.myApplications.add(application('PENDING')));
      expect(buttonLabelled(tester, 'Application Sent ✓').onPressed, isNull);
    });
  });

  // ── Item 4: expired listings must be renewed before closure ──

  group('expired listings', () {
    testWidgets('PRODUCT: Mark Sold waits for a successful renewal', (tester) async {
      await pumpDetail(tester, cases[4], asOwner: true, status: 'EXPIRED');
      expect(find.text('Renew this listing before marking it sold.'), findsOneWidget);
      expect(buttonLabelled(tester, 'Mark Sold').onPressed, isNull);

      graphql.renewError = 'RENEWAL_COOLDOWN';
      await tester.tap(find.textContaining('Renew').last);
      await tester.pumpAndSettle();
      expect(graphql.renewCalls, 1);
      expect(buttonLabelled(tester, 'Mark Sold').onPressed, isNull, reason: 'a failed renewal leaves it expired');

      graphql.renewError = null;
      await tester.tap(find.textContaining('Renew').last);
      await tester.pumpAndSettle();
      expect(buttonLabelled(tester, 'Mark Sold').onPressed, isNotNull);
      expect(find.text('Renew this listing before marking it sold.'), findsNothing);
    });

    testWidgets('ADOPTION: Mark Adopted waits for a successful renewal', (tester) async {
      await pumpDetail(tester, cases[3], asOwner: true, status: 'EXPIRED');
      expect(find.text('Renew this listing before marking it adopted.'), findsOneWidget);
      final closeButton = find.byKey(const Key('ownerCloseButton'));
      expect(tester.widget<ElevatedButton>(closeButton).onPressed, isNull);
      expect(find.text('Mark Adopted'), findsOneWidget, reason: 'expired is not shown as a completed outcome');

      await tester.tap(find.textContaining('Renew').last);
      await tester.pumpAndSettle();
      expect(tester.widget<ElevatedButton>(closeButton).onPressed, isNotNull);
      expect(find.text('Renew this listing before marking it adopted.'), findsNothing);
    });

    testWidgets('ACTIVE listings are unaffected', (tester) async {
      await pumpDetail(tester, cases[4], asOwner: true);
      expect(buttonLabelled(tester, 'Mark Sold').onPressed, isNotNull);
      expect(find.textContaining('Renew this listing before'), findsNothing);
    });
  });
}
