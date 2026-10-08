import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../utils/upvote_wording.dart';
import 'animated_boost_chip.dart';

/// The Support (Rescue, Lost & Found) or Like (Adoption, Find a Mate) button
/// of a post. Its owner sees the same chip greyed out and not tappable, with
/// the count, since nobody can support or like their own post.
class UpvoteButton extends StatelessWidget {
  final String postType;
  final int count;
  final bool upvoted;
  final bool isOwner;
  final Future<bool> Function() onToggle;

  /// Smaller chip for cards and title rows.
  final bool compact;

  const UpvoteButton({
    super.key,
    required this.postType,
    required this.count,
    required this.upvoted,
    required this.isOwner,
    required this.onToggle,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final wording = UpvoteWording.of(postType);
    final padding = compact ? const EdgeInsets.symmetric(horizontal: 10, vertical: 5) : const EdgeInsets.symmetric(horizontal: 14, vertical: 7);
    final iconSize = compact ? 13.0 : 15.0;
    final fontSize = compact ? 12.0 : 13.0;

    if (isOwner) {
      return Tooltip(
        message: wording.notOwnPost(context),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.circular(AppRadius.chip),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(wording.icon, size: iconSize, color: AppColors.textMuted),
              const SizedBox(width: 5),
              Text(
                '$count  ${wording.action(context)}',
                style: TextStyle(fontSize: fontSize, color: AppColors.textMuted, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
      );
    }

    return AnimatedBoostChip(
      count: count,
      boosted: upvoted,
      onToggle: onToggle,
      boostedLabel: wording.done(context),
      unboostedLabel: wording.action(context),
      icon: wording.icon,
      boostedIcon: wording.doneIcon,
      activeColor: AppColors.primary,
      inactiveColor: AppColors.textMuted,
      padding: padding,
      iconSize: iconSize,
      fontSize: fontSize,
    );
  }
}
