import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

class EngagementBar extends StatelessWidget {
  final int likeCount;
  final int commentCount;
  final int shareCount;
  final bool isLiked;
  final bool isBookmarked;
  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback onShare;
  final VoidCallback onBookmark;

  const EngagementBar({
    super.key,
    required this.likeCount,
    required this.commentCount,
    required this.shareCount,
    required this.isLiked,
    required this.isBookmarked,
    required this.onLike,
    required this.onComment,
    required this.onShare,
    required this.onBookmark,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _EngagementButton(
          icon: isLiked ? Icons.favorite : Icons.favorite_border,
          color: isLiked ? AppColors.critical : AppColors.textSecondary,
          count: likeCount,
          onTap: onLike,
          semanticLabel: isLiked ? t(context, 'Unlike', 'إلغاء الإعجاب') : t(context, 'Like', 'إعجاب'),
        ),
        const SizedBox(width: AppSpacing.lg),
        _EngagementButton(
          icon: Icons.chat_bubble_outline,
          color: AppColors.textSecondary,
          count: commentCount,
          onTap: onComment,
          semanticLabel: t(context, 'Comments', 'التعليقات'),
        ),
        const SizedBox(width: AppSpacing.lg),
        _EngagementButton(
          icon: Icons.share_outlined,
          color: AppColors.textSecondary,
          count: shareCount,
          onTap: onShare,
          semanticLabel: t(context, 'Share', 'مشاركة'),
        ),
        const Spacer(),
        IconButton(
          onPressed: onBookmark,
          icon: Icon(
            isBookmarked ? Icons.bookmark : Icons.bookmark_border,
            color: isBookmarked ? AppColors.primary : AppColors.textSecondary,
          ),
          tooltip: isBookmarked ? t(context, 'Remove bookmark', 'إزالة الحفظ') : t(context, 'Bookmark', 'حفظ'),
          visualDensity: VisualDensity.compact,
        ),
      ],
    );
  }
}

class _EngagementButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final int count;
  final VoidCallback onTap;
  final String semanticLabel;

  const _EngagementButton({
    required this.icon,
    required this.color,
    required this.count,
    required this.onTap,
    required this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$semanticLabel, $count',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
          child: Row(
            children: [
              Icon(icon, size: 20, color: color),
              const SizedBox(width: 4),
              Text('$count', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color)),
            ],
          ),
        ),
      ),
    );
  }
}
