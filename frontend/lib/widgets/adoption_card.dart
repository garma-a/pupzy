import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/pet.dart';
import '../theme/app_theme.dart';
import 'image_with_fallback.dart';

class AdoptionCard extends StatefulWidget {
  final AdoptionPet pet;
  final VoidCallback? onTap;
  const AdoptionCard({super.key, required this.pet, this.onTap});

  @override
  State<AdoptionCard> createState() => _AdoptionCardState();
}

class _AdoptionCardState extends State<AdoptionCard> {
  AdoptionPet get pet => widget.pet;
  bool get _applied => MockData.appliedAdoptionIds.contains(pet.id);

  void _apply() {
    setState(() => MockData.appliedAdoptionIds.add(pet.id));
    Fluttertoast.showToast(
      msg: t(context, 'Request sent to adopt ${pet.name}!', 'تم إرسال طلب تبني ${pet.name}!'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final applied = _applied;
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
          // Photo
          Stack(
            children: [
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                child: ImageWithFallback(url: pet.imageUrls.first, width: double.infinity, height: 300),
              ),
              PositionedDirectional(
                top: AppSpacing.sm,
                end: AppSpacing.sm,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                  ),
                  child: Text(
                    '${pet.species == 'Cat' ? '🐱' : '🐕'} ${pet.species}',
                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              // Name overlay at bottom
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 32, AppSpacing.lg, AppSpacing.md),
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(0)),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Colors.black.withValues(alpha: 0.65)],
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t(context, 'MEET', 'تعرّف'),
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 11, letterSpacing: 2, fontWeight: FontWeight.w700),
                      ),
                      Text(
                        pet.name,
                        style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800),
                      ),
                      Text(
                        '${pet.breed} · ${pet.age}',
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          // Traits
          if (pet.traits.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
              child: Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.xs,
                children: pet.traits.map((t) {
                  return Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.background,
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(width: 6, height: 6, decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle)),
                        const SizedBox(width: 6),
                        Text(t, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textPrimary)),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
          // Description
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
            child: Text(pet.description, style: Theme.of(context).textTheme.bodyMedium),
          ),
          // CTA
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: ElevatedButton(
              onPressed: applied ? null : _apply,
              style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
              child: Text(
                applied
                    ? t(context, 'Application sent ✓', 'تم إرسال الطلب ✓')
                    : t(context, 'Ask to adopt ${pet.name}', 'اطلب تبني ${pet.name}'),
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }
}

// Compact favorites card for horizontal scroll
class FavoritePetCard extends StatefulWidget {
  final AdoptionPet pet;
  final VoidCallback? onTap;
  const FavoritePetCard({super.key, required this.pet, this.onTap});

  @override
  State<FavoritePetCard> createState() => _FavoritePetCardState();
}

class _FavoritePetCardState extends State<FavoritePetCard> {
  AdoptionPet get pet => widget.pet;
  bool get _isFavorite => MockData.favoritePetIds.contains(pet.id);

  void _toggleFavorite() {
    setState(() {
      if (_isFavorite) {
        MockData.favoritePetIds.remove(pet.id);
      } else {
        MockData.favoritePetIds.add(pet.id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final favorite = _isFavorite;
    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
      width: 150,
      margin: const EdgeInsets.only(right: AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 8, offset: const Offset(0, 3))],
      ),
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.card),
            child: ImageWithFallback(url: pet.imageUrls.first, width: 150, height: 190),
          ),
          // gradient overlay
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadius.card),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, Colors.black.withValues(alpha: 0.6)],
                  stops: const [0.5, 1.0],
                ),
              ),
            ),
          ),
          // heart button
          PositionedDirectional(
            top: AppSpacing.sm,
            end: AppSpacing.sm,
            child: Semantics(
              button: true,
              label: favorite ? t(context, 'Remove from favorites', 'إزالة من المفضلة') : t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
              child: GestureDetector(
                onTap: _toggleFavorite,
                child: Container(
                  width: 30,
                  height: 30,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  child: Icon(
                    favorite ? Icons.favorite : Icons.favorite_border,
                    size: 16,
                    color: AppColors.critical,
                  ),
                ),
              ),
            ),
          ),
          // name / breed
          Positioned(
            bottom: AppSpacing.sm,
            left: AppSpacing.sm,
            right: AppSpacing.sm,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(pet.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14)),
                Text(pet.breed, style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
      ),
    );
  }
}
