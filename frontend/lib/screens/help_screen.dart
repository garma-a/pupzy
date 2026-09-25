import 'dart:async';

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
import '../services/safety_events.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/adaptive_search_bar.dart';
import '../widgets/animated_boost_chip.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/blurred_thumbnail.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/skeleton_loader.dart';
import '../widgets/top_bar.dart';
import 'rescue_detail_screen.dart';

class HelpScreen extends StatefulWidget {
  // Whether this tab is the one currently shown by the bottom nav — see
  // HomeScreen.active for why this matters (a save/boost made on another
  // tab needs a way to reach this screen's own post list).
  final bool active;
  const HelpScreen({super.key, this.active = true});

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> with RouteAware {
  String _query = '';

  bool _loading = true;
  String? _errorMessage;
  List<FeedPost> _posts = [];
  Position? _position;
  bool _initialized = false;
  double? _lastRadius;
  Object? _lastBrowseCityId;
  int? _lastSafetyVersion;
  String? _governorate;
  String? _cityId;
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  Timer? _searchDebounce;
  bool _searching = false;

  /// The server-side search term, or null under the backend's 2-character
  /// minimum (feed-search-flutter-integration-contract.md §4) — a 0/1
  /// character query behaves as "no search" rather than being sent.
  String? get _activeSearch {
    final trimmed = _query.trim();
    return trimmed.length >= 2 ? trimmed : null;
  }

  void _onSearchChanged(String value) {
    setState(() => _query = value);
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 350), _reloadForSearch);
  }

  Future<void> _reloadForSearch() async {
    if (_governorate == null) return;
    setState(() => _searching = true);
    final graphql = context.read<GraphQLService>();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchHelpFeed(
      governorate: _governorate!,
      cityId: _cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
      search: _activeSearch,
    );
    if (!mounted) return;
    setState(() {
      _searching = false;
      if (error == null) {
        _posts = posts;
        _endCursor = endCursor;
        _hasNextPage = hasNextPage;
      }
    });
  }

  @override
  void didUpdateWidget(covariant HelpScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      _refreshFeedQuietly();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    routeObserver.subscribe(this, ModalRoute.of(context) as PageRoute);
    final maxDist = DistanceProvider.of(context).maxDistance;
    final browseCityId = context.watch<BrowseLocationService>().selectedCity?['id'];
    // A Block/Unblock changes what the server returns for every feed, and a
    // quiet patch-in-place refresh can never remove posts that vanished — so
    // a change in the block list forces a full reload.
    final safetyVersion = context.watch<SafetyEvents>().version;
    final safetyChanged = _lastSafetyVersion != null && safetyVersion != _lastSafetyVersion;
    _lastSafetyVersion = safetyVersion;
    if (!_initialized) {
      _initialized = true;
      _lastRadius = maxDist;
      _lastBrowseCityId = browseCityId;
      _loadFeed();
    } else if (maxDist != _lastRadius || browseCityId != _lastBrowseCityId || safetyChanged) {
      _lastRadius = maxDist;
      _lastBrowseCityId = browseCityId;
      _loadFeed();
    }
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    _searchDebounce?.cancel();
    super.dispose();
  }

  /// Fires when a route pushed on top of Help (a rescue/lost detail screen)
  /// is popped — quietly re-sync so a save/boost made there shows up on its
  /// feed card immediately.
  @override
  void didPopNext() => _refreshFeedQuietly();

  /// Re-fetches just the first page and patches matching posts already in
  /// [_posts] with fresh data, without touching loading/pagination state.
  Future<void> _refreshFeedQuietly() async {
    if (_governorate == null) return;
    final graphql = context.read<GraphQLService>();
    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, _, _, error) = await graphql.fetchHelpFeed(
      governorate: _governorate!,
      cityId: _cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
      search: _activeSearch,
    );
    if (!mounted || error != null) return;
    final byId = {for (final p in posts) p.id: p};
    setState(() {
      _posts = _posts.map((p) => byId[p.id] ?? p).toList();
    });
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
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchHelpFeed(
      governorate: _governorate!,
      cityId: _cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
      search: _activeSearch,
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
    final (more, endCursor, hasNextPage, error) = await graphql.fetchHelpFeed(
      governorate: _governorate!,
      cityId: _cityId,
      latitude: _position?.latitude,
      longitude: _position?.longitude,
      radiusKm: maxDist.isFinite ? maxDist : null,
      search: _activeSearch,
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
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update raise. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.'));
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
    setState(() {
      _posts = _posts.map((p) => p.id == post.id ? p.copyWith(saveCount: count, isSavedByMe: saved) : p).toList();
    });
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final maxDist = DistanceProvider.of(context).maxDistance;
    final kmLabel = t(context, 'km', 'كم');
    final distLabel = maxDist.isFinite ? '${maxDist.toInt()}$kmLabel' : '50+$kmLabel';

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
                  hintText: t(context, 'Search by title, description, or location...', 'ابحث حسب العنوان أو الوصف أو الموقع...'),
                  onChanged: _onSearchChanged,
                ),
              ),
              if (_searching) const LinearProgressIndicator(color: AppColors.primary, minHeight: 2),
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
                child: _loading && _posts.isEmpty
                    ? ListView(
                        padding: const EdgeInsets.only(top: AppSpacing.sm),
                        children: const [
                          ListCardSkeleton(),
                          ListCardSkeleton(),
                          ListCardSkeleton(),
                        ],
                      )
                    : _errorMessage != null && _posts.isEmpty
                        ? _HelpFeedError(message: _errorMessage!, onRetry: _loadFeed)
                        : RefreshIndicator(
                            onRefresh: _loadFeed,
                            color: AppColors.primary,
                            child: TabBarView(
                              children: [
                                _HelpFeedList(
                                  posts: _posts.where((p) => p.postType == 'RESCUE').toList(),
                                  query: _query,
                                  onBoost: _toggleUpvote,
                                  onSave: _toggleSave,
                                  onLoadMore: _loadMore,
                                  loadingMore: _loadingMore,
                                ),
                                _HelpFeedList(
                                  posts: _posts.where((p) => p.postType == 'LOST').toList(),
                                  query: _query,
                                  onBoost: _toggleUpvote,
                                  onSave: _toggleSave,
                                  onLoadMore: _loadMore,
                                  loadingMore: _loadingMore,
                                ),
                              ],
                            ),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HelpFeedError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _HelpFeedError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
            const SizedBox(height: AppSpacing.sm),
            Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(onPressed: onRetry, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
          ],
        ),
      ),
    );
  }
}

class _HelpFeedList extends StatelessWidget {
  final List<FeedPost> posts;
  final String query;
  final Future<bool> Function(FeedPost) onBoost;
  final Future<bool> Function(FeedPost) onSave;
  final VoidCallback onLoadMore;
  final bool loadingMore;
  const _HelpFeedList({
    required this.posts,
    required this.query,
    required this.onBoost,
    required this.onSave,
    required this.onLoadMore,
    required this.loadingMore,
  });

  @override
  Widget build(BuildContext context) {
    final q = query.trim();
    final items = posts;
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
                    : t(context, 'No posts within this distance', 'لا توجد منشورات ضمن هذه المسافة'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification.metrics.pixels >= notification.metrics.maxScrollExtent - 400) {
          onLoadMore();
        }
        return false;
      },
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 100, top: AppSpacing.xs),
        itemCount: items.length + (loadingMore ? 1 : 0),
        itemBuilder: (_, i) {
          if (i >= items.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
            );
          }
          return _HelpFeedCard(
            key: ValueKey(items[i].id),
            post: items[i],
            onBoost: () => onBoost(items[i]),
            onSave: () => onSave(items[i]),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: items[i].id)),
            ),
          );
        },
      ),
    );
  }
}

class _HelpFeedCard extends StatelessWidget {
  final FeedPost post;
  final Future<bool> Function() onBoost;
  final Future<bool> Function() onSave;
  final VoidCallback onTap;
  const _HelpFeedCard({
    super.key,
    required this.post,
    required this.onBoost,
    required this.onSave,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final lang = context.watch<LangProvider>().lang;
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
                child: post.postType == 'RESCUE'
                    ? BlurredThumbnail(imageUrl: post.primaryImageUrl ?? '', width: double.infinity, height: 180)
                    : ImageWithFallback(url: post.primaryImageUrl ?? '', width: double.infinity, height: 180),
              ),
              if (post.isUrgent)
                PositionedDirectional(
                  top: AppSpacing.sm,
                  start: AppSpacing.sm,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: AppColors.critical, borderRadius: BorderRadius.circular(AppRadius.chip)),
                    child: Text(t(context, 'CRITICAL', 'حرج'), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
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
              if (post.distanceKm != null)
                PositionedDirectional(
                  bottom: AppSpacing.sm,
                  end: AppSpacing.sm,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(AppRadius.chip)),
                    child: Row(
                      children: [
                        Text(post.distanceKm!.toStringAsFixed(1), style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
                        const SizedBox(width: 2),
                        Text(t(context, 'km', 'كم'), style: const TextStyle(color: Colors.white70, fontSize: 11)),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  post.distanceKm != null
                      ? '${post.distanceKm!.toStringAsFixed(1)} ${t(context, 'km away', 'كم')}   ·   ${timeAgo(post.createdAt, lang)}'
                      : timeAgo(post.createdAt, lang),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                Text(post.title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 17), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Text(post.description, style: Theme.of(context).textTheme.bodyMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
            child: Row(
              children: [
                AnimatedBoostChip(
                  count: post.upvoteCount,
                  boosted: post.isUpvotedByMe,
                  onToggle: onBoost,
                  boostedLabel: t(context, 'Raised', 'مُعزَّز'),
                  unboostedLabel: t(context, 'Raise', 'تعزيز'),
                  activeColor: AppColors.primary,
                  inactiveColor: AppColors.textMuted,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            // Opens the post, where the real "Contact" flow lives (send a
            // contact request; the owner approves and shares WhatsApp).
            child: ElevatedButton(
              onPressed: onTap,
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
                backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                foregroundColor: AppColors.primary,
                elevation: 0,
                shape: const StadiumBorder(),
              ),
              child: Text(t(context, 'I Can Help →', 'يمكنني المساعدة ←')),
            ),
          ),
        ],
      ),
      ),
    );
  }
}

