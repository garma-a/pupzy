import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/feed_post.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/blurred_thumbnail.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/skeleton_loader.dart';
import 'adoption_detail_screen.dart';
import 'product_detail_screen.dart';
import 'rescue_detail_screen.dart';

/// The current user's own posts, one section (postType) at a time —
/// reached from the profile sheet's "My Posts" row.
class MyPostsScreen extends StatefulWidget {
  const MyPostsScreen({super.key});

  @override
  State<MyPostsScreen> createState() => _MyPostsScreenState();
}

class _MyPostsScreenState extends State<MyPostsScreen> with SingleTickerProviderStateMixin {
  static const _postTypes = ['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT'];
  late final TabController _tabController = TabController(length: _postTypes.length, vsync: this);

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String _tabLabel(BuildContext context, String postType) {
    switch (postType) {
      case 'RESCUE':
        return t(context, 'Rescue', 'إنقاذ');
      case 'LOST':
        return t(context, 'Lost & Found', 'مفقود');
      case 'ADOPTION':
        return t(context, 'Adoption', 'تبني');
      case 'PRODUCT':
        return t(context, 'Marketplace', 'السوق');
      default:
        return postType;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, 'My Posts', 'منشوراتي'), style: Theme.of(context).textTheme.headlineMedium),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: _postTypes.map((p) => Tab(text: _tabLabel(context, p))).toList(),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: _postTypes.map((p) => _MyPostsList(postType: p)).toList(),
      ),
    );
  }
}

class _MyPostsList extends StatefulWidget {
  final String postType;
  const _MyPostsList({required this.postType});

  @override
  State<_MyPostsList> createState() => _MyPostsListState();
}

class _MyPostsListState extends State<_MyPostsList> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

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
    final (posts, endCursor, hasNextPage, error) = await graphql.fetchMyPosts(postType: widget.postType, first: 20);
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
    final (more, endCursor, hasNextPage, error) =
        await graphql.fetchMyPosts(postType: widget.postType, first: 20, after: _endCursor);
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

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primary,
      child: _loading && _posts.isEmpty
          ? ListView(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
              children: const [
                ListCardSkeleton(imageHeight: 120),
                ListCardSkeleton(imageHeight: 120),
              ],
            )
          : _errorMessage != null && _posts.isEmpty
              ? ListView(
                  children: [
                    const SizedBox(height: 100),
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
                        const SizedBox(height: 80),
                        Center(
                          child: Column(
                            children: [
                              const Icon(Icons.inbox_outlined, size: 48, color: AppColors.textMuted),
                              const SizedBox(height: AppSpacing.md),
                              Text(
                                t(context, "You haven't posted here yet", 'لم تنشر هنا بعد'),
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
                        return _MyPostTile(key: ValueKey(_posts[i].id), post: _posts[i]);
                      },
                    ),
    );
  }
}

class _MyPostTile extends StatelessWidget {
  final FeedPost post;
  const _MyPostTile({super.key, required this.post});

  Color _statusColor() {
    switch (post.status) {
      case 'ACTIVE':
        return AppColors.sectionLineGreen;
      case 'SOLD':
      case 'RESOLVED':
      case 'ADOPTED':
        return AppColors.textMuted;
      default:
        return AppColors.primary;
    }
  }

  String _statusLabel(BuildContext context) {
    switch (post.status) {
      case 'ACTIVE':
        return t(context, 'Active', 'نشط');
      case 'SOLD':
        return t(context, 'Sold', 'مباع');
      case 'RESOLVED':
        return t(context, 'Resolved', 'تم الحل');
      case 'ADOPTED':
        return t(context, 'Adopted', 'تم التبني');
      default:
        return post.status;
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
    final color = _statusColor();
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
                    child: Text(_statusLabel(context), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
                  ),
                  const SizedBox(height: 4),
                  Text(post.title, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(
                    '${post.upvoteCount} ${t(context, 'boosts', 'تعزيز')} · ${post.saveCount} ${t(context, 'saves', 'حفظ')} · ${post.viewCount} ${t(context, 'views', 'مشاهدة')}',
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
