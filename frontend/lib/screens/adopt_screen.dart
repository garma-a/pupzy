import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../main.dart';
import '../models/feed_post.dart';
import '../services/browse_location_service.dart';
import '../services/feed_location_resolver.dart';
import '../services/graphql_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../widgets/adaptive_search_bar.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/skeleton_loader.dart';
import '../widgets/top_bar.dart';
import 'adoption_detail_screen.dart';
import 'mating_detail_screen.dart';

class AdoptScreen extends StatefulWidget {
  // Whether this tab is the one currently shown by the bottom nav — see
  // HomeScreen.active for why this matters.
  final bool active;
  const AdoptScreen({super.key, this.active = true});

  @override
  State<AdoptScreen> createState() => _AdoptScreenState();
}

class _AdoptScreenState extends State<AdoptScreen> with RouteAware {
  String _query = '';
  bool _loading = true;
  String? _errorMessage;
  List<FeedPost> _posts = [];
  Position? _position;
  bool _initialized = false;
  double? _lastRadius;
  Object? _lastBrowseCityId;
  String? _governorate;
  String? _cityId;
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  final _scrollController = ScrollController();

  bool _matingLoading = true;
  String? _matingErrorMessage;
  List<FeedPost> _matingPosts = [];
  String? _matingEndCursor;
  bool _matingHasNextPage = false;
  bool _matingLoadingMore = false;
  final _matingScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _matingScrollController.addListener(_onMatingScroll);
    _loadMatingFeed();
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _matingScrollController.removeListener(_onMatingScroll);
    _matingScrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_loading || _loadingMore || !_hasNextPage || _query.trim().isNotEmpty) return;
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 400) {
      _loadMore();
    }
  }

  void _onMatingScroll() {
    if (_matingLoading || _matingLoadingMore || !_matingHasNextPage || _query.trim().isNotEmpty) return;
    if (_matingScrollController.position.pixels >= _matingScrollController.position.maxScrollExtent - 400) {
      _loadMoreMating();
    }
  }

  /// Fires when a route pushed on top of Adopt (an adoption or mating detail
  /// screen) is popped — quietly re-sync so a save made there shows up immediately.
  @override
  void didPopNext() {
    _refreshFeedQuietly();
    _refreshMatingFeedQuietly();
  }

  /// Re-fetches just the first page and patches matching posts already in
  /// [_posts] with fresh data, without touching loading/pagination state.
  Future<void> _refreshFeedQuietly() async {
    if (_governorate == null) return;
    final graphql = context.read<GraphQLService>();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, _, _, error) = await graphql.fetchAdoptFeed(
      governorate: _governorate!,
      cityId: _cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
    );
    if (!mounted || error != null) return;
    final byId = {for (final p in posts) p.id: p};
    setState(() {
      _posts = _posts.map((p) => byId[p.id] ?? p).toList();
    });
  }

  /// Re-fetches just the first page of the Matching tab and patches matching
  /// posts already in [_matingPosts] with fresh data.
  Future<void> _refreshMatingFeedQuietly() async {
    final graphql = context.read<GraphQLService>();
    final (posts, _, _, error) = await graphql.fetchMatingFeed(cityId: _cityId);
    if (!mounted || error != null) return;
    final byId = {for (final p in posts) p.id: p};
    setState(() {
      _matingPosts = _matingPosts.map((p) => byId[p.id] ?? p).toList();
    });
  }

  @override
  void didUpdateWidget(covariant AdoptScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      _refreshFeedQuietly();
      _refreshMatingFeedQuietly();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    routeObserver.subscribe(this, ModalRoute.of(context) as PageRoute);
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
      _loadMatingFeed();
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
    _governorate = resolved.governorate;
    _cityId = resolved.cityId;

    if (_governorate == null) {
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
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchAdoptFeed(
      governorate: _governorate!,
      cityId: _cityId,
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
        _endCursor = endCursor;
        _hasNextPage = hasNextPage;
      }
    });
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage || _governorate == null) return;
    setState(() => _loadingMore = true);
    final graphql = context.read<GraphQLService>();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final (more, endCursor, hasNextPage, error) = await graphql.fetchAdoptFeed(
      governorate: _governorate!,
      cityId: _cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
      after: _endCursor,
    );
    if (!mounted) return;
    setState(() {
      _loadingMore = false;
      if (error == null) {
        _posts = [..._posts, ...more];
        _endCursor = endCursor;
        _hasNextPage = hasNextPage;
      }
    });
  }

  /// Loads the Matching tab's first page. Unlike the Adoption feed, mating
  /// listings aren't governorate-scoped — this can run independently of
  /// location resolution, optionally narrowed to the browse city once known.
  Future<void> _loadMatingFeed() async {
    if (!mounted) return;
    setState(() {
      _matingLoading = true;
      _matingErrorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchMatingFeed(cityId: _cityId);
    if (!mounted) return;
    setState(() {
      _matingLoading = false;
      if (error != null) {
        _matingErrorMessage = error;
      } else {
        _matingPosts = posts;
        _matingEndCursor = endCursor;
        _matingHasNextPage = hasNextPage;
      }
    });
  }

  Future<void> _loadMoreMating() async {
    if (_matingLoadingMore || !_matingHasNextPage) return;
    setState(() => _matingLoadingMore = true);
    final graphql = context.read<GraphQLService>();
    final (more, endCursor, hasNextPage, error) = await graphql.fetchMatingFeed(cityId: _cityId, after: _matingEndCursor);
    if (!mounted) return;
    setState(() {
      _matingLoadingMore = false;
      if (error == null) {
        _matingPosts = [..._matingPosts, ...more];
        _matingEndCursor = endCursor;
        _matingHasNextPage = hasNextPage;
      }
    });
  }

  List<FeedPost> get _filtered => _posts.where((p) => p.matchesQuery(_query)).toList();
  List<FeedPost> get _matingFiltered => _matingPosts.where((p) => p.matchesQuery(_query)).toList();

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

  Future<bool> _toggleSaveMating(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(post.id);
    if (!mounted) return false;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return false;
    }
    setState(() {
      _matingPosts = _matingPosts.map((p) => p.id == post.id ? p.copyWith(saveCount: count, isSavedByMe: saved) : p).toList();
    });
    return true;
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
                child: AdaptiveSearchBar(
                  hintText: t(context, 'Search pets by breed, name, or location...', 'ابحث عن حيوانات بالسلالة أو الاسم أو الموقع...'),
                  onChanged: (v) => setState(() => _query = v),
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
                      onRefresh: _loadFeed,
                      color: AppColors.primary,
                      child: _loading && _posts.isEmpty
                          ? ListView(
                              padding: const EdgeInsets.only(top: AppSpacing.sm),
                              children: const [
                                ListCardSkeleton(imageHeight: 220),
                                ListCardSkeleton(imageHeight: 220),
                              ],
                            )
                          : _errorMessage != null && _posts.isEmpty
                              ? Center(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
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
                              : Builder(builder: (context) {
                                  final filtered = _filtered;
                                  if (filtered.isEmpty) {
                                    final searching = _query.trim().isNotEmpty;
                                    return ListView(
                                      padding: const EdgeInsets.only(bottom: 100),
                                      children: [
                                        Padding(
                                          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                                          child: Center(
                                            child: Column(
                                              children: [
                                                Icon(searching ? Icons.search_off : Icons.pets_outlined, size: 48, color: AppColors.textMuted),
                                                const SizedBox(height: AppSpacing.md),
                                                Text(
                                                  searching
                                                      ? t(context, 'No results for "${_query.trim()}"', 'لا توجد نتائج لـ "${_query.trim()}"')
                                                      : t(context, 'No pets for adoption within this distance', 'لا توجد حيوانات للتبني ضمن هذه المسافة'),
                                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                                  textAlign: TextAlign.center,
                                                ),
                                                const SizedBox(height: 4),
                                                Text(
                                                  searching
                                                      ? t(context, 'Try a different search term', 'جرّب كلمة بحث مختلفة')
                                                      : t(context, 'Try widening your distance filter', 'جرّب توسيع نطاق المسافة'),
                                                  style: Theme.of(context).textTheme.bodySmall,
                                                  textAlign: TextAlign.center,
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    );
                                  }
                                  return ListView.builder(
                                    controller: _scrollController,
                                    padding: const EdgeInsets.only(bottom: 100),
                                    itemCount: filtered.length + (_loadingMore ? 1 : 0),
                                    itemBuilder: (_, i) {
                                      if (i >= filtered.length) {
                                        return const Padding(
                                          padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                                          child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                                        );
                                      }
                                      return _AdoptFeedCard(
                                        key: ValueKey(filtered[i].id),
                                        post: filtered[i],
                                        onSave: () => _toggleSave(filtered[i]),
                                        onTap: () => Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => AdoptionDetailScreen(postId: filtered[i].id)),
                                        ),
                                      );
                                    },
                                  );
                                }),
                    ),
                    RefreshIndicator(
                      onRefresh: _loadMatingFeed,
                      color: AppColors.primary,
                      child: _matingLoading && _matingPosts.isEmpty
                          ? ListView(
                              padding: const EdgeInsets.only(top: AppSpacing.sm),
                              children: const [
                                ListCardSkeleton(imageHeight: 220),
                                ListCardSkeleton(imageHeight: 220),
                              ],
                            )
                          : _matingErrorMessage != null && _matingPosts.isEmpty
                              ? Center(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                                        const SizedBox(height: AppSpacing.sm),
                                        Text(_matingErrorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                                        const SizedBox(height: AppSpacing.md),
                                        OutlinedButton(onPressed: _loadMatingFeed, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                                      ],
                                    ),
                                  ),
                                )
                              : Builder(builder: (context) {
                                  final filtered = _matingFiltered;
                                  if (filtered.isEmpty) {
                                    final searching = _query.trim().isNotEmpty;
                                    return ListView(
                                      padding: const EdgeInsets.only(bottom: 100),
                                      children: [
                                        Padding(
                                          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                                          child: Center(
                                            child: Column(
                                              children: [
                                                Icon(searching ? Icons.search_off : Icons.favorite_border, size: 48, color: AppColors.textMuted),
                                                const SizedBox(height: AppSpacing.md),
                                                Text(
                                                  searching
                                                      ? t(context, 'No results for "${_query.trim()}"', 'لا توجد نتائج لـ "${_query.trim()}"')
                                                      : t(context, 'No mating listings yet', 'لا توجد إعلانات تزاوج بعد'),
                                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                                  textAlign: TextAlign.center,
                                                ),
                                                const SizedBox(height: 4),
                                                Text(
                                                  searching
                                                      ? t(context, 'Try a different search term', 'جرّب كلمة بحث مختلفة')
                                                      : t(context, 'Check back soon or post your own', 'تحقق مرة أخرى قريبًا أو انشر إعلانك'),
                                                  style: Theme.of(context).textTheme.bodySmall,
                                                  textAlign: TextAlign.center,
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    );
                                  }
                                  return ListView.builder(
                                    controller: _matingScrollController,
                                    padding: const EdgeInsets.only(bottom: 100),
                                    itemCount: filtered.length + (_matingLoadingMore ? 1 : 0),
                                    itemBuilder: (_, i) {
                                      if (i >= filtered.length) {
                                        return const Padding(
                                          padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                                          child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                                        );
                                      }
                                      return _MatingFeedCard(
                                        key: ValueKey(filtered[i].id),
                                        post: filtered[i],
                                        onSave: () => _toggleSaveMating(filtered[i]),
                                        onTap: () => Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => MatingDetailScreen(postId: filtered[i].id)),
                                        ),
                                      );
                                    },
                                  );
                                }),
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

/// Adoption feed-list card built from base Post fields only — breed/age/
/// personality tags require the detail screen's extension-type query.
class _AdoptFeedCard extends StatelessWidget {
  final FeedPost post;
  final Future<bool> Function() onSave;
  final VoidCallback onTap;
  const _AdoptFeedCard({super.key, required this.post, required this.onSave, required this.onTap});

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
                PositionedDirectional(
                  top: AppSpacing.sm,
                  end: AppSpacing.sm,
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                    child: Center(
                      child: AnimatedFavoriteIcon(
                        isSaved: post.isSavedByMe,
                        onToggle: onSave,
                        semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
                        semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
                        activeColor: AppColors.critical,
                        inactiveColor: AppColors.textMuted,
                        size: 18,
                      ),
                    ),
                  ),
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
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.md),
              child: Text(post.description, style: Theme.of(context).textTheme.bodyMedium, maxLines: 3, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}

/// Mating feed-list card built from base Post fields only — species/breed/
/// gender/age require the detail screen's `matingPostDetail` query.
class _MatingFeedCard extends StatelessWidget {
  final FeedPost post;
  final Future<bool> Function() onSave;
  final VoidCallback onTap;
  const _MatingFeedCard({super.key, required this.post, required this.onSave, required this.onTap});

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
                PositionedDirectional(
                  top: AppSpacing.sm,
                  end: AppSpacing.sm,
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                    child: Center(
                      child: AnimatedFavoriteIcon(
                        isSaved: post.isSavedByMe,
                        onToggle: onSave,
                        semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
                        semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
                        activeColor: AppColors.critical,
                        inactiveColor: AppColors.textMuted,
                        size: 18,
                      ),
                    ),
                  ),
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
                          t(context, 'SEEKING A MATE', 'يبحث عن شريك'),
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
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.md),
              child: Text(post.description, style: Theme.of(context).textTheme.bodyMedium, maxLines: 3, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}
