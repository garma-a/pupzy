import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/adoption_card.dart';
import '../widgets/distance_filter.dart';
import '../widgets/top_bar.dart';
import 'adoption_detail_screen.dart';

class AdoptScreen extends StatefulWidget {
  const AdoptScreen({super.key});

  @override
  State<AdoptScreen> createState() => _AdoptScreenState();
}

class _AdoptScreenState extends State<AdoptScreen> {
  Future<void> _refresh() async {
    await Future.delayed(const Duration(milliseconds: 600));
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final maxDist = DistanceProvider.of(context).maxDistance;
    final distLabel = maxDist.isFinite ? '${maxDist.toInt()}km' : '50+km';
    final filtered = MockData.adoptionPets.where((p) => p.distance <= maxDist).toList();

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
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 12),
                  decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
                  child: Row(
                    children: [
                      const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                      const SizedBox(width: AppSpacing.sm),
                      Text(t(context, 'Search pets, posts, users...', 'ابحث عن حيوانات، منشورات، مستخدمين...'), style: Theme.of(context).textTheme.bodyMedium),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              const DistanceFilter(),
              const SizedBox(height: AppSpacing.sm),
              TabBar(
                tabs: [
                  Tab(text: t(context, 'Adoption', 'تبني')),
                  Tab(text: t(context, 'Matching', 'مطابقة')),
                ],
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
                child: RichText(
                  text: TextSpan(
                    style: Theme.of(context).textTheme.bodySmall,
                    children: [
                      TextSpan(text: '${t(context, 'Within', 'ضمن')} '),
                      TextSpan(text: distLabel, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
                      TextSpan(text: ' ${t(context, 'of you', 'منك')}'),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    RefreshIndicator(
                      onRefresh: _refresh,
                      color: AppColors.primary,
                      child: filtered.isEmpty
                          ? ListView(
                              padding: const EdgeInsets.only(bottom: 100),
                              children: [
                                Padding(
                                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                                  child: Center(
                                    child: Column(
                                      children: [
                                        const Icon(Icons.pets_outlined, size: 48, color: AppColors.textMuted),
                                        const SizedBox(height: AppSpacing.md),
                                        Text(
                                          t(context, 'No pets for adoption within this distance', 'لا توجد حيوانات للتبني ضمن هذه المسافة'),
                                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                          textAlign: TextAlign.center,
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          t(context, 'Try widening your distance filter', 'جرّب توسيع نطاق المسافة'),
                                          style: Theme.of(context).textTheme.bodySmall,
                                          textAlign: TextAlign.center,
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.only(bottom: 100),
                              itemCount: filtered.length,
                              itemBuilder: (_, i) => AdoptionCard(
                                pet: filtered[i],
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => AdoptionDetailScreen(pet: filtered[i])),
                                ),
                              ),
                            ),
                    ),
                    Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.favorite_border, size: 52, color: AppColors.textMuted),
                          const SizedBox(height: 12),
                          Text(t(context, 'Matching coming soon', 'المطابقة قريبًا'), style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: AppColors.textMuted)),
                        ],
                      ),
                    ),
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
