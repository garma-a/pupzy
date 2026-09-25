import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
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
import 'package:shared_preferences/shared_preferences.dart';

import 'detail_test_support.dart';
import 'safety_test_support.dart';

/// UI half of the post type × role matrix (the API half is
/// backend/test/live/post-matrix.live-spec.ts): for every post type, the
/// owner sees owner controls and no report/block menu; any other viewer sees
/// report/block and the type's way of reaching the owner, and never owner
/// controls.
//
// FakeDetailGraphQL, ownerId and post() live in detail_test_support.dart.

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

  Future<void> pumpDetail(
    WidgetTester tester,
    Case c, {
    required bool asOwner,
    String status = 'ACTIVE',
    void Function(FakeDetailGraphQL)? setUp,
    LangProvider? lang,
  }) async {
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
    await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), lang: lang, child: c.screen('post-${c.type}')));
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

  // ── Item 1: rescue outcomes ──

  group('rescue outcomes on the detail screen', () {
    testWidgets('an active rescue owner can choose Animal deceased', (tester) async {
      await pumpDetail(tester, cases[0], asOwner: true);
      await tester.tap(find.byKey(const Key('ownerCloseButton')));
      await tester.pumpAndSettle();
      expect(find.text('Rescued'), findsOneWidget);
      expect(find.text('Animal deceased'), findsOneWidget);
    });

    for (final c in [cases[1], cases[2], cases[3], cases[5]]) {
      testWidgets('${c.name} never offers Animal deceased', (tester) async {
        await pumpDetail(tester, c, asOwner: true);
        await tester.tap(find.byKey(const Key('ownerCloseButton')));
        await tester.pumpAndSettle();
        expect(find.text('Animal deceased'), findsNothing);
      });
    }

    for (final asOwner in [true, false]) {
      testWidgets('a deceased rescue shows its outcome to the ${asOwner ? 'owner' : 'viewer'}, never as rescued', (tester) async {
        await pumpDetail(tester, cases[0], asOwner: asOwner, status: 'ANIMAL_DECEASED');
        expect(find.text('This rescue was closed because the animal died.'), findsOneWidget);
        expect(find.textContaining('Rescued'), findsNothing);
        expect(find.byIcon(Icons.check_circle_outline), findsNothing);
        expect(find.text('URGENT'), findsNothing, reason: 'a closed rescue is not urgent');
        if (asOwner) {
          expect(tester.widget<ElevatedButton>(find.byKey(const Key('ownerCloseButton'))).onPressed, isNull);
        }
      });
    }

    testWidgets('a rescued rescue explains what Rescued means', (tester) async {
      await pumpDetail(tester, cases[0], asOwner: false, status: 'RESOLVED');
      expect(find.text('Rescued'), findsOneWidget);
      expect(find.text('Immediate danger was addressed and appropriate care secured.'), findsOneWidget);
    });

    testWidgets('an Arabic viewer sees the deceased outcome in Arabic', (tester) async {
      // LangProvider persists the choice; give it an in-memory store.
      SharedPreferences.setMockInitialValues({});
      final lang = LangProvider();
      await lang.setLang(Lang.ar);
      await pumpDetail(tester, cases[0], asOwner: false, status: 'ANIMAL_DECEASED', lang: lang);
      expect(find.text('وفاة الحيوان'), findsOneWidget);
      expect(find.text('أُغلقت حالة الإنقاذ هذه بسبب وفاة الحيوان.'), findsOneWidget);
    });
  });
}
