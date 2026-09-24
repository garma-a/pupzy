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
  Future<(List<AdoptionApplication>, String?)> fetchMyAdoptionApplications({int first = 20}) async => (<AdoptionApplication>[], null);
  @override
  Future<(List<ContactRequest>, String?)> fetchPostContactRequests({required String postId, String? status, int first = 20}) async =>
      (<ContactRequest>[], null);
  @override
  Future<(List<AdoptionApplication>, String?)> fetchPostAdoptionApplications({required String postId, String? status, int first = 20}) async =>
      (<AdoptionApplication>[], null);
}

const ownerId = 'owner-1';

PostDetail post(String type) => PostDetail.fromJson({
      'id': 'post-$type',
      'postType': type,
      'title': 'A $type post',
      'description': 'Description long enough to read.',
      'status': 'ACTIVE',
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

  Future<void> pumpDetail(WidgetTester tester, Case c, {required bool asOwner}) async {
    // Wide on purpose: the test font draws every glyph as a full em square,
    // so text is far wider than on a phone and would report false overflows.
    // Small-screen layout is checked on a real device instead.
    tester.view.physicalSize = const Size(2000, 3200);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);
    graphql = FakeDetailGraphQL()
      ..meId = asOwner ? ownerId : 'viewer-1'
      ..postDetailResult = post(c.type)
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
}
