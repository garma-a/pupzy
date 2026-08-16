import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/feed_post.dart';
import '../services/browse_location_service.dart';
import '../services/feed_location_resolver.dart';
import '../services/graphql_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/skeleton_loader.dart';
import '../widgets/top_bar.dart';
import 'rescue_detail_screen.dart';

class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key});

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  final _searchController = TextEditingController();
  String _query = '';

  bool _loading = true;
  String? _errorMessage;
  List<FeedPost> _posts = [];
  Position? _position;
  bool _initialized = false;
  double? _lastRadius;
  Object? _lastBrowseCityId;
  final Set<String> _helpingIds = {};

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
          _errorMessage = t(context, 'Set your city in your profile to see nearby posts.', 'حدد مدينتك في ملفك الشخصي لرؤية المنشورات القريبة.');
        });
      }
      return;
    }
    if (!mounted) return;

    final maxDist = DistanceProvider.of(context).maxDistance;
    final (posts, error) = await graphql.fetchHelpFeed(
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

  void _toggleHelping(FeedPost post) {
    final nowHelping = !_helpingIds.contains(post.id);
    setState(() {
      if (nowHelping) {
        _helpingIds.add(post.id);
      } else {
        _helpingIds.remove(post.id);
      }
    });
    Fluttertoast.showToast(
      msg: nowHelping
          ? t(context, "You're marked as helping — the reporter can see you responded", 'تم تسجيلك كمساعد — يمكن للمُبلّغ رؤية أنك استجبت')
          : t(context, "You're no longer marked as helping", 'لم تعد مُسجّلًا كمساعد'),
    );
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
                            hintText: t(context, 'Search by title or description...', 'ابحث حسب العنوان أو الوصف...'),
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
                                  helpingIds: _helpingIds,
                                  onBoost: _toggleUpvote,
                                  onSave: _toggleSave,
                                  onToggleHelping: _toggleHelping,
                                ),
                                _HelpFeedList(
                                  posts: _posts.where((p) => p.postType == 'LOST').toList(),
                                  query: _query,
                                  helpingIds: _helpingIds,
                                  onBoost: _toggleUpvote,
                                  onSave: _toggleSave,
                                  onToggleHelping: _toggleHelping,
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
  final Set<String> helpingIds;
  final ValueChanged<FeedPost> onBoost;
  final Future<bool> Function(FeedPost) onSave;
  final ValueChanged<FeedPost> onToggleHelping;
  const _HelpFeedList({
    required this.posts,
    required this.query,
    required this.helpingIds,
    required this.onBoost,
    required this.onSave,
    required this.onToggleHelping,
  });

  @override
  Widget build(BuildContext context) {
    var items = posts;
    final q = query.trim().toLowerCase();
    if (q.isNotEmpty) {
      items = items.where((p) => p.title.toLowerCase().contains(q) || p.description.toLowerCase().contains(q)).toList();
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
                    : t(context, 'No posts within this distance', 'لا توجد منشورات ضمن هذه المسافة'),
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
      itemBuilder: (_, i) => _HelpFeedCard(
        post: items[i],
        helping: helpingIds.contains(items[i].id),
        onBoost: () => onBoost(items[i]),
        onSave: () => onSave(items[i]),
        onToggleHelping: () => onToggleHelping(items[i]),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: items[i].id)),
        ),
      ),
    );
  }
}

class _HelpFeedCard extends StatelessWidget {
  final FeedPost post;
  final bool helping;
  final VoidCallback onBoost;
  final Future<bool> Function() onSave;
  final VoidCallback onToggleHelping;
  final VoidCallback onTap;
  const _HelpFeedCard({
    required this.post,
    required this.helping,
    required this.onBoost,
    required this.onSave,
    required this.onToggleHelping,
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
                child: ImageWithFallback(url: post.primaryImageUrl ?? '', width: double.infinity, height: 180),
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
                      inactiveColor: AppColors.critical,
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
                Material(
                  color: Colors.transparent,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                    onTap: onBoost,
                    child: _HelpActionBtn(
                      icon: Icons.arrow_upward,
                      label: '${post.upvoteCount}  ${post.isUpvotedByMe ? t(context, 'Boosted', 'مُعزَّز') : t(context, 'Boost', 'تعزيز')}',
                      color: post.isUpvotedByMe ? AppColors.primary : AppColors.textMuted,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: ElevatedButton(
              onPressed: onToggleHelping,
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
                backgroundColor: helping ? AppColors.primary : AppColors.primary.withValues(alpha: 0.12),
                foregroundColor: helping ? Colors.white : AppColors.primary,
                elevation: 0,
                shape: const StadiumBorder(),
              ),
              child: Text(helping ? t(context, "You're Helping ✓", 'أنت تساعد ✓') : t(context, 'I Can Help →', 'يمكنني المساعدة ←')),
            ),
          ),
        ],
      ),
      ),
    );
  }
}

class _HelpActionBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  const _HelpActionBtn({required this.icon, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(fontSize: 13, color: color, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}
