import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../main.dart';
import '../models/feed_post.dart';
import '../models/vet_clinic.dart';
import '../services/browse_location_service.dart';
import '../services/feed_location_resolver.dart';
import '../services/graphql_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../widgets/adaptive_search_bar.dart';
import '../widgets/adoption_application_sheet.dart';
import '../widgets/animated_boost_chip.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/blurred_thumbnail.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/saved_post_card.dart';
import '../widgets/skeleton_loader.dart';
import '../widgets/top_bar.dart';
import 'adoption_detail_screen.dart';
import 'product_detail_screen.dart';
import 'rescue_detail_screen.dart';
import 'saved_posts_screen.dart';
import 'vets_screen.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback? onNavigateToMarket;
  // Whether this tab is the one currently shown by the bottom nav — Home
  // stays mounted in the background (IndexedStack) even when another tab is
  // active, so this is how it knows to refresh FAVORITES when the user
  // switches back after saving a post from a different tab or detail screen.
  final bool active;
  const HomeScreen({super.key, this.onNavigateToMarket, this.active = true});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with RouteAware {
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
  List<FeedPost> _savedPosts = [];
  bool _savedLoading = true;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadSavedPosts();
  }

  @override
  void didUpdateWidget(covariant HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Just switched back to this tab — pick up any saves/boosts made
    // elsewhere (another tab, a detail screen) while Home was backgrounded.
    if (widget.active && !oldWidget.active) {
      _loadSavedPosts();
      _refreshFeedQuietly();
    }
  }

  Future<void> _loadSavedPosts() async {
    final graphql = context.read<GraphQLService>();
    final (posts, _, _, error) = await graphql.fetchMySavedPosts(first: 10);
    if (!mounted) return;
    setState(() {
      _savedLoading = false;
      if (error == null) _savedPosts = posts;
    });
  }

  Future<bool> _toggleSavedPost(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(post.id);
    if (!mounted) return false;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return false;
    }
    if (!saved) {
      setState(() => _savedPosts = _savedPosts.where((p) => p.id != post.id).toList());
    }
    // Keep the main feed's isSavedByMe/saveCount in sync if the same post is
    // also showing there (e.g. a rescue post saved from its feed card).
    setState(() {
      _posts = _posts.map((p) => p.id == post.id ? p.copyWith(saveCount: count, isSavedByMe: saved) : p).toList();
    });
    return true;
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_loading || _loadingMore || !_hasNextPage || _query.trim().isNotEmpty) return;
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 400) {
      _loadMore();
    }
  }

  /// Fires when a route pushed on top of Home (any post detail screen) is
  /// popped — refresh FAVORITES, and quietly re-sync the main feed too, so a
  /// save/boost made on the detail screen is reflected on its feed card
  /// immediately instead of only after a manual pull-to-refresh.
  @override
  void didPopNext() {
    _loadSavedPosts();
    _refreshFeedQuietly();
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
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchHomeFeed(
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

  /// Re-fetches just the first page and patches matching posts already in
  /// [_posts] with fresh data (save/boost state, counts, status) — used on
  /// return from a detail screen. Unlike [_loadFeed], this never touches
  /// [_loading]/pagination state, so it's invisible unless something the
  /// viewer already sees actually changed.
  Future<void> _refreshFeedQuietly() async {
    if (_governorate == null) return;
    final graphql = context.read<GraphQLService>();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, _, _, error) = await graphql.fetchHomeFeed(
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

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage || _governorate == null) return;
    setState(() => _loadingMore = true);
    final graphql = context.read<GraphQLService>();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final (more, endCursor, hasNextPage, error) = await graphql.fetchHomeFeed(
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

  Future<bool> _toggleUpvote(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, upvoted, error) = await graphql.toggleUpvote(post.id);
    if (!mounted) return false;
    if (error != null || count == null || upvoted == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update boost. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.'));
      return false;
    }
    setState(() {
      _posts = _posts.map((p) => p.id == post.id ? p.copyWith(upvoteCount: count, isUpvotedByMe: upvoted) : p).toList();
    });
    return true;
  }

  Future<bool> _toggleSave(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(post.id);
    if (!mounted) return false;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return false;
    }
    final updated = post.copyWith(saveCount: count, isSavedByMe: saved);
    setState(() {
      _posts = _posts.map((p) => p.id == post.id ? updated : p).toList();
      // Keep the FAVORITES row in sync too — saving from a feed card should
      // show up there immediately, not just after the next full reload.
      if (saved) {
        _savedPosts = _savedPosts.any((p) => p.id == post.id)
            ? _savedPosts.map((p) => p.id == post.id ? updated : p).toList()
            : [updated, ..._savedPosts];
      } else {
        _savedPosts = _savedPosts.where((p) => p.id != post.id).toList();
      }
    });
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final helpPosts = _posts.where((p) => p.postType == 'RESCUE').toList();
    final urgent = helpPosts.where((p) => p.isUrgent).toList();
    final findPosts = _posts.where((p) => p.postType == 'LOST').toList();
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
                    child: AdaptiveSearchBar(
                      hintText: t(context, 'Search pets, posts, listings...', 'ابحث عن حيوانات، منشورات، إعلانات...'),
                      onChanged: (v) => setState(() => _query = v),
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
                        padding: const EdgeInsets.only(bottom: 100),
                        children: [
                          const SizedBox(height: AppSpacing.md),
                          SizedBox(
                            height: 270,
                            child: ListView(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                              children: const [HorizontalCardSkeleton(), HorizontalCardSkeleton()],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          SizedBox(
                            height: 270,
                            child: ListView(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                              children: const [HorizontalCardSkeleton(), HorizontalCardSkeleton()],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          const ListCardSkeleton(imageHeight: 220),
                          const SizedBox(height: AppSpacing.lg),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                            child: GridView.count(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              crossAxisCount: 2,
                              mainAxisSpacing: AppSpacing.md,
                              crossAxisSpacing: AppSpacing.md,
                              childAspectRatio: 0.75,
                              children: const [GridTileSkeleton(), GridTileSkeleton()],
                            ),
                          ),
                        ],
                      )
                    : _errorMessage != null && _posts.isEmpty
                        ? ListView(
                            children: [
                              const SizedBox(height: 120),
                              _FeedErrorState(message: _errorMessage!, onRetry: _loadFeed),
                            ],
                          )
                        : _query.trim().isNotEmpty
                            ? _HomeSearchResults(query: _query, posts: _posts)
                            : ListView(
                            controller: _scrollController,
                            padding: const EdgeInsets.only(bottom: 100),
                            children: [
                              const DistanceFilter(),
                              const SizedBox(height: AppSpacing.md),
                              // FAVORITES
                              if (_savedLoading || _savedPosts.isNotEmpty) ...[
                                _SectionHeader(
                                  leading: const Icon(Icons.favorite, size: 16, color: AppColors.critical),
                                  title: t(context, 'FAVORITES', 'المفضلة'),
                                  trailing: GestureDetector(
                                    onTap: () => Navigator.of(context).push(
                                      MaterialPageRoute(builder: (_) => const SavedPostsScreen()),
                                    ),
                                    child: Text(t(context, 'See more →', 'المزيد ←'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600)),
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                SizedBox(
                                  height: 190,
                                  child: _savedLoading
                                      ? ListView(
                                          scrollDirection: Axis.horizontal,
                                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                                          children: const [
                                            HorizontalCardSkeleton(width: 150, height: 190),
                                            HorizontalCardSkeleton(width: 150, height: 190),
                                          ],
                                        )
                                      : ListView.builder(
                                          scrollDirection: Axis.horizontal,
                                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                                          itemCount: _savedPosts.length,
                                          itemBuilder: (_, i) => SavedPostCard(
                                            key: ValueKey(_savedPosts[i].id),
                                            post: _savedPosts[i],
                                            onToggleSave: () => _toggleSavedPost(_savedPosts[i]),
                                          ),
                                        ),
                                ),
                              ],

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
                              if (helpPosts.isEmpty)
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
                                    itemCount: helpPosts.length,
                                    itemBuilder: (_, i) => _HomeRescueCard(
                                      key: ValueKey(helpPosts[i].id),
                                      post: helpPosts[i],
                                      onBoost: () => _toggleUpvote(helpPosts[i]),
                                      onSave: () => _toggleSave(helpPosts[i]),
                                      onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: helpPosts[i].id)),
                                      ),
                                    ),
                                  ),
                                ),

                              // FIND A PET (Lost & Found)
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
                              if (findPosts.isEmpty)
                                _EmptySection(
                                  icon: Icons.search_outlined,
                                  message: t(context, 'No lost or found pets within this distance', 'لا توجد حيوانات مفقودة أو موجودة ضمن هذه المسافة'),
                                )
                              else
                                SizedBox(
                                  height: 270,
                                  child: ListView.builder(
                                    scrollDirection: Axis.horizontal,
                                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                                    itemCount: findPosts.length,
                                    itemBuilder: (_, i) => _HomeRescueCard(
                                      key: ValueKey(findPosts[i].id),
                                      post: findPosts[i],
                                      onBoost: () => _toggleUpvote(findPosts[i]),
                                      onSave: () => _toggleSave(findPosts[i]),
                                      onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: findPosts[i].id)),
                                      ),
                                    ),
                                  ),
                                ),

                              // ADOPT A PET
                              const SizedBox(height: AppSpacing.lg),
                              Padding(
                                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                                child: Row(
                                  children: [
                                    Text(t(context, 'Adopt a Pet', 'تبنَّ حيوانًا'), style: Theme.of(context).textTheme.headlineMedium),
                                    const SizedBox(width: AppSpacing.md),
                                    Container(width: 4, height: 32, color: AppColors.primary),
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
                                  onSave: () => _toggleSave(adoption.first),
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
                                      key: ValueKey(p.id),
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
                                                  ClipRRect(
                                                    borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                                                    child: ImageWithFallback(url: p.primaryImageUrl ?? '', width: double.infinity),
                                                  ),
                                                  PositionedDirectional(
                                                    top: AppSpacing.xs,
                                                    end: AppSpacing.xs,
                                                    child: Container(
                                                      width: 26,
                                                      height: 26,
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
                                                          inactiveColor: AppColors.textMuted,
                                                          size: 14,
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
                              if (_loadingMore)
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                                  child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
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

/// Flat cross-type results list shown in place of the curated home sections
/// while a search query is active.
class _HomeSearchResults extends StatelessWidget {
  final String query;
  final List<FeedPost> posts;
  const _HomeSearchResults({required this.query, required this.posts});

  @override
  Widget build(BuildContext context) {
    final results = posts.where((p) => p.matchesQuery(query)).toList();
    if (results.isEmpty) {
      return ListView(
        padding: const EdgeInsets.only(bottom: 100),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
            child: Center(
              child: Column(
                children: [
                  const Icon(Icons.search_off, size: 48, color: AppColors.textMuted),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    t(context, 'No results for "${query.trim()}"', 'لا توجد نتائج لـ "${query.trim()}"'),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    t(context, 'Try a different search term', 'جرّب كلمة بحث مختلفة'),
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
      padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: 100),
      itemCount: results.length,
      itemBuilder: (context, i) => _HomeSearchResultTile(key: ValueKey(results[i].id), post: results[i]),
    );
  }
}

class _HomeSearchResultTile extends StatelessWidget {
  final FeedPost post;
  const _HomeSearchResultTile({super.key, required this.post});

  String _typeLabel(BuildContext context) {
    switch (post.postType) {
      case 'RESCUE':
        return t(context, 'Rescue', 'إنقاذ');
      case 'LOST':
        return t(context, 'Lost & Found', 'مفقود');
      case 'ADOPTION':
        return t(context, 'Adoption', 'تبني');
      case 'PRODUCT':
        return t(context, 'Marketplace', 'السوق');
      default:
        return post.postType;
    }
  }

  Color _typeColor() {
    switch (post.postType) {
      case 'RESCUE':
      case 'LOST':
        return AppColors.critical;
      case 'ADOPTION':
        return AppColors.sectionLine;
      case 'PRODUCT':
        return AppColors.sectionLineGreen;
      default:
        return AppColors.textMuted;
    }
  }

  void _open(BuildContext context) {
    final Widget screen = switch (post.postType) {
      'ADOPTION' => AdoptionDetailScreen(postId: post.id),
      'PRODUCT' => ProductDetailScreen(postId: post.id),
      _ => RescueDetailScreen(postId: post.id),
    };
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    final cityName = Localizations.localeOf(context).languageCode == 'ar' ? post.cityNameArabic : post.cityNameEnglish;
    final color = _typeColor();
    return GestureDetector(
      onTap: () => _open(context),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xs),
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 8, offset: const Offset(0, 2))],
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.chip),
              child: post.postType == 'RESCUE'
                  ? BlurredThumbnail(imageUrl: post.primaryImageUrl ?? '', width: 64, height: 64)
                  : ImageWithFallback(url: post.primaryImageUrl ?? '', width: 64, height: 64),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppRadius.chip)),
                        child: Text(_typeLabel(context), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
                      ),
                      if (post.distanceKm != null) ...[
                        const SizedBox(width: 6),
                        Text('${post.distanceKm!.toStringAsFixed(1)} ${t(context, 'km', 'كم')}', style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(post.title, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(
                    post.areaName != null ? '${post.areaName}, $cityName' : cityName,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.textMuted),
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

/// Preview of the nearest real vet clinics (via `nearbyVetClinics`), with a
/// "View all vets" link to the full list screen.
class _VetsNearYouSheet extends StatefulWidget {
  const _VetsNearYouSheet();

  @override
  State<_VetsNearYouSheet> createState() => _VetsNearYouSheetState();
}

class _VetsNearYouSheetState extends State<_VetsNearYouSheet> {
  bool _loading = true;
  String? _errorMessage;
  List<VetClinic> _clinics = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final graphql = context.read<GraphQLService>();
    final me = await graphql.fetchMe();
    final cityId = me?['homeCityId'] as String?;
    if (!mounted) return;
    if (cityId == null) {
      setState(() {
        _loading = false;
        _errorMessage = t(context, 'Set your city in your profile to see nearby vets.', 'حدد مدينتك في ملفك الشخصي لرؤية الأطباء البيطريين القريبين.');
      });
      return;
    }
    final (clinics, error) = await graphql.fetchNearbyVetClinics(cityId: cityId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (error != null) {
        _errorMessage = error;
      } else {
        _clinics = clinics;
      }
    });
  }

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
                    t(context, 'Nearest clinics to your city', 'أقرب العيادات إلى مدينتك'),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                      child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                    )
                  else if (_errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                      child: Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
                    )
                  else if (_clinics.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                      child: Text(
                        t(context, 'No vet clinics found near you', 'لا توجد عيادات بيطرية بالقرب منك'),
                        style: Theme.of(context).textTheme.bodyMedium,
                        textAlign: TextAlign.center,
                      ),
                    )
                  else
                    ..._clinics.take(3).map((clinic) {
                      final isArabic = Localizations.localeOf(context).languageCode == 'ar';
                      final name = (isArabic ? clinic.nameArabic : clinic.nameEnglish) ??
                          clinic.nameEnglish ??
                          clinic.nameArabic ??
                          t(context, 'Vet clinic', 'عيادة بيطرية');
                      return Padding(
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
                                child: const Icon(Icons.local_hospital_outlined, color: AppColors.primary, size: 18),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                                    Text(
                                      '${clinic.distanceKm.toStringAsFixed(1)} ${t(context, 'km away', 'كم')}',
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                  const SizedBox(height: AppSpacing.sm),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        Navigator.of(context).push(MaterialPageRoute(builder: (_) => const VetsScreen()));
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
  final Future<bool> Function() onBoost;
  final Future<bool> Function() onSave;
  final VoidCallback onTap;
  const _HomeRescueCard({super.key, required this.post, required this.onBoost, required this.onSave, required this.onTap});

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
                child: post.postType == 'RESCUE'
                    ? BlurredThumbnail(imageUrl: post.primaryImageUrl ?? '', width: 280, height: 180)
                    : ImageWithFallback(url: post.primaryImageUrl ?? '', width: 280, height: 180),
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
              PositionedDirectional(
                top: AppSpacing.sm,
                end: AppSpacing.sm,
                child: Container(
                  width: 30,
                  height: 30,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  child: Center(
                    child: AnimatedFavoriteIcon(
                      isSaved: post.isSavedByMe,
                      onToggle: onSave,
                      semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
                      semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
                      activeColor: AppColors.critical,
                      inactiveColor: AppColors.textMuted,
                      size: 16,
                    ),
                  ),
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
                AnimatedBoostChip(
                  count: post.upvoteCount,
                  boosted: post.isUpvotedByMe,
                  onToggle: onBoost,
                  boostedLabel: t(context, 'Boosted', 'مُعزَّز'),
                  unboostedLabel: t(context, 'Boost', 'تعزيز'),
                  activeColor: AppColors.primary,
                  inactiveColor: AppColors.textMuted,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  iconSize: 13,
                  fontSize: 12,
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
  final Future<bool> Function() onSave;
  final VoidCallback onTap;
  const _HomeAdoptionPreviewCard({required this.post, required this.onSave, required this.onTap});

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

