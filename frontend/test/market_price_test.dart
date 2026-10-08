import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/feed_post.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/utils/price_label.dart';

import 'safety_test_support.dart';

/// Marketplace cards show the price without opening the listing: the feed
/// carries it (Post.product) and the card reads it with [priceLabel].
void main() {
  Map<String, dynamic> edge({Map<String, dynamic>? product}) => {
        'cursor': 'c1',
        'distanceKm': 1.5,
        'node': {
          'id': 'p1',
          'postType': product == null ? 'ADOPTION' : 'PRODUCT',
          'title': 'Cat carrier',
          'description': 'Barely used.',
          'status': 'ACTIVE',
          'upvoteCount': 0,
          'saveCount': 0,
          'viewCount': 0,
          'commentCount': 0,
          'isUpvotedByMe': false,
          'isSavedByMe': false,
          'createdAt': '2026-10-08T10:00:00Z',
          'city': {'id': 'c1', 'nameEnglish': 'Qasr Al-Nile', 'nameArabic': 'قصر النيل', 'governorate': 'Cairo'},
          'media': <Object>[],
          'creator': {'id': 'owner-1'},
          'product': product,
        },
      };

  test('a Market feed post carries its price', () {
    final post = FeedPost.fromEdgeJson(edge(product: {'priceAmount': 350, 'priceCurrency': 'EGP', 'isFree': false}));
    expect(post.priceAmount, 350);
    expect(post.priceCurrency, 'EGP');
    expect(post.isFree, false);

    final copy = post.copyWith(isSavedByMe: true);
    expect((copy.priceAmount, copy.priceCurrency, copy.isFree), (350, 'EGP', false));
  });

  test("a feed post carries who posted it, so cards can spot the viewer's own posts", () {
    final post = FeedPost.fromEdgeJson(edge());
    expect(post.creatorId, 'owner-1');
    expect(post.copyWith(isSavedByMe: true).creatorId, 'owner-1');
  });

  test('other post types carry no price', () {
    final post = FeedPost.fromEdgeJson(edge());
    expect((post.priceAmount, post.priceCurrency, post.isFree), (null, null, null));
  });

  testWidgets('the price reads "Free" or the amount and currency', (tester) async {
    late BuildContext context;
    await tester.pumpWidget(safetyTestApp(
      graphql: FakeSafetyGraphQL(),
      events: SafetyEvents(),
      child: Builder(builder: (c) {
        context = c;
        return const SizedBox();
      }),
    ));

    expect(priceLabel(context, isFree: true), 'Free');
    expect(priceLabel(context, isFree: false, amount: 350, currency: 'EGP'), '350 EGP');
    expect(priceLabel(context, isFree: false, amount: 99.6), '100 EGP');
  });
}
