import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/pet.dart';
import '../theme/app_theme.dart';
import '../widgets/adoption_card.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/rescue_card.dart';
import '../widgets/top_bar.dart';
import 'product_detail_screen.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback? onNavigateToMarket;
  const HomeScreen({super.key, this.onNavigateToMarket});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Future<void> _refresh() async {
    await Future.delayed(const Duration(milliseconds: 600));
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final maxDist = DistanceProvider.of(context).maxDistance;
    final favorites = MockData.favorites;
    final rescue = MockData.rescueAnimals.where((a) => a.distance <= maxDist).toList();
    final adoption = MockData.adoptionPets.where((p) => p.distance <= maxDist).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const SizedBox(height: AppSpacing.md),
            const PupzyTopBar(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 12),
                      decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
                      child: Row(
                        children: [
                          const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              t(context, 'Search pets, posts, users...', 'ابحث عن حيوانات، منشورات، مستخدمين...'),
                              style: Theme.of(context).textTheme.bodyMedium,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  const _VetsButton(),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _refresh,
                color: AppColors.primary,
                child: ListView(
                padding: const EdgeInsets.only(bottom: 100),
                children: [
                  const DistanceFilter(),
                  const SizedBox(height: AppSpacing.md),
                  // FAVORITES
                  _SectionHeader(
                    leading: const Icon(Icons.favorite, size: 16, color: AppColors.critical),
                    title: t(context, 'FAVORITES', 'المفضلة'),
                    trailing: GestureDetector(
                      onTap: () => Fluttertoast.showToast(msg: t(context, 'See all favorites', 'عرض كل المفضلة')),
                      child: Text(t(context, 'See more →', 'المزيد ←'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SizedBox(
                      height: 190,
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        itemCount: favorites.length,
                        itemBuilder: (_, i) => FavoritePetCard(pet: favorites[i]),
                      ),
                    ),

                  // HELP A PET
                  const SizedBox(height: AppSpacing.lg),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Row(
                      children: [
                        Text(t(context, 'Help a Pet', 'ساعد حيوانًا'), style: Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(width: AppSpacing.md),
                        Container(width: 4, height: 32, color: AppColors.critical),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (rescue.any((a) => a.isUrgent))
                    RescueAlertBanner(animal: rescue.firstWhere((a) => a.isUrgent)),
                  const SizedBox(height: AppSpacing.sm),
                  if (rescue.isEmpty)
                    _EmptySection(
                      icon: Icons.volunteer_activism_outlined,
                      message: t(context, 'No rescue animals within this distance', 'لا توجد حيوانات إنقاذ ضمن هذه المسافة'),
                    )
                  else
                    SizedBox(
                      height: 270,
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        itemCount: rescue.length,
                        itemBuilder: (_, i) => _HomeRescueCard(animal: rescue[i]),
                      ),
                    ),

                  // FIND A PET
                  const SizedBox(height: AppSpacing.lg),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Row(
                      children: [
                        Text(t(context, 'Find a Pet', 'ابحث عن حيوان'), style: Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(width: AppSpacing.md),
                        Container(width: 4, height: 32, color: AppColors.sectionLine),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (adoption.isEmpty)
                    _EmptySection(
                      icon: Icons.pets_outlined,
                      message: t(context, 'No pets for adoption within this distance', 'لا توجد حيوانات للتبني ضمن هذه المسافة'),
                    )
                  else
                    AdoptionCard(pet: adoption.first),

                  // MARKETPLACE
                  const SizedBox(height: AppSpacing.lg),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Row(
                      children: [
                        Text(t(context, 'Marketplace', 'السوق'), style: Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(width: AppSpacing.md),
                        Container(width: 4, height: 32, color: AppColors.sectionLineGreen),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: AppSpacing.md,
                      crossAxisSpacing: AppSpacing.md,
                      childAspectRatio: 0.82,
                    ),
                    itemCount: 2,
                    itemBuilder: (context, i) {
                      final p = MockData.products[i];
                      return GestureDetector(
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductDetailScreen(product: p))),
                        child: Container(
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(AppRadius.card),
                            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 8, offset: const Offset(0, 3))],
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: ClipRRect(
                                  borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                                  child: ImageWithFallback(url: p.imageUrls.first, width: double.infinity),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.all(AppSpacing.sm),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(p.title,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
                                    Text(
                                        p.isFree ? 'Free' : '${p.price?.toInt() ?? '-'} ${p.currency}',
                                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w700)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: OutlinedButton(
                      onPressed: widget.onNavigateToMarket,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(double.infinity, 48),
                        side: const BorderSide(color: AppColors.border),
                        shape: const StadiumBorder(),
                      ),
                      child: Text(t(context, 'See all in Marketplace →', 'عرض الكل في السوق ←'), style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
              ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VetsButton extends StatelessWidget {
  const _VetsButton();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceWarm,
      borderRadius: BorderRadius.circular(AppRadius.chip),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.chip),
        onTap: () => showModalBottomSheet(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (_) => const _VetsNearYouSheet(),
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.chip),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.location_on_outlined, size: 16, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(
                t(context, 'Vets', 'بيطري'),
                style: const TextStyle(color: AppColors.primary, fontSize: 13, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Static "coming soon" preview of nearby vets — there's no vet directory
/// feature or backend for this yet, so this runs on hardcoded mock data.
class _VetsNearYouSheet extends StatelessWidget {
  const _VetsNearYouSheet();

  static const List<(String name, String distance, String area)> _vets = [
    ('Cairo Emergency Vet', '0.6 km', 'Maadi'),
    ('Amman Night Clinic', '0.9 km', 'Sweifieh'),
    ('Petcare Centre', '2.1 km', 'Abdoun'),
  ];

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
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.white.withValues(alpha: 0.78),
                  AppColors.background.withValues(alpha: 0.55),
                ],
              ),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
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
                  Text(t(context, 'Vets near you', 'الأطباء البيطريون القريبون'), style: Theme.of(context).textTheme.headlineLarge),
                  const SizedBox(height: 4),
                  Text(
                    t(context, 'Cairo area · approximate distances only', 'منطقة القاهرة · مسافات تقريبية فقط'),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  ..._vets.map((v) => Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(AppRadius.card),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.65)),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.6), shape: BoxShape.circle),
                                child: const Icon(Icons.location_on_outlined, color: AppColors.primary, size: 18),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(v.$1, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                                    Text('${v.$2}  ·  ${v.$3}', style: Theme.of(context).textTheme.bodySmall),
                                  ],
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  color: AppColors.sectionLineGreen.withValues(alpha: 0.16),
                                  borderRadius: BorderRadius.circular(AppRadius.chip),
                                ),
                                child: Text(
                                  t(context, 'Open', 'مفتوح'),
                                  style: const TextStyle(color: AppColors.sectionLineGreen, fontWeight: FontWeight.w700, fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ),
                      )),
                  const SizedBox(height: AppSpacing.sm),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        Fluttertoast.showToast(msg: t(context, 'Full vet directory coming soon', 'دليل الأطباء البيطريين الكامل قريبًا'));
                      },
                      style: OutlinedButton.styleFrom(
                        backgroundColor: Colors.white.withValues(alpha: 0.55),
                        side: BorderSide(color: Colors.white.withValues(alpha: 0.65)),
                      ),
                      child: Text(t(context, 'View all vets →', 'عرض كل الأطباء البيطريين ←')),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptySection extends StatelessWidget {
  final String message;
  final IconData icon;
  const _EmptySection({required this.message, this.icon = Icons.search_off});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
      child: Center(
        child: Column(
          children: [
            Icon(icon, size: 36, color: AppColors.textMuted),
            const SizedBox(height: AppSpacing.sm),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final Widget? leading;
  final String title;
  final Widget? trailing;
  const _SectionHeader({this.leading, required this.title, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 6)],
          Text(title, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 1)),
          const Spacer(),
          ?trailing,
        ],
      ),
    );
  }
}

class _HomeRescueCard extends StatefulWidget {
  final RescueAnimal animal;
  const _HomeRescueCard({required this.animal});

  @override
  State<_HomeRescueCard> createState() => _HomeRescueCardState();
}

class _HomeRescueCardState extends State<_HomeRescueCard> {
  bool get _boosted => MockData.boostedRescueIds.contains(widget.animal.id);

  void _toggleBoost() {
    setState(() {
      if (_boosted) {
        MockData.boostedRescueIds.remove(widget.animal.id);
      } else {
        MockData.boostedRescueIds.add(widget.animal.id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.animal;
    final boosted = _boosted;
    final boosts = a.boostCount + (boosted ? 1 : 0);
    final dotIndex = a.description.indexOf('.');
    final restOfDescription = dotIndex != -1 && dotIndex + 2 <= a.description.length ? a.description.substring(dotIndex + 2) : '';
    return Container(
      width: 280,
      margin: const EdgeInsets.only(right: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            children: [
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                child: ImageWithFallback(url: a.imageUrls.first, width: 280, height: 180),
              ),
              PositionedDirectional(
                top: AppSpacing.sm,
                start: AppSpacing.sm,
                child: Row(
                  children: [
                    if (a.isUrgent)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: AppColors.critical, borderRadius: BorderRadius.circular(AppRadius.chip)),
                        child: Text(t(context, 'CRITICAL', 'حرجة'), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                      ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(AppRadius.chip)),
                      child: Text(
                        '${a.species == 'Cat' ? '🐱' : '🐕'} ${a.species}',
                        style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.md, 28, AppSpacing.md, AppSpacing.sm),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Colors.black.withValues(alpha: 0.7)],
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        a.description.split('.').first,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        restOfDescription,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 12),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 0),
            child: Row(
              children: [
                Text(
                  a.distance.toStringAsFixed(1),
                  style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 24, fontWeight: FontWeight.w800),
                ),
                const SizedBox(width: 3),
                Text(t(context, 'km', 'كم'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.md),
            child: Row(
              children: [
                Material(
                  color: Colors.transparent,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                    onTap: _toggleBoost,
                    child: _SmallActionBtn(
                      icon: Icons.arrow_upward,
                      label: '$boosts  ${boosted ? t(context, 'Boosted', 'مُعزَّز') : t(context, 'Boost', 'تعزيز')}',
                      color: boosted ? AppColors.primary : AppColors.textMuted,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SmallActionBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  const _SmallActionBtn({required this.icon, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}
