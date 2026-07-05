import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/distance_filter.dart';
import '../widgets/rescue_card.dart';
import '../widgets/top_bar.dart';

class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final maxDist = DistanceProvider.of(context).maxDistance;
    final distLabel = maxDist.isFinite ? '${maxDist.toInt()}km' : '50+km';

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          bottom: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppSpacing.md),
              const PupzyTopBar(),
              const SizedBox(height: AppSpacing.md),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 12),
                  decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
                  child: Row(
                    children: [
                      const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                      const SizedBox(width: AppSpacing.sm),
                      Text('Search pets, posts, users...', style: Theme.of(context).textTheme.bodyMedium),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              const DistanceFilter(),
              const SizedBox(height: AppSpacing.sm),
              const TabBar(
                tabs: [Tab(text: 'Rescue calls'), Tab(text: 'Lost & Found')],
                padding: EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
                child: RichText(
                  text: TextSpan(
                    style: Theme.of(context).textTheme.bodySmall,
                    children: [
                      const TextSpan(text: 'Showing posts within '),
                      TextSpan(text: distLabel, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
                      const TextSpan(text: ' of you'),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    _RescueList(maxDistance: maxDist),
                    _RescueList(lostAndFound: true, maxDistance: maxDist),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RescueList extends StatelessWidget {
  final bool lostAndFound;
  final double maxDistance;
  const _RescueList({this.lostAndFound = false, required this.maxDistance});

  @override
  Widget build(BuildContext context) {
    var items = MockData.rescueAnimals.where((a) => a.distance <= maxDistance).toList();
    if (lostAndFound) {
      items = items.where((a) => !a.isUrgent).toList();
    }
    if (items.isEmpty) {
      return Center(
        child: Text(
          'No rescue animals within this distance',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 100, top: AppSpacing.xs),
      itemCount: items.length,
      itemBuilder: (_, i) => RescueCard(animal: items[i], blurPhoto: !lostAndFound),
    );
  }
}
