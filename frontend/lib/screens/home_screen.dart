import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../data/mock_data.dart';
import '../models/pet.dart';
import '../theme/app_theme.dart';
import '../widgets/adoption_card.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/rescue_card.dart';
import '../widgets/top_bar.dart';
import 'product_detail_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

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
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 100),
                children: [
                  const SizedBox(height: AppSpacing.md),
                  // FAVORITES
                  _SectionHeader(
                    leading: const Icon(Icons.favorite, size: 16, color: AppColors.critical),
                    title: 'FAVORITES',
                    trailing: GestureDetector(
                      onTap: () => Fluttertoast.showToast(msg: 'See all favorites'),
                      child: Text('See more →', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600)),
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
                        Text('Help a Pet', style: Theme.of(context).textTheme.headlineMedium),
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
                    _EmptySection(message: 'No rescue animals within this distance')
                  else
                    SizedBox(
                      height: 340,
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
                        Text('Find a Pet', style: Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(width: AppSpacing.md),
                        Container(width: 4, height: 32, color: AppColors.critical),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (adoption.isEmpty)
                    _EmptySection(message: 'No pets for adoption within this distance')
                  else
                    AdoptionCard(pet: adoption.first),

                  // MARKETPLACE
                  const SizedBox(height: AppSpacing.lg),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Row(
                      children: [
                        Text('Marketplace', style: Theme.of(context).textTheme.headlineMedium),
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
                                    Text(p.name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
                                    Text('${p.price.toInt()} ${p.currency}',
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
                      onPressed: () => Fluttertoast.showToast(msg: 'Navigate to Market tab'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(double.infinity, 48),
                        side: const BorderSide(color: AppColors.border),
                        shape: const StadiumBorder(),
                      ),
                      child: Text('See all in Marketplace →', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptySection extends StatelessWidget {
  final String message;
  const _EmptySection({required this.message});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
      child: Center(
        child: Text(
          message,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
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
  bool _boosted = false;
  late int _boosts;

  @override
  void initState() {
    super.initState();
    _boosts = widget.animal.boostCount;
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.animal;
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
              Positioned(
                top: AppSpacing.sm,
                left: AppSpacing.sm,
                child: Row(
                  children: [
                    if (a.isUrgent)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: AppColors.critical, borderRadius: BorderRadius.circular(AppRadius.chip)),
                        child: const Text('CRITICAL', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
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
                        a.description.contains('.') ? a.description.substring(a.description.indexOf('.') + 2) : '',
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
                Text('km', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
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
                    onTap: () => setState(() {
                      _boosted = !_boosted;
                      _boosts += _boosted ? 1 : -1;
                    }),
                    child: _SmallActionBtn(icon: Icons.arrow_upward, label: '$_boosts  ${_boosted ? 'Boosted' : 'Boost'}', color: _boosted ? AppColors.primary : AppColors.textMuted),
                  ),
                ),
                const Spacer(),
                _SmallActionBtn(icon: Icons.flag_outlined, label: 'Report', color: AppColors.textMuted),
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
