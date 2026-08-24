import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../models/feed_post.dart';
import '../screens/adoption_detail_screen.dart';
import '../screens/product_detail_screen.dart';
import '../screens/rescue_detail_screen.dart';
import '../theme/app_theme.dart';
import 'animated_favorite_icon.dart';
import 'image_with_fallback.dart';

/// A compact horizontal-carousel card for any saved post — used by the Home
/// "Favorites" row. Unlike a per-type feed card, this works across all four
/// post types since a user's saved posts can be a mix of all of them.
class SavedPostCard extends StatelessWidget {
  final FeedPost post;
  final Future<bool> Function() onToggleSave;

  const SavedPostCard({super.key, required this.post, required this.onToggleSave});

  void _open(BuildContext context) {
    final Widget screen = switch (post.postType) {
      'ADOPTION' => AdoptionDetailScreen(postId: post.id),
      'PRODUCT' => ProductDetailScreen(postId: post.id),
      _ => RescueDetailScreen(postId: post.id),
    };
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    final cityName = Localizations.localeOf(context).languageCode == 'ar' ? post.cityNameArabic : post.cityNameEnglish;
    return GestureDetector(
      onTap: () => _open(context),
      child: Container(
        width: 150,
        margin: const EdgeInsets.only(right: AppSpacing.md),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 8, offset: const Offset(0, 3))],
        ),
        child: Stack(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.card),
              child: ImageWithFallback(url: post.primaryImageUrl ?? '', width: 150, height: 190),
            ),
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppRadius.card),
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Colors.black.withValues(alpha: 0.65)],
                    stops: const [0.5, 1.0],
                  ),
                ),
              ),
            ),
            PositionedDirectional(
              top: AppSpacing.sm,
              end: AppSpacing.sm,
              child: Container(
                width: 28,
                height: 28,
                decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                child: Center(
                  child: AnimatedFavoriteIcon(
                    isSaved: true,
                    onToggle: onToggleSave,
                    semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
                    semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
                    filledIcon: Icons.favorite,
                    outlineIcon: Icons.favorite_border,
                    activeColor: AppColors.critical,
                    inactiveColor: AppColors.textMuted,
                    size: 14,
                  ),
                ),
              ),
            ),
            PositionedDirectional(
              start: AppSpacing.sm,
              bottom: AppSpacing.sm,
              end: AppSpacing.sm,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    post.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                  Text(
                    post.areaName ?? cityName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
