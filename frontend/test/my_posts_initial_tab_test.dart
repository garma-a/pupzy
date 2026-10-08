import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/feed_post.dart';
import 'package:pupzy/screens/my_posts_screen.dart';
import 'package:pupzy/services/safety_events.dart';

import 'safety_test_support.dart';

/// The profile's post counts open My Posts on the tab for that post type.
class _MyPostsGraphQL extends FakeSafetyGraphQL {
  final List<String> requestedTypes = [];

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

void main() {
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

  int selectedTab(WidgetTester tester) => tester.widget<TabBar>(find.byType(TabBar)).controller!.index;

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
}
