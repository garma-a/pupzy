import 'dart:ui';

import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/image_with_fallback.dart';
import 'rescue_detail_screen.dart';

class RescueScreen extends StatefulWidget {
  const RescueScreen({super.key});

  @override
  State<RescueScreen> createState() => _RescueScreenState();
}

class _RescueScreenState extends State<RescueScreen> {
  final Set<int> _revealedIndices = {};

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rescue')),
      body: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: MockData.rescueAnimals.length,
        itemBuilder: (context, i) {
          final animal = MockData.rescueAnimals[i];
          final revealed = _revealedIndices.contains(i);
          return InkWell(
            borderRadius: BorderRadius.circular(AppRadius.card),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => RescueDetailScreen(animal: animal)),
              );
            },
            child: Container(
              margin: const EdgeInsets.only(bottom: AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.card),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => setState(() {
                      if (revealed) {
                        _revealedIndices.remove(i);
                      } else {
                        _revealedIndices.add(i);
                      }
                    }),
                    child: ClipRRect(
                      borderRadius: const BorderRadius.horizontal(left: Radius.circular(AppRadius.card)),
                      child: SizedBox(
                        width: 100,
                        height: 100,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            ImageWithFallback(
                              url: animal.imageUrls.first,
                              width: 100,
                              height: 100,
                            ),
                            if (!revealed)
                              ClipRect(
                                child: BackdropFilter(
                                  filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                                  child: Container(
                                    color: Colors.black.withValues(alpha: 0.25),
                                    child: const Center(
                                      child: Icon(Icons.visibility_outlined, color: Colors.white, size: 22),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(animal.name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                              ),
                              if (animal.isUrgent)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppColors.critical,
                                    borderRadius: BorderRadius.circular(AppRadius.chip),
                                  ),
                                  child: const Text('Urgent', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                                ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(animal.breed, style: Theme.of(context).textTheme.bodySmall),
                          Text(animal.location, style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
