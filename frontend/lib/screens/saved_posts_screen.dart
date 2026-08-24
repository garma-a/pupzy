import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/feed_post.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/blurred_thumbnail.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/skeleton_loader.dart';
import 'adoption_detail_screen.dart';
import 'product_detail_screen.dart';
import 'rescue_detail_screen.dart';

/// Full list of the current user's saved/bookmarked posts, across every
/// post type — reached from Home's "FAVORITES" section via "See more".
class SavedPostsScreen extends StatefulWidget {
  const SavedPostsScreen({super.key});

  @override
  State<SavedPostsScreen> createState() => _SavedPostsScreenState();
}

class _SavedPostsScreenState extends State<SavedPostsScreen> {
  bool _loading = true;
  String? _errorMessage;
  List<FeedPost> _posts = [];
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _load();
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_loading || _loadingMore || !_hasNextPage) return;
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 400) {
      _loadMore();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchMySavedPosts(first: 20);
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
    if (_loadingMore || !_hasNextPage) return;
    setState(() => _loadingMore = true);
    final graphql = context.read<GraphQLService>();
    final (more, endCursor, hasNextPage, error) = await graphql.fetchMySavedPosts(first: 20, after: _endCursor);
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

  Future<bool> _toggleSave(FeedPost post) async {
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(post.id);
    if (!mounted) return false;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return false;
    }
    if (!saved) {
      // Removed from favorites — it no longer belongs on this screen.
      setState(() => _posts = _posts.where((p) => p.id != post.id).toList());
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, 'Favorites', 'المفضلة'), style: Theme.of(context).textTheme.headlineMedium),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          color: AppColors.primary,
          child: _loading && _posts.isEmpty
              ? ListView(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
                  children: const [
                    ListCardSkeleton(imageHeight: 140),
                    ListCardSkeleton(imageHeight: 140),
                  ],
                )
              : _errorMessage != null && _posts.isEmpty
                  ? ListView(
                      children: [
                        const SizedBox(height: 120),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                          child: Column(
                            children: [
                              const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                              const SizedBox(height: AppSpacing.sm),
                              Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                              const SizedBox(height: AppSpacing.md),
                              OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                            ],
                          ),
                        ),
                      ],
                    )
                  : _posts.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 100),
                            Center(
                              child: Column(
                                children: [
                                  const Icon(Icons.favorite_border, size: 48, color: AppColors.textMuted),
                                  const SizedBox(height: AppSpacing.md),
                                  Text(
                                    t(context, "You haven't saved any posts yet", 'لم تحفظ أي منشورات بعد'),
                                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 100),
                          itemCount: _posts.length + (_loadingMore ? 1 : 0),
                          itemBuilder: (_, i) {
                            if (i >= _posts.length) {
                              return const Padding(
                                padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                                child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                              );
                            }
                            return _SavedPostTile(key: ValueKey(_posts[i].id), post: _posts[i], onToggleSave: () => _toggleSave(_posts[i]));
                          },
                        ),
        ),
      ),
    );
  }
}

class _SavedPostTile extends StatelessWidget {
  final FeedPost post;
  final Future<bool> Function() onToggleSave;
  const _SavedPostTile({super.key, required this.post, required this.onToggleSave});

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
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
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
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppRadius.chip)),
                    child: Text(_typeLabel(context), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
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
            AnimatedFavoriteIcon(
              isSaved: true,
              onToggle: onToggleSave,
              semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
              semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
              activeColor: AppColors.critical,
              inactiveColor: AppColors.textMuted,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}
