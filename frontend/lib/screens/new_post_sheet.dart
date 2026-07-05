import 'package:flutter/material.dart';

import '../models/post.dart';
import '../theme/app_theme.dart';
import 'post_form_screen.dart';

class NewPostSheet extends StatelessWidget {
  const NewPostSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xl),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: AppSpacing.lg),
            Text('What would you like to share?', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: AppSpacing.lg),
            _TypeOption(
              icon: Icons.home_outlined,
              title: 'General Post',
              subtitle: 'Share a moment with the community',
              onTap: () => _openForm(context, PostType.general),
            ),
            const SizedBox(height: AppSpacing.sm),
            _TypeOption(
              icon: Icons.pets,
              title: 'Adoption',
              subtitle: 'List a pet looking for a home',
              onTap: () => _openForm(context, PostType.adoption),
            ),
            const SizedBox(height: AppSpacing.sm),
            _TypeOption(
              icon: Icons.volunteer_activism,
              title: 'Rescue',
              subtitle: 'Report a rescue or lost animal',
              onTap: () => _openForm(context, PostType.rescue),
            ),
            const SizedBox(height: AppSpacing.sm),
            _TypeOption(
              icon: Icons.storefront,
              title: 'Product',
              subtitle: 'List an item in the shop',
              onTap: () => _openForm(context, PostType.product),
            ),
          ],
        ),
      ),
    );
  }

  void _openForm(BuildContext context, PostType type) {
    Navigator.of(context).pop();
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PostFormScreen(type: type)),
    );
  }
}

class _TypeOption extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _TypeOption({required this.icon, required this.title, required this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.card),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, color: AppColors.primary),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                  Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}
