import 'package:auto_shimmer/auto_shimmer.dart';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class SkeletonBox extends StatelessWidget {
  final double width;
  final double height;
  final BorderRadius? borderRadius;

  const SkeletonBox({super.key, this.width = double.infinity, required this.height, this.borderRadius});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: borderRadius ?? BorderRadius.circular(8),
      ),
    );
  }
}

class PostCardSkeleton extends StatelessWidget {
  const PostCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return AutoShimmer(
      isLoading: true,
      baseColor: AppColors.border,
      highlightColor: const Color(0xFFF7F4EF),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const SkeletonBox(width: 40, height: 40, borderRadius: BorderRadius.all(Radius.circular(20))),
                const SizedBox(width: AppSpacing.sm),
                Expanded(child: SkeletonBox(height: 12, borderRadius: BorderRadius.circular(6))),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            SkeletonBox(height: 180, borderRadius: BorderRadius.circular(AppRadius.card)),
            const SizedBox(height: AppSpacing.md),
            SkeletonBox(height: 12, borderRadius: BorderRadius.circular(6)),
            const SizedBox(height: AppSpacing.xs),
            SkeletonBox(width: 200, height: 12, borderRadius: BorderRadius.circular(6)),
          ],
        ),
      ),
    );
  }
}
