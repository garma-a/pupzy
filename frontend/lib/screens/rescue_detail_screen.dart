import 'dart:ui';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../models/pet.dart';
import '../theme/app_theme.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/pet_carousel.dart';

class RescueDetailScreen extends StatefulWidget {
  final RescueAnimal animal;

  const RescueDetailScreen({super.key, required this.animal});

  @override
  State<RescueDetailScreen> createState() => _RescueDetailScreenState();
}

class _RescueDetailScreenState extends State<RescueDetailScreen> {
  bool _revealed = false;

  RescueAnimal get animal => widget.animal;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Stack(
                  children: [
                    if (_revealed)
                      PetCarousel(imageUrls: animal.imageUrls, height: 320)
                    else
                      _BlurredCarousel(
                        imageUrls: animal.imageUrls,
                        height: 320,
                        onReveal: () => setState(() => _revealed = true),
                      ),
                    SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.sm),
                        child: CircleAvatar(
                          backgroundColor: Colors.black45,
                          child: IconButton(
                            icon: const Icon(Icons.arrow_back, color: Colors.white),
                            onPressed: () => Navigator.of(context).pop(),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(animal.name, style: Theme.of(context).textTheme.headlineLarge)),
                          if (animal.isUrgent)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 6),
                              decoration: BoxDecoration(
                                color: AppColors.critical,
                                borderRadius: BorderRadius.circular(AppRadius.chip),
                              ),
                              child: Text(
                                t(context, 'Urgent', 'عاجل'),
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: [
                          _InfoChip(icon: Icons.pets, label: animal.breed),
                          _InfoChip(icon: Icons.location_on_outlined, label: animal.location),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'Details', 'التفاصيل'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(animal.description, style: Theme.of(context).textTheme.bodyMedium),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'Contact', 'التواصل'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text('${animal.contactName} · ${animal.contactPhone}',
                          style: Theme.of(context).textTheme.bodyMedium),
                      const SizedBox(height: 96),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Fluttertoast.showToast(
                    msg: '${t(context, 'Found report submitted for', 'تم إرسال بلاغ العثور عن')} ${animal.name}',
                  ),
                  child: Text(t(context, 'Report Found', 'الإبلاغ عن العثور عليه')),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: ElevatedButton(
                  onPressed: () => Fluttertoast.showToast(
                    msg: '${t(context, 'Contacting', 'جارٍ التواصل مع')} ${animal.contactName}...',
                  ),
                  child: Text(t(context, 'Contact Rescue', 'تواصل مع فريق الإنقاذ')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BlurredCarousel extends StatelessWidget {
  final List<String> imageUrls;
  final double height;
  final VoidCallback onReveal;

  const _BlurredCarousel({
    required this.imageUrls,
    required this.height,
    required this.onReveal,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onReveal,
      child: SizedBox(
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            ImageWithFallback(
              url: imageUrls.first,
              width: double.infinity,
              height: height,
            ),
            ClipRect(
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: Container(
                  color: Colors.black.withValues(alpha: 0.25),
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.visibility_outlined, color: Colors.white, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            t(context, 'Tap to see photo', 'اضغط لرؤية الصورة'),
                            style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.background,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(AppRadius.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: AppColors.textSecondary),
          const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}
