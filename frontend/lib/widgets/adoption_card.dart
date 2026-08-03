import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/pet.dart';
import '../theme/app_theme.dart';
import 'image_with_fallback.dart';

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
