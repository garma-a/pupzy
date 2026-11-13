import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/feed_post.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/theme/app_theme.dart';
import 'package:pupzy/utils/price_label.dart';
import 'package:pupzy/widgets/price_tag.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
    await tester.pumpWidget(
      safetyTestApp(
        graphql: FakeSafetyGraphQL(),
        events: SafetyEvents(),
        child: Builder(
          builder: (c) {
            context = c;
            return const SizedBox();
          },
        ),
      ),
    );

    expect(priceLabel(context, isFree: true), 'Free');
    expect(priceLabel(context, isFree: false, amount: 350, currency: 'EGP'), '350 EGP');
    expect(priceLabel(context, isFree: false, amount: 99.6), '100 EGP');
    expect(priceLabel(context, isFree: false, amount: 1250), '1,250 EGP');
    expect(priceLabel(context, isFree: false, amount: 25000, currency: 'USD'), '25,000 USD');
  });

  testWidgets('in Arabic the currency reads ج.م', (tester) async {
    SharedPreferences.setMockInitialValues({'lang': 'ar'});
    late BuildContext context;
    await tester.pumpWidget(
      safetyTestApp(
        graphql: FakeSafetyGraphQL(),
        events: SafetyEvents(),
        child: Builder(
          builder: (c) {
            context = c;
            return const SizedBox();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(priceLabel(context, isFree: false, amount: 1250, currency: 'EGP'), '1,250 ج.م');
    expect(priceLabel(context, isFree: true), 'مجاني');
  });

  group('PriceTag', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    Future<void> pumpTag(WidgetTester tester, PriceTag tag) async {
      await tester.pumpWidget(
        safetyTestApp(
          graphql: FakeSafetyGraphQL(),
          events: SafetyEvents(),
          child: Center(child: tag),
        ),
      );
      await tester.pumpAndSettle();
    }

    // Text.rich wraps the given span in one carrying the default style.
    TextSpan priceSpans(WidgetTester tester) =>
        (tester.widget<RichText>(find.descendant(of: find.byType(PriceTag), matching: find.byType(RichText)).first).text as TextSpan)
                .children!
                .single
            as TextSpan;

    testWidgets('shows the amount large and bold, the currency smaller and lighter', (tester) async {
      await pumpTag(tester, const PriceTag(isFree: false, amount: 1250, currency: 'EGP'));

      final spans = priceSpans(tester).children!.cast<TextSpan>();
      expect(spans.map((s) => s.text), ['1,250', ' EGP']);
      final (amount, currency) = (spans[0].style!, spans[1].style!);
      expect(amount.fontWeight, FontWeight.w800);
      expect(amount.color, AppColors.textPrimary);
      expect(currency.fontSize!, lessThan(amount.fontSize!));
      expect(currency.color, AppColors.textSecondary);
      expect(amount.fontFeatures, contains(const FontFeature.tabularFigures()));
      expect(find.bySemanticsLabel('1,250 EGP'), findsOneWidget);
    });

    testWidgets('the listing page size is larger than the card size', (tester) async {
      double amountSize() => (priceSpans(tester).children!.first as TextSpan).style!.fontSize!;
      await pumpTag(tester, const PriceTag(isFree: false, amount: 90));
      final card = amountSize();
      await pumpTag(tester, const PriceTag(isFree: false, amount: 90, large: true));
      expect(amountSize(), greaterThan(card));
    });

    testWidgets('a giveaway is a green Free pill', (tester) async {
      await pumpTag(tester, const PriceTag(isFree: true));

      expect(find.text('Free'), findsOneWidget);
      expect(tester.widget<Text>(find.text('Free')).style?.color, AppColors.sectionLineGreen);
      expect(find.byIcon(Icons.volunteer_activism_outlined), findsOneWidget);
    });
  });
}
