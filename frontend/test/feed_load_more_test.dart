import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/feed_post.dart';
import 'package:pupzy/screens/saved_posts_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/load_more_footer.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

/// Serves saved posts 20 per page from an endless (or [total]-long) list.
class _PagedGraphQL extends FakeSafetyGraphQL {
  _PagedGraphQL({this.total});
  final int? total;
  final List<String?> pageRequests = [];

  @override
  Future<(List<FeedPost>, String?, bool, String?)> fetchMySavedPosts({int first = 20, String? after}) async {
    pageRequests.add(after);
    final start = after == null ? 0 : int.parse(after);
    final end = total == null ? start + first : (start + first).clamp(0, total!);
    final posts = [for (var i = start; i < end; i++) _post(i)];
    return (posts, '$end', total == null || end < total!, null);
  }
}

FeedPost _post(int i) => FeedPost.fromEdgeJson({
  'cursor': 'c$i',
  'distanceKm': null,
  'node': {
    'id': 'p$i',
    'postType': 'ADOPTION',
    'title': 'Post $i',
    'description': 'Saved post number $i.',
    'status': 'ACTIVE',
    'upvoteCount': 0,
    'saveCount': 1,
    'viewCount': 0,
    'commentCount': 0,
    'isUpvotedByMe': false,
    'isSavedByMe': true,
    'createdAt': '2026-10-08T10:00:00Z',
    'city': {'id': 'c1', 'nameEnglish': 'Qasr Al-Nile', 'nameArabic': 'قصر النيل', 'governorate': 'Cairo'},
    'media': <Object>[],
    'creator': {'id': 'owner-1'},
  },
});

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<void> pumpSaved(WidgetTester tester, _PagedGraphQL graphql) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(graphql: graphql, events: SafetyEvents(), child: const SavedPostsScreen()));
    await tester.pumpAndSettle();
  }

  Future<void> scrollToEnd(WidgetTester tester) async {
    for (var i = 0; i < 40; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, -2000));
      await tester.pumpAndSettle();
    }
  }

  test('the cap is three pages', () {
    expect(feedAutoLoadLimit, 3 * feedPageSize);
    expect(feedCanAutoLoad(40), isTrue);
    expect(feedCanAutoLoad(60), isFalse);
    expect(feedShowsFooter(loadingMore: false, hasNextPage: true, loaded: 40), isFalse, reason: 'still auto-loading');
    expect(feedShowsFooter(loadingMore: false, hasNextPage: true, loaded: 60), isTrue, reason: 'the button');
    expect(feedShowsFooter(loadingMore: true, hasNextPage: true, loaded: 20), isTrue, reason: 'the spinner');
    expect(feedShowsFooter(loadingMore: false, hasNextPage: false, loaded: 20), isFalse, reason: 'one short page');
    expect(feedShowsFooter(loadingMore: false, hasNextPage: false, loaded: 45), isTrue, reason: "that's everything");
  });

  testWidgets('scrolling loads pages by itself up to the cap, then asks', (tester) async {
    final graphql = _PagedGraphQL();
    await pumpSaved(tester, graphql);

    await scrollToEnd(tester);
    expect(graphql.pageRequests, [null, '20', '40'], reason: 'three pages, then it stops');
    expect(find.text('Post 59'), findsOneWidget);
    expect(find.text('Show more'), findsOneWidget);

    await tester.tap(find.text('Show more'));
    await tester.pumpAndSettle();
    expect(graphql.pageRequests.last, '60');

    await scrollToEnd(tester);
    expect(graphql.pageRequests, hasLength(4), reason: 'past the cap, only a tap loads more');
    expect(find.text('Post 79'), findsOneWidget);
    expect(find.text('Show more'), findsOneWidget);
  });

  testWidgets('a feed that ends before the cap says so', (tester) async {
    final graphql = _PagedGraphQL(total: 45);
    await pumpSaved(tester, graphql);

    await scrollToEnd(tester);
    expect(graphql.pageRequests, [null, '20', '40']);
    expect(find.text('Show more'), findsNothing);
    expect(find.text("That's everything"), findsOneWidget);
  });
}
