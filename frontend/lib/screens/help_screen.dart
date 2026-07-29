import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/distance_filter.dart';
import '../widgets/rescue_card.dart';
import '../widgets/top_bar.dart';

class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key});

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

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
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                  decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
                  child: Row(
                    children: [
                      const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: TextField(
                          controller: _searchController,
                          onChanged: (v) => setState(() => _query = v),
                          style: Theme.of(context).textTheme.bodyMedium,
                          decoration: InputDecoration(
                            hintText: t(context, 'Search by breed, area, description...', 'ابحث حسب السلالة أو المنطقة أو الوصف...'),
                            hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                            border: InputBorder.none,
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                      if (_query.isNotEmpty)
                        Semantics(
                          button: true,
                          label: t(context, 'Clear search', 'مسح البحث'),
                          child: GestureDetector(
                            onTap: () => setState(() {
                              _searchController.clear();
                              _query = '';
                            }),
                            child: const Icon(Icons.close, size: 18, color: AppColors.textMuted),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              const DistanceFilter(),
              const SizedBox(height: AppSpacing.sm),
              TabBar(
                tabs: [
                  Tab(text: t(context, 'Rescue calls', 'نداءات الإنقاذ')),
                  Tab(text: t(context, 'Lost & Found', 'المفقودات')),
                ],
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
                child: RichText(
                  text: TextSpan(
                    style: Theme.of(context).textTheme.bodySmall,
                    children: [
                      TextSpan(text: '${t(context, 'Showing posts within', 'عرض المنشورات ضمن')} '),
                      TextSpan(text: distLabel, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
                      TextSpan(text: ' ${t(context, 'of you', 'منك')}'),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    _RescueList(maxDistance: maxDist, query: _query),
                    _RescueList(lostAndFound: true, maxDistance: maxDist, query: _query),
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
  final String query;
  const _RescueList({this.lostAndFound = false, required this.maxDistance, this.query = ''});

  @override
  Widget build(BuildContext context) {
    var items = MockData.rescueAnimals.where((a) => a.distance <= maxDistance).toList();
    if (lostAndFound) {
      items = items.where((a) => !a.isUrgent).toList();
    }
    final q = query.trim().toLowerCase();
    if (q.isNotEmpty) {
      items = items.where((a) {
        return a.breed.toLowerCase().contains(q) ||
            a.species.toLowerCase().contains(q) ||
            a.location.toLowerCase().contains(q) ||
            a.description.toLowerCase().contains(q);
      }).toList();
    }
    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(q.isNotEmpty ? Icons.search_off : Icons.pets_outlined, size: 40, color: AppColors.textMuted),
              const SizedBox(height: AppSpacing.sm),
              Text(
                q.isNotEmpty
                    ? t(context, 'No results for "$query"', 'لا توجد نتائج لـ "$query"')
                    : t(context, 'No rescue animals within this distance', 'لا توجد حيوانات إنقاذ ضمن هذه المسافة'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
            ],
          ),
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
