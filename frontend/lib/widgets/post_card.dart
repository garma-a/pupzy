import 'package:flutter/material.dart';

import '../models/post.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import 'engagement_bar.dart';
import 'image_with_fallback.dart';
import 'pet_carousel.dart';

class PostCard extends StatelessWidget {
  final Post post;
  final VoidCallback? onTap;
  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback onShare;
  final VoidCallback onBookmark;

  const PostCard({
    super.key,
    required this.post,
    this.onTap,
    required this.onLike,
    required this.onComment,
    required this.onShare,
    required this.onBookmark,
  });

  String? get _badgeLabel {
    switch (post.type) {
      case PostType.adoption:
        return 'Adoption';
      case PostType.rescue:
        return 'Rescue';
      case PostType.product:
        return 'Shop';
      case PostType.general:
        return null;
    }
  }

  Color get _badgeColor {
    switch (post.type) {
      case PostType.rescue:
        return AppColors.critical;
      case PostType.adoption:
        return AppColors.primary;
      case PostType.product:
        return AppColors.primary;
      case PostType.general:
        return AppColors.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final badge = _badgeLabel;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.card),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(radius: 20, backgroundImage: NetworkImage(post.avatarUrl)),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(post.username, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                        Text(timeAgo(post.timestamp), style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ),
                  if (badge != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 4),
                      decoration: BoxDecoration(
                        color: _badgeColor.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                      ),
                      child: Text(
                        badge,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: _badgeColor, fontWeight: FontWeight.w700),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              if (post.imageUrls.length > 1)
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.card),
                  child: PetCarousel(
                    imageUrls: post.imageUrls,
                    height: 220,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                  ),
                )
              else if (post.imageUrls.isNotEmpty)
                ImageWithFallback(
                  url: post.imageUrls.first,
                  width: double.infinity,
                  height: 220,
                  borderRadius: BorderRadius.circular(AppRadius.card),
                ),
              const SizedBox(height: AppSpacing.md),
              Text(post.caption, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: AppSpacing.md),
              EngagementBar(
                likeCount: post.likeCount,
                commentCount: post.commentCount,
                shareCount: post.shareCount,
                isLiked: post.isLiked,
                isBookmarked: post.isBookmarked,
                onLike: onLike,
                onComment: onComment,
                onShare: onShare,
                onBookmark: onBookmark,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
