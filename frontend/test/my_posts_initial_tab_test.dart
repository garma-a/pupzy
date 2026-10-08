import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/models/feed_post.dart';
import 'package:pupzy/screens/my_posts_screen.dart';
import 'package:pupzy/screens/profile_screen.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/safety_events.dart';

import 'safety_test_support.dart';

/// The profile's post counts open My Posts on the tab for that post type.
class _MyPostsGraphQL extends FakeSafetyGraphQL {
  final List<String> requestedTypes = [];

  @override
  Future<Map<String, dynamic>?> fetchMe() async => {
        'id': 'me',
        'fullName': 'Matthew Mokhles',
        'email': 'me@example.com',
        'profileComplete': true,
        'rescuePostCount': 4,
        'adoptionPostCount': 3,
        'lostPostCount': 2,
        'productPostCount': 1,
        'matingPostCount': 5,
      };

  @override
  Future<(List<FeedPost>, String?, bool, String?)> fetchMyPosts({
    required String postType,
    int first = 20,
    String? after,
  }) async {
    requestedTypes.add(postType);
    return (<FeedPost>[], null, false, null);
  }
}

/// Stands in for the Firebase-backed AuthService: nobody is signed in to
/// Firebase in a widget test, and the profile only reads the user's name.
class _FakeAuth extends ChangeNotifier implements AuthService {
  @override
  User? get currentUser => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  int selectedTab(WidgetTester tester) => tester.widget<TabBar>(find.byType(TabBar)).controller!.index;

  group('My Posts', () {
    Future<_MyPostsGraphQL> pump(WidgetTester tester, String? postType) async {
      final graphql = _MyPostsGraphQL();
      await tester.pumpWidget(safetyTestApp(
        graphql: graphql,
        events: SafetyEvents(),
        child: MyPostsScreen(initialPostType: postType),
      ));
      await tester.pumpAndSettle();
      return graphql;
    }

    for (final (postType, index) in [('RESCUE', 0), ('LOST', 1), ('ADOPTION', 2)]) {
      testWidgets('opens on the $postType tab when asked', (tester) async {
        final graphql = await pump(tester, postType);
        expect(selectedTab(tester), index);
        expect(graphql.requestedTypes, contains(postType));
      });
    }

    testWidgets('opens on the first tab by default', (tester) async {
      await pump(tester, null);
      expect(selectedTab(tester), 0);
    });
  });

  group('profile post counts', () {
    Future<void> pumpProfile(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ChangeNotifierProvider<AuthService>.value(
        value: _FakeAuth(),
        child: safetyTestApp(graphql: _MyPostsGraphQL(), events: SafetyEvents(), child: const ProfileSheet()),
      ));
      await tester.pumpAndSettle();
    }

    const counts = [('Rescue', '4', 0), ('Lost & Found', '2', 1), ('Adoption', '3', 2), ('Marketplace', '1', 3), ('Find a Mate', '5', 4)];

    testWidgets('shows every post type and All posts as identical cards, three across, in tab order', (tester) async {
      await pumpProfile(tester);
      expect(find.text('MY POSTS'), findsOneWidget);

      final cards = [
        for (final (label, count, _) in counts) find.bySemanticsLabel('$count $label. Open in My Posts'),
        find.bySemanticsLabel('15 All posts. Open in My Posts'),
      ];
      for (final card in cards) {
        expect(card, findsOneWidget);
      }
      // A 3 × 2 grid read in My Posts tab order, every card the same size.
      final rects = [for (final card in cards) tester.getRect(card)];
      for (var i = 0; i < rects.length; i++) {
        expect(rects[i].size, rects[0].size);
        expect(rects[i].top, rects[i - i % 3].top, reason: 'cards of one row line up');
        if (i % 3 > 0) expect(rects[i].left, greaterThan(rects[i - 1].left));
        if (i >= 3) expect(rects[i].left, rects[i - 3].left, reason: 'columns line up');
      }
      expect(rects[3].top, greaterThan(rects[0].bottom));
      expect(rects[0].height, greaterThanOrEqualTo(48), reason: 'each card is a full-size tap target');
      // The Settings list no longer repeats a My Posts entry.
      expect(find.text('My Posts'), findsNothing);
    });

    testWidgets('All posts opens My Posts on its first tab', (tester) async {
      await pumpProfile(tester);
      await tester.tap(find.bySemanticsLabel('15 All posts. Open in My Posts'));
      await tester.pumpAndSettle();
      expect(find.byType(MyPostsScreen), findsOneWidget);
      expect(selectedTab(tester), 0);
    });

    for (final (label, count, index) in counts) {
      testWidgets('tapping $label opens My Posts on its tab', (tester) async {
        await pumpProfile(tester);
        await tester.tap(find.bySemanticsLabel('$count $label. Open in My Posts'));
        await tester.pumpAndSettle();
        expect(find.byType(MyPostsScreen), findsOneWidget);
        expect(selectedTab(tester), index);
      });
    }
  });
}
