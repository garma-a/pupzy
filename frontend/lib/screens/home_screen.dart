import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/feed_post.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/adoption_application_sheet.dart';
import '../widgets/adoption_card.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/top_bar.dart';
import 'adoption_detail_screen.dart';
import 'product_detail_screen.dart';
import 'rescue_detail_screen.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback? onNavigateToMarket;
  const HomeScreen({super.key, this.onNavigateToMarket});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _loading = true;
  String? _errorMessage;
  List<FeedPost> _posts = [];
  Position? _position;
  bool _initialized = false;
  double? _lastRadius;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final maxDist = DistanceProvider.of(context).maxDistance;
    if (!_initialized) {
      _initialized = true;
      _lastRadius = maxDist;
      _loadFeed();
    } else if (maxDist != _lastRadius) {
      _lastRadius = maxDist;
      _loadFeed();
    }
  }

  Future<void> _fetchLocation() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return;
      }
      _position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 10)),
      );
    } catch (_) {
      // Location is optional for the home feed — silently fall back to
      // governorate/city-only filtering (no radius, no distanceKm on cards).
    }
  }

  Future<void> _loadFeed() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    if (_position == null) await _fetchLocation();
    if (!mounted) return;

    final graphql = context.read<GraphQLService>();
    final (governorate, cityId) = await graphql.resolveViewerCity();
    if (governorate == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _errorMessage = t(context, 'Set your city in your profile to see nearby posts.', 'حدد مدينتك في ملفك الشخصي لرؤية المنشورات القريبة.');
        });
      }
      return;
    }
    if (!mounted) return;

    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, error) = await graphql.fetchHomeFeed(
      governorate: governorate,
      cityId: cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
    );
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (error != null) {
        _errorMessage = error;
      } else {
        _posts = posts;
      }
    });
  }

  Future<void> _toggleUpvote(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, upvoted, error) = await graphql.toggleUpvote(post.id);
    if (!mounted) return;
    if (error != null || count == null || upvoted == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update boost. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.'));
      return;
    }
    setState(() {
      _posts = _posts.map((p) => p.id == post.id ? p.copyWith(upvoteCount: count, isUpvotedByMe: upvoted) : p).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    final favorites = MockData.favorites;
    final rescueLike = _posts.where((p) => p.postType == 'RESCUE' || p.postType == 'LOST').toList();
    final urgent = rescueLike.where((p) => p.isUrgent).toList();
    final adoption = _posts.where((p) => p.postType == 'ADOPTION').toList();
    final products = _posts.where((p) => p.postType == 'PRODUCT').take(2).toList();

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
                onRefresh: _loadFeed,
                color: AppColors.primary,
                child: _loading && _posts.isEmpty
                    ? ListView(
                        children: const [
                          SizedBox(height: 200),
                          Center(child: CircularProgressIndicator(color: AppColors.primary)),
                        ],
                      )
                    : _errorMessage != null && _posts.isEmpty
                        ? ListView(
                            children: [
                              const SizedBox(height: 120),
                              _FeedErrorState(message: _errorMessage!, onRetry: _loadFeed),
                            ],
                          )
                        : ListView(
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
                              if (urgent.isNotEmpty)
                                _HomeUrgentBanner(
                                  post: urgent.first,
                                  onTap: () => Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: urgent.first.id)),
                                  ),
                                ),
                              const SizedBox(height: AppSpacing.sm),
                              if (rescueLike.isEmpty)
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
                                    itemCount: rescueLike.length,
                                    itemBuilder: (_, i) => _HomeRescueCard(
                                      post: rescueLike[i],
                                      onBoost: () => _toggleUpvote(rescueLike[i]),
                                      onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: rescueLike[i].id)),
                                      ),
                                    ),
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
                                _HomeAdoptionPreviewCard(
                                  post: adoption.first,
                                  onTap: () => Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => AdoptionDetailScreen(postId: adoption.first.id)),
                                  ),
                                ),

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
                              if (products.isEmpty)
                                _EmptySection(
                                  icon: Icons.storefront_outlined,
                                  message: t(context, 'No marketplace listings within this distance', 'لا توجد إعلانات في السوق ضمن هذه المسافة'),
                                )
                              else
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
                                  itemCount: products.length,
                                  itemBuilder: (context, i) {
                                    final p = products[i];
                                    return GestureDetector(
                                      onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => ProductDetailScreen(postId: p.id)),
                                      ),
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
                                                child: ImageWithFallback(url: p.primaryImageUrl ?? '', width: double.infinity),
                                              ),
                                            ),
                                            Padding(
                                              padding: const EdgeInsets.all(AppSpacing.sm),
                                              child: Text(p.title,
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
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

class _FeedErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _FeedErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Column(
        children: [
          const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
          const SizedBox(height: AppSpacing.sm),
          Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton(onPressed: onRetry, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
        ],
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

/// A single critical/urgent RESCUE or LOST post surfaced above the fold.
class _HomeUrgentBanner extends StatelessWidget {
  final FeedPost post;
  final VoidCallback onTap;
  const _HomeUrgentBanner({required this.post, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
                    Container(width: 7, height: 7, decoration: const BoxDecoration(color: AppColors.critical, shape: BoxShape.circle)),
                    const SizedBox(width: 5),
                    Text(t(context, 'CRITICAL', 'حرج'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted, letterSpacing: 0.5)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(post.title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 16), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(post.description, style: Theme.of(context).textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          if (post.distanceKm != null)
            Column(
              children: [
                Text(post.distanceKm!.toStringAsFixed(1), style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 30, color: AppColors.textPrimary)),
                Text(t(context, 'km away', 'كم'), style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
        ],
      ),
      ),
    );
  }
}

class _HomeRescueCard extends StatelessWidget {
  final FeedPost post;
  final VoidCallback onBoost;
  final VoidCallback onTap;
  const _HomeRescueCard({required this.post, required this.onBoost, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
                child: ImageWithFallback(url: post.primaryImageUrl ?? '', width: 280, height: 180),
              ),
              if (post.isUrgent)
                PositionedDirectional(
                  top: AppSpacing.sm,
                  start: AppSpacing.sm,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: AppColors.critical, borderRadius: BorderRadius.circular(AppRadius.chip)),
                    child: Text(t(context, 'CRITICAL', 'حرجة'), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
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
                        post.title,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        post.description,
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
            child: post.distanceKm != null
                ? Row(
                    children: [
                      Text(
                        post.distanceKm!.toStringAsFixed(1),
                        style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 24, fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(width: 3),
                      Text(t(context, 'km', 'كم'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
                    ],
                  )
                : Text(
                    post.areaName ?? (Localizations.localeOf(context).languageCode == 'ar' ? post.cityNameArabic : post.cityNameEnglish),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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
                    onTap: onBoost,
                    child: _SmallActionBtn(
                      icon: Icons.arrow_upward,
                      label: '${post.upvoteCount}  ${post.isUpvotedByMe ? t(context, 'Boosted', 'مُعزَّز') : t(context, 'Boost', 'تعزيز')}',
                      color: post.isUpvotedByMe ? AppColors.primary : AppColors.textMuted,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      ),
    );
  }
}

/// Lightweight "Find a Pet" preview built from feed-level Post fields only —
/// breed/age/personality tags show on the detail screen, which fetches the
/// full AdoptionPost extension data.
class _HomeAdoptionPreviewCard extends StatelessWidget {
  final FeedPost post;
  final VoidCallback onTap;
  const _HomeAdoptionPreviewCard({required this.post, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cityName = Localizations.localeOf(context).languageCode == 'ar' ? post.cityNameArabic : post.cityNameEnglish;
    return GestureDetector(
      onTap: onTap,
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
          Stack(
            children: [
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                child: ImageWithFallback(url: post.primaryImageUrl ?? '', width: double.infinity, height: 300),
              ),
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 32, AppSpacing.lg, AppSpacing.md),
                  decoration: BoxDecoration(
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
                        post.title,
                        style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        post.areaName != null ? '$cityName · ${post.areaName}' : cityName,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
            child: Text(post.description, style: Theme.of(context).textTheme.bodyMedium, maxLines: 3, overflow: TextOverflow.ellipsis),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: ElevatedButton(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.transparent,
                builder: (_) => AdoptionApplicationSheet(postId: post.id),
              ),
              style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
              child: Text(t(context, 'Ask to adopt', 'اطلب التبني')),
            ),
          ),
        ],
      ),
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
