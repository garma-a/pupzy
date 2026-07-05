import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../models/pet.dart';
import '../theme/app_theme.dart';
import 'image_with_fallback.dart';

class RescueCard extends StatefulWidget {
  final RescueAnimal animal;
  final VoidCallback? onTap;
  final bool blurPhoto;

  const RescueCard({super.key, required this.animal, this.onTap, this.blurPhoto = true});

  @override
  State<RescueCard> createState() => _RescueCardState();
}

class _RescueCardState extends State<RescueCard> {
  bool _revealed = false;
  bool _boosted = false;
  int _boosts = 0;

  @override
  void initState() {
    super.initState();
    _boosts = widget.animal.boostCount;
    if (!widget.blurPhoto) _revealed = true;
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.animal;
    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, 4))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Photo area with overlay badges
            Stack(
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                  child: _revealed
                      ? ImageWithFallback(url: a.imageUrls.first, width: double.infinity, height: 180)
                      : _BlurredPhoto(url: a.imageUrls.first),
                ),
                Positioned(
                  top: AppSpacing.sm,
                  left: AppSpacing.sm,
                  child: Row(
                    children: [
                      _Badge(
                        label: '${a.species == 'Cat' ? '🐱' : '🐕'} ${a.species}',
                        color: AppColors.textPrimary.withValues(alpha: 0.75),
                      ),
                      if (a.isUrgent) ...[
                        const SizedBox(width: AppSpacing.xs),
                        _Badge(label: 'CRITICAL', color: AppColors.critical),
                      ],
                    ],
                  ),
                ),
                Positioned(
                  top: AppSpacing.sm,
                  right: AppSpacing.sm,
                  child: GestureDetector(
                    onTap: () => setState(() => _revealed = !_revealed),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.black45,
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.visibility_outlined, size: 14, color: Colors.white),
                          const SizedBox(width: 4),
                          Text(_revealed ? 'Hide' : 'Tap to see',
                              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500)),
                        ],
                      ),
                    ),
                  ),
                ),
                Positioned(
                  bottom: AppSpacing.sm,
                  right: AppSpacing.sm,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(AppRadius.chip)),
                    child: Row(
                      children: [
                        Text(
                          a.distance.toStringAsFixed(1),
                          style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(width: 2),
                        const Text('km', style: TextStyle(color: Colors.white70, fontSize: 11)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            // Info area
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${a.distance.toStringAsFixed(1)} km away   ·   ${a.timeAgoLabel}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(a.description.split('.').first, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 17)),
                  const SizedBox(height: 4),
                  Text(
                    a.description.contains('.') ? a.description.substring(a.description.indexOf('.') + 2) : '',
                    style: Theme.of(context).textTheme.bodyMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            // Actions
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
              child: Row(
                children: [
                  _ActionBtn(
                    icon: Icons.arrow_upward,
                    label: '$_boosts  ${_boosted ? 'Boosted' : 'Boost'}',
                    onTap: () => setState(() {
                      _boosted = !_boosted;
                      _boosts += _boosted ? 1 : -1;
                    }),
                    color: _boosted ? AppColors.primary : AppColors.textMuted,
                  ),
                  const Spacer(),
                  _ActionBtn(
                    icon: Icons.flag_outlined,
                    label: 'Report',
                    onTap: () => Fluttertoast.showToast(msg: 'Report submitted'),
                    color: AppColors.textMuted,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: ElevatedButton(
                onPressed: () => Fluttertoast.showToast(msg: 'Connecting you to rescue team...'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 48),
                  backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                  foregroundColor: AppColors.primary,
                  elevation: 0,
                  shape: const StadiumBorder(),
                ),
                child: const Text('I Can Help →'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BlurredPhoto extends StatelessWidget {
  final String url;
  const _BlurredPhoto({required this.url});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ImageWithFallback(url: url, width: double.infinity, height: 180),
        Positioned.fill(
          child: ClipRRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(color: Colors.black.withValues(alpha: 0.25)),
            ),
          ),
        ),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(AppRadius.chip)),
      child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

class _ActionBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;
  const _ActionBtn({required this.icon, required this.label, required this.onTap, required this.color});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.circular(AppRadius.chip),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Icon(icon, size: 15, color: color),
            const SizedBox(width: 5),
            Text(label, style: TextStyle(fontSize: 13, color: color, fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}

// Compact horizontal rescue alert card (for Home screen)
class RescueAlertBanner extends StatelessWidget {
  final RescueAnimal animal;
  const RescueAlertBanner({super.key, required this.animal});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xs),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: const Border(left: BorderSide(color: AppColors.critical, width: 4)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: const BoxDecoration(color: AppColors.critical, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      'CRITICAL  ·  NEARBY',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted, letterSpacing: 0.5),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(animal.description.split('.').first, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 16)),
                const SizedBox(height: 2),
                Text(
                  animal.timeAgoLabel.isNotEmpty ? 'Night clinic open for 42 min' : '',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          Column(
            children: [
              Text(
                animal.distance.toStringAsFixed(1),
                style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 30, color: AppColors.textPrimary),
              ),
              Text('km away', style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ],
      ),
    );
  }
}
