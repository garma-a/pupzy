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

/// Wraps [child] in the app's shimmer animation.
class ShimmerWrap extends StatelessWidget {
  final Widget child;
  const ShimmerWrap({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return AutoShimmer(
      isLoading: true,
      baseColor: AppColors.border,
      highlightColor: const Color(0xFFF7F4EF),
      child: child,
    );
  }
}

/// Vertical list-card skeleton — image on top, text lines below.
/// Matches the Help/Adopt feed card shape.
class ListCardSkeleton extends StatelessWidget {
  final double imageHeight;
  const ListCardSkeleton({super.key, this.imageHeight = 180});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrap(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(AppRadius.card)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SkeletonBox(height: imageHeight, borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card))),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SkeletonBox(height: 14, width: 160, borderRadius: BorderRadius.all(Radius.circular(6))),
                  const SizedBox(height: AppSpacing.sm),
                  const SkeletonBox(height: 12, borderRadius: BorderRadius.all(Radius.circular(6))),
                  const SizedBox(height: 6),
                  const SkeletonBox(height: 12, width: 220, borderRadius: BorderRadius.all(Radius.circular(6))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Fixed-width horizontal scroll card skeleton — matches Home's rescue cards.
class HorizontalCardSkeleton extends StatelessWidget {
  final double width;
  final double height;
  const HorizontalCardSkeleton({super.key, this.width = 280, this.height = 270});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrap(
      child: Container(
        width: width,
        height: height,
        margin: const EdgeInsets.only(right: AppSpacing.md),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(AppRadius.card)),
      ),
    );
  }
}

/// Plain rectangular tile skeleton — matches Marketplace grid items.
class GridTileSkeleton extends StatelessWidget {
  const GridTileSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrap(
      child: Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(AppRadius.card)),
      ),
    );
  }
}

/// Full detail-screen skeleton — hero image + title/badges/description lines.
class DetailScreenSkeleton extends StatelessWidget {
  const DetailScreenSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrap(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SkeletonBox(height: 320, borderRadius: BorderRadius.zero),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SkeletonBox(height: 24, width: 220, borderRadius: BorderRadius.all(Radius.circular(8))),
                const SizedBox(height: AppSpacing.sm),
                const Row(
                  children: [
                    SkeletonBox(width: 80, height: 28, borderRadius: BorderRadius.all(Radius.circular(20))),
                    SizedBox(width: AppSpacing.sm),
                    SkeletonBox(width: 100, height: 28, borderRadius: BorderRadius.all(Radius.circular(20))),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                const SkeletonBox(height: 14, borderRadius: BorderRadius.all(Radius.circular(6))),
                const SizedBox(height: 8),
                const SkeletonBox(height: 14, borderRadius: BorderRadius.all(Radius.circular(6))),
                const SizedBox(height: 8),
                const SkeletonBox(height: 14, width: 200, borderRadius: BorderRadius.all(Radius.circular(6))),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact row skeleton — for notifications / contact-request list items.
class ListRowSkeleton extends StatelessWidget {
  const ListRowSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrap(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
        child: Row(
          children: [
            const SkeletonBox(width: 40, height: 40, borderRadius: BorderRadius.all(Radius.circular(20))),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SkeletonBox(height: 12, borderRadius: BorderRadius.all(Radius.circular(6))),
                  const SizedBox(height: 6),
                  const SkeletonBox(height: 10, width: 150, borderRadius: BorderRadius.all(Radius.circular(6))),
                ],
              ),
            ),
          ],
        ),
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
