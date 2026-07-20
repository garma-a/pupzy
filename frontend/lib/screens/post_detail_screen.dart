import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/post.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/engagement_bar.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/pet_carousel.dart';

class PostDetailScreen extends StatefulWidget {
  final Post post;

  const PostDetailScreen({super.key, required this.post});

  @override
  State<PostDetailScreen> createState() => _PostDetailScreenState();
}

class _PostDetailScreenState extends State<PostDetailScreen> {
  void _toggleLike() {
    setState(() {
      widget.post.isLiked = !widget.post.isLiked;
      widget.post.likeCount += widget.post.isLiked ? 1 : -1;
    });
  }

  void _toggleBookmark() {
    setState(() => widget.post.isBookmarked = !widget.post.isBookmarked);
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    return Scaffold(
      appBar: AppBar(title: Text(t(context, 'Post', 'المنشور'))),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: AppSpacing.lg),
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Row(
                    children: [
                      CircleAvatar(radius: 22, backgroundImage: NetworkImage(post.avatarUrl)),
                      const SizedBox(width: AppSpacing.sm),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(post.username, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                          Text(timeAgo(post.timestamp, context.watch<LangProvider>().lang), style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                    ],
                  ),
                ),
                if (post.imageUrls.length > 1)
                  PetCarousel(imageUrls: post.imageUrls, height: 320)
                else if (post.imageUrls.isNotEmpty)
                  ImageWithFallback(url: post.imageUrls.first, width: double.infinity, height: 320),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Text(post.caption, style: Theme.of(context).textTheme.bodyMedium),
                ),
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
                  child: Text(
                    post.comments.isEmpty
                        ? t(context, 'No comments', 'لا توجد تعليقات')
                        : t(context, 'Comments (${post.comments.length})', 'التعليقات (${post.comments.length})'),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                if (post.comments.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Text(t(context, 'No comments yet. Be the first!', 'لا توجد تعليقات بعد. كن أول من يعلّق!'), style: Theme.of(context).textTheme.bodySmall),
                  )
                else
                  ...post.comments.map(
                    (c) => ListTile(
                      leading: CircleAvatar(backgroundImage: NetworkImage(c.avatarUrl)),
                      title: Text(c.username, style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(c.text),
                    ),
                  ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: EngagementBar(
                likeCount: post.likeCount,
                commentCount: post.commentCount,
                shareCount: post.shareCount,
                isLiked: post.isLiked,
                isBookmarked: post.isBookmarked,
                onLike: _toggleLike,
                onComment: () {},
                onShare: () {},
                onBookmark: _toggleBookmark,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
