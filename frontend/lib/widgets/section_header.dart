import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color accentColor;
  final VoidCallback? onSeeAll;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    this.accentColor = AppColors.primary,
    this.onSeeAll,
  });

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Container(
        padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.sm, AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surfaceWarm.withValues(alpha: 0.62),
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.025), blurRadius: 10, offset: const Offset(0, 3)),
          ],
        ),
        child: Row(
          children: [
            if (icon != null) ...[
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: accentColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppRadius.image),
                ),
                child: Icon(icon, size: 17, color: accentColor),
              ),
              const SizedBox(width: AppSpacing.sm),
            ],
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.titleLarge?.copyWith(fontSize: 21, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.bodySmall?.copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ],
              ),
            ),
            if (onSeeAll != null) ...[
              const SizedBox(width: AppSpacing.xs),
              Semantics(
                button: true,
                label: '${t(context, 'See all', 'عرض الكل')} $title',
                child: TextButton.icon(
                  onPressed: onSeeAll,
                  icon: const Icon(Icons.arrow_forward_rounded, size: 16),
                  label: Text(t(context, 'See all', 'عرض الكل')),
                  style: TextButton.styleFrom(
                    foregroundColor: accentColor,
                    minimumSize: const Size(48, 48),
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                    textStyle: textTheme.labelLarge?.copyWith(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
