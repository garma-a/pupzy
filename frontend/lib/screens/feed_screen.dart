import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../models/post.dart';
import '../theme/app_theme.dart';
import '../widgets/post_card.dart';
import '../widgets/skeleton_loader.dart';
import 'notifications_panel.dart';
import 'post_detail_screen.dart';

class FeedScreen extends StatefulWidget {
  const FeedScreen({super.key});

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> {
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _loading = false);
    });
  }

  Future<void> _refresh() async {
    await Future.delayed(const Duration(milliseconds: 700));
    setState(() {});
  }

  void _toggleLike(Post post) {
    setState(() {
      post.isLiked = !post.isLiked;
      post.likeCount += post.isLiked ? 1 : -1;
    });
  }

  void _toggleBookmark(Post post) {
    setState(() => post.isBookmarked = !post.isBookmarked);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pupzy'),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_none),
            onPressed: () {
              showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.transparent,
                builder: (_) => const NotificationsPanel(),
              );
            },
          ),
        ],
      ),
      body: _loading
          ? ListView.builder(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              itemCount: 4,
              itemBuilder: (context, i) => const PostCardSkeleton(),
            )
          : RefreshIndicator(
              onRefresh: _refresh,
              child: ListView.builder(
                padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: 96),
                itemCount: MockData.posts.length,
                itemBuilder: (context, i) {
                  final post = MockData.posts[i];
                  return PostCard(
                    post: post,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => PostDetailScreen(post: post)),
                      );
                    },
                    onLike: () => _toggleLike(post),
                    onComment: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => PostDetailScreen(post: post)),
                      );
                    },
                    onShare: () {},
                    onBookmark: () => _toggleBookmark(post),
                  );
                },
              ),
            ),
    );
  }
}
