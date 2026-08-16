import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/feed_post.dart';
import '../models/post.dart';
import '../services/browse_location_service.dart';
import '../services/feed_location_resolver.dart';
import '../services/graphql_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/skeleton_loader.dart';
import '../widgets/top_bar.dart';
import 'post_form_screen.dart';
import 'product_detail_screen.dart';

enum _SortOption { hot, newest }

/// A fixed-choice category: (canonical ProductCategory enum value, English label, Arabic label).
typedef _CategoryChoice = (String value, String en, String ar);

class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key});

  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  static const List<_CategoryChoice> _categories = [
    ('ALL', 'All', 'الكل'),
    ('CARE', 'Care', 'رعاية'),
    ('FOOD', 'Food', 'طعام'),
    ('TRANSPORT', 'Transport', 'نقل'),
    ('ACCESSORIES', 'Accessories', 'إكسسوارات'),
    ('GROOMING', 'Grooming', 'تجميل'),
    ('MEDICAL_SUPPLIES', 'Medical Supplies', 'مستلزمات طبية'),
    ('OTHER', 'Other', 'أخرى'),
  ];

  final _searchController = TextEditingController();
  String _query = '';
  String _category = 'ALL';
  _SortOption _sort = _SortOption.hot;

  bool _loading = true;
  String? _errorMessage;
  List<FeedPost> _posts = [];
  Position? _position;
  bool _initialized = false;
  double? _lastRadius;
  Object? _lastBrowseCityId;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final browseCityId = context.watch<BrowseLocationService>().selectedCity?['id'];
    if (!_initialized) {
      _initialized = true;
      _lastRadius = maxDist;
      _lastBrowseCityId = browseCityId;
      _loadFeed();
    } else if (maxDist != _lastRadius || browseCityId != _lastBrowseCityId) {
      _lastRadius = maxDist;
      _lastBrowseCityId = browseCityId;
      _loadFeed();
    }
  }

  Future<void> _loadFeed() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    final graphql = context.read<GraphQLService>();
    final resolved = await resolveFeedLocation(
      browseLocationService: context.read<BrowseLocationService>(),
      locationService: context.read<LocationService>(),
      graphql: graphql,
    );
    if (!mounted) return;
    _position = resolved.position;
    final governorate = resolved.governorate;
    final cityId = resolved.cityId;

    if (governorate == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _errorMessage = t(context, 'Set your city in your profile to see nearby listings.', 'حدد مدينتك في ملفك الشخصي لرؤية الإعلانات القريبة.');
        });
      }
      return;
    }
    if (!mounted) return;

    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, error) = await graphql.fetchMarketFeed(
      governorate: governorate,
      cityId: cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
      category: _category == 'ALL' ? null : _category,
      sort: _sort == _SortOption.hot ? 'HOT' : 'NEWEST',
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

  Future<bool> _toggleSave(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(post.id);
    if (!mounted) return false;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return false;
    }
    setState(() {
      _posts = _posts.map((p) => p.id == post.id ? p.copyWith(saveCount: count, isSavedByMe: saved) : p).toList();
    });
    return true;
  }

  void _selectCategory(String value) {
    setState(() => _category = value);
    _loadFeed();
  }

  void _selectSort(_SortOption o) {
    setState(() => _sort = o);
    _loadFeed();
  }

  List<FeedPost> get _filtered {
    var list = _posts;
    final q = _query.trim().toLowerCase();
    if (q.isNotEmpty) {
      list = list.where((p) => p.title.toLowerCase().contains(q) || p.description.toLowerCase().contains(q)).toList();
    }
    return list;
  }

  String _sortLabel(BuildContext context, _SortOption o) {
    switch (o) {
      case _SortOption.hot:
        return t(context, 'Most popular', 'الأكثر رواجًا');
      case _SortOption.newest:
        return t(context, 'Newest', 'الأحدث');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
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
                          hintText: t(context, 'Search listings...', 'ابحث في الإعلانات...'),
                          hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            const DistanceFilter(),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _loadFeed,
                color: AppColors.primary,
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 100),
                  children: [
                    const SizedBox(height: AppSpacing.lg),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      child: Row(
                        children: [
                          Text(t(context, 'Marketplace', 'السوق'), style: Theme.of(context).textTheme.headlineMedium),
                          const SizedBox(width: AppSpacing.md),
                          Container(width: 4, height: 32, color: AppColors.sectionLineGreen),
                          const Spacer(),
                          PopupMenuButton<_SortOption>(
                            initialValue: _sort,
                            onSelected: _selectSort,
                            itemBuilder: (context) => _SortOption.values
                                .map((o) => PopupMenuItem(value: o, child: Text(_sortLabel(context, o))))
                                .toList(),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.sort, size: 16, color: AppColors.textSecondary),
                                const SizedBox(width: 4),
                                Text(_sortLabel(context, _sort), style: Theme.of(context).textTheme.bodySmall),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    // Category chips
                    SizedBox(
                      height: 40,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        children: _categories.map((c) {
                          final active = _category == c.$1;
                          return Padding(
                            padding: const EdgeInsets.only(right: AppSpacing.sm),
                            child: GestureDetector(
                              onTap: () => _selectCategory(c.$1),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                                decoration: BoxDecoration(
                                  color: active ? AppColors.primary : AppColors.surface,
                                  borderRadius: BorderRadius.circular(AppRadius.chip),
                                  border: Border.all(color: active ? AppColors.primary : AppColors.border),
                                ),
                                child: Text(t(context, c.$2, c.$3),
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: active ? Colors.white : AppColors.textPrimary,
                                    )),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    // Sell banner
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      child: GestureDetector(
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const PostFormScreen(type: PostType.product)),
                          );
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(AppRadius.card),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 32,
                                height: 32,
                                decoration: BoxDecoration(border: Border.all(color: AppColors.border), shape: BoxShape.circle),
                                child: const Icon(Icons.add, size: 18, color: AppColors.textSecondary),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(t(context, 'Have something to sell?', 'لديك شيء تريد بيعه؟'), style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                                    Text(t(context, 'Buyers contact you directly — no middleman', 'يتواصل معك المشترون مباشرة — بدون وسيط'), style: Theme.of(context).textTheme.bodySmall),
                                  ],
                                ),
                              ),
                              const Icon(Icons.chevron_right, color: AppColors.textMuted),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Builder(
                      builder: (context) {
                        final maxDist = DistanceProvider.of(context).maxDistance;
                        final kmLabel = t(context, 'km', 'كم');
                        final distLabel = maxDist.isFinite ? '${maxDist.toInt()}$kmLabel' : '50+$kmLabel';
                        return Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                          child: RichText(
                            text: TextSpan(
                              style: Theme.of(context).textTheme.bodySmall,
                              children: [
                                TextSpan(text: t(context, 'Listings within ', 'إعلانات ضمن ')),
                                TextSpan(text: distLabel, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
                                TextSpan(text: t(context, ' of you', ' منك')),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    // Listings grid
                    if (_loading && _posts.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        child: GridView.count(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          crossAxisCount: 2,
                          mainAxisSpacing: AppSpacing.md,
                          crossAxisSpacing: AppSpacing.md,
                          childAspectRatio: 0.82,
                          children: const [
                            GridTileSkeleton(),
                            GridTileSkeleton(),
                            GridTileSkeleton(),
                            GridTileSkeleton(),
                          ],
                        ),
                      )
                    else if (_errorMessage != null && _posts.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xxl),
                        child: Center(
                          child: Column(
                            children: [
                              const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                              const SizedBox(height: AppSpacing.sm),
                              Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                              const SizedBox(height: AppSpacing.md),
                              OutlinedButton(onPressed: _loadFeed, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                            ],
                          ),
                        ),
                      )
                    else
                      Builder(builder: (context) {
                        final filtered = _filtered;
                        if (filtered.isEmpty) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xxl),
                            child: Center(
                              child: Column(
                                children: [
                                  const Icon(Icons.search_off, size: 48, color: AppColors.textMuted),
                                  const SizedBox(height: AppSpacing.md),
                                  Text(
                                    t(context, 'No listings match your search', 'لا توجد إعلانات مطابقة لبحثك'),
                                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                    textAlign: TextAlign.center,
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    t(context, 'Try a different category or search term', 'جرّب فئة أو كلمة بحث مختلفة'),
                                    style: Theme.of(context).textTheme.bodySmall,
                                    textAlign: TextAlign.center,
                                  ),
                                ],
                              ),
                            ),
                          );
                        }
                        return GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            mainAxisSpacing: AppSpacing.md,
                            crossAxisSpacing: AppSpacing.md,
                            childAspectRatio: 0.82,
                          ),
                          itemCount: filtered.length,
                          itemBuilder: (context, i) {
                            final p = filtered[i];
                            final sold = p.status == 'SOLD';
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
                                      child: Stack(
                                        children: [
                                          Positioned.fill(
                                            child: ClipRRect(
                                              borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                                              child: Opacity(
                                                opacity: sold ? 0.5 : 1,
                                                child: ImageWithFallback(url: p.primaryImageUrl ?? '', width: double.infinity),
                                              ),
                                            ),
                                          ),
                                          if (sold)
                                            PositionedDirectional(
                                              top: AppSpacing.sm,
                                              start: AppSpacing.sm,
                                              child: Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                                decoration: BoxDecoration(color: AppColors.critical, borderRadius: BorderRadius.circular(AppRadius.chip)),
                                                child: Text(t(context, 'SOLD', 'مباع'), style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                                              ),
                                            ),
                                          PositionedDirectional(
                                            top: AppSpacing.sm,
                                            end: AppSpacing.sm,
                                            child: Container(
                                              width: 28,
                                              height: 28,
                                              decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                                              child: Center(
                                                child: AnimatedFavoriteIcon(
                                                  isSaved: p.isSavedByMe,
                                                  onToggle: () => _toggleSave(p),
                                                  semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
                                                  semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
                                                  filledIcon: Icons.bookmark,
                                                  outlineIcon: Icons.bookmark_border,
                                                  activeColor: AppColors.primary,
                                                  inactiveColor: AppColors.primary,
                                                  size: 15,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ],
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
                        );
                      }),
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
