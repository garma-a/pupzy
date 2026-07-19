import 'dart:ui';

import 'package:flutter/material.dart';

import '../models/post.dart';
import '../theme/app_theme.dart';
import 'post_form_screen.dart';

class NewPostSheet extends StatelessWidget {
  const NewPostSheet({super.key});

  static const Color _lostPetAccent = Color(0xFFE08A2E);
  static const Color _adoptionAccent = Color(0xFFB08C3A);
  static const Color _matchingAccent = Color(0xFF8E7CC3);
  static const Color _productAccent = Color(0xFF5B8DEF);

  @override
  Widget build(BuildContext context) {
    return Container(
      // Depth shadow lives outside the clip so it isn't cut off
      decoration: BoxDecoration(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        boxShadow: [
          BoxShadow(
            color: AppColors.textPrimary.withValues(alpha: 0.18),
            blurRadius: 40,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 36, sigmaY: 36),
          child: Container(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xl),
            decoration: BoxDecoration(
              // Gradient tint: brighter at the top where "light hits",
              // settling into the warm background tone below
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.white.withValues(alpha: 0.78),
                  AppColors.background.withValues(alpha: 0.55),
                ],
              ),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
              // Crisp light-catching edge along the top only
              border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: 0.75), width: 1.2),
              ),
            ),
            child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.textMuted.withValues(alpha: 0.45),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text('What are you posting?', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Every post connects an animal to help.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.lg),
            _TypeOption(
              index: 0,
              icon: Icons.favorite_border,
              accent: AppColors.critical,
              title: 'Rescue Alert',
              subtitle: 'Animal in distress nearby',
              onTap: () => _openForm(context, PostType.rescue, initialCategory: 'Urgent'),
            ),
            const SizedBox(height: AppSpacing.md),
            _TypeOption(
              index: 1,
              icon: Icons.search,
              accent: _lostPetAccent,
              title: 'Lost Pet',
              subtitle: 'My pet is missing',
              onTap: () => _openForm(context, PostType.rescue, initialCategory: 'Lost'),
            ),
            const SizedBox(height: AppSpacing.md),
            _TypeOption(
              index: 2,
              icon: Icons.home_outlined,
              accent: _adoptionAccent,
              title: 'Adoption',
              subtitle: 'Put a pet up for adoption',
              onTap: () => _openForm(context, PostType.adoption),
            ),
            const SizedBox(height: AppSpacing.md),
            _TypeOption(
              index: 3,
              icon: Icons.shield_outlined,
              accent: _matchingAccent,
              title: 'Responsible Matching',
              subtitle: 'Apply to adopt — verified process',
              onTap: () => Navigator.of(context).pop('adopt'),
            ),
            const SizedBox(height: AppSpacing.md),
            _TypeOption(
              index: 4,
              icon: Icons.shopping_bag_outlined,
              accent: _productAccent,
              title: 'List a Product',
              subtitle: 'Sell or donate rescue supplies',
              onTap: () => _openForm(context, PostType.product),
            ),
          ],
            ),
          ),
        ),
      ),
    ),
    );
  }

  void _openForm(BuildContext context, PostType type, {String? initialCategory}) {
    Navigator.of(context).pop();
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PostFormScreen(type: type, initialCategory: initialCategory),
      ),
    );
  }
}

class _TypeOption extends StatefulWidget {
  final int index;
  final IconData icon;
  final Color accent;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _TypeOption({
    required this.index,
    required this.icon,
    required this.accent,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  State<_TypeOption> createState() => _TypeOptionState();
}

class _TypeOptionState extends State<_TypeOption> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    _slide = Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );
    Future.delayed(Duration(milliseconds: 50 * widget.index), () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(
        position: _slide,
        child: Material(
          color: Colors.white.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(AppRadius.card),
          child: InkWell(
            onTap: widget.onTap,
            borderRadius: BorderRadius.circular(AppRadius.card),
            splashColor: widget.accent.withValues(alpha: 0.08),
            highlightColor: widget.accent.withValues(alpha: 0.05),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 14),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white.withValues(alpha: 0.65)),
                borderRadius: BorderRadius.circular(AppRadius.card),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: widget.accent.withValues(alpha: 0.16),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white.withValues(alpha: 0.5)),
                    ),
                    child: Icon(widget.icon, color: widget.accent, size: 22),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.title,
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 1),
                        Text(widget.subtitle, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textSecondary)),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: AppColors.textMuted, size: 20),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
