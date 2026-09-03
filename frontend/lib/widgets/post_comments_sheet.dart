import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/comment.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import 'animated_boost_chip.dart';

/// Reusable discussion surface for viewing and publishing top-level Comments and Replies on a Post.
/// Supports loading, empty, error, pagination, reply creation, thread expansion, and owner deletion.
/// Renders all text strictly as plain text (never executes user-supplied markup).
/// Renders deleted comments as neutral tombstones without leaking author identity or original text.
class PostCommentsSheet extends StatefulWidget {
  final String postId;
  final VoidCallback? onCommentCreated;

  const PostCommentsSheet({
    super.key,
    required this.postId,
    this.onCommentCreated,
  });

  @override
  State<PostCommentsSheet> createState() => _PostCommentsSheetState();
}

class _PostCommentsSheetState extends State<PostCommentsSheet> {
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  bool _loading = true;
  bool _loadingMore = false;
  bool _submitting = false;
  String? _errorMessage;
  String? _createErrorMessage;
  String? _currentUserId;

  final List<Comment> _comments = [];
  String? _endCursor;
  bool _hasNextPage = false;
  String _sort = 'TOP'; // TOP or NEWEST

  /// If the user is composing a reply beneath a top-level comment.
  Comment? _replyingToComment;

  /// Cached replies by parent comment ID.
  final Map<String, List<Comment>> _repliesMap = {};
  final Set<String> _expandedComments = {};
  final Set<String> _loadingReplies = {};
  final Set<String> _loadingMoreReplies = {};
  final Map<String, String?> _repliesEndCursor = {};
  final Map<String, bool> _repliesHasNextPage = {};

  /// Author-scoped durable clientRequestId for idempotency.
  /// Preserved across failed retries so retrying sends the identical key.
  late String _currentClientRequestId;

  @override
  void initState() {
    super.initState();
    _currentClientRequestId = _generateClientRequestId();
    _loadInitial();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String _generateClientRequestId() {
    return 'cr-${DateTime.now().millisecondsSinceEpoch}-${UniqueKey().toString()}';
  }

  void _onScroll() {
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 100) {
      if (!_loading && !_loadingMore && _hasNextPage) {
        _loadMore();
      }
    }
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    final graphql = context.read<GraphQLService>();

    // Load current user for ownership checks concurrently
    graphql.fetchMe().then((me) {
      if (mounted) {
        setState(() {
          _currentUserId = me?['id'] as String?;
        });
      }
    });

    final (conn, error) = await graphql.fetchComments(
      postId: widget.postId,
      sort: _sort,
      first: 20,
    );

    if (!mounted) return;

    if (error != null) {
      setState(() {
        _loading = false;
        _errorMessage = error;
      });
      return;
    }

    setState(() {
      _loading = false;
      _comments.clear();
      if (conn != null) {
        _comments.addAll(conn.comments);
        _endCursor = conn.endCursor;
        _hasNextPage = conn.hasNextPage;
      }
    });
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage || _endCursor == null) return;

    setState(() => _loadingMore = true);

    final graphql = context.read<GraphQLService>();
    final (conn, error) = await graphql.fetchComments(
      postId: widget.postId,
      sort: _sort,
      first: 20,
      after: _endCursor,
    );

    if (!mounted) return;

    setState(() {
      _loadingMore = false;
      if (error == null && conn != null) {
        _comments.addAll(conn.comments);
        _endCursor = conn.endCursor;
        _hasNextPage = conn.hasNextPage;
      }
    });
  }

  Future<void> _toggleReplies(Comment comment) async {
    final commentId = comment.id;
    if (_expandedComments.contains(commentId)) {
      setState(() {
        _expandedComments.remove(commentId);
      });
      return;
    }

    setState(() {
      _expandedComments.add(commentId);
    });

    if (!_repliesMap.containsKey(commentId)) {
      await _fetchRepliesForComment(commentId);
    }
  }

  Future<void> _fetchRepliesForComment(String commentId) async {
    setState(() {
      _loadingReplies.add(commentId);
    });

    final graphql = context.read<GraphQLService>();
    final (conn, error) = await graphql.fetchReplies(
      commentId: commentId,
      first: 20,
    );

    if (!mounted) return;

    setState(() {
      _loadingReplies.remove(commentId);
      if (error == null && conn != null) {
        _repliesMap[commentId] = conn.comments;
        _repliesEndCursor[commentId] = conn.endCursor;
        _repliesHasNextPage[commentId] = conn.hasNextPage;
      } else {
        _repliesMap[commentId] = [];
      }
    });
  }

  Future<void> _loadMoreReplies(String commentId) async {
    final cursor = _repliesEndCursor[commentId];
    final hasNext = _repliesHasNextPage[commentId] ?? false;
    if (_loadingMoreReplies.contains(commentId) || !hasNext || cursor == null) return;

    setState(() {
      _loadingMoreReplies.add(commentId);
    });

    final graphql = context.read<GraphQLService>();
    final (conn, error) = await graphql.fetchReplies(
      commentId: commentId,
      first: 20,
      after: cursor,
    );

    if (!mounted) return;

    setState(() {
      _loadingMoreReplies.remove(commentId);
      if (error == null && conn != null) {
        _repliesMap[commentId]?.addAll(conn.comments);
        _repliesEndCursor[commentId] = conn.endCursor;
        _repliesHasNextPage[commentId] = conn.hasNextPage;
      }
    });
  }

  void _startReplying(Comment comment) {
    setState(() {
      _replyingToComment = comment;
      _createErrorMessage = null;
    });
  }

  void _cancelReplying() {
    setState(() {
      _replyingToComment = null;
      _createErrorMessage = null;
    });
  }

  Future<void> _confirmDelete(Comment comment, {String? parentCommentId}) async {
    final isReply = comment.isReply;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          isReply
              ? t(ctx, 'Delete Reply?', 'حذف الرد؟')
              : t(ctx, 'Delete Comment?', 'حذف التعليق؟'),
        ),
        content: Text(
          t(
            ctx,
            'This action is irreversible and cannot be undone.',
            'لا يمكن التراجع عن هذا الإجراء.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(t(ctx, 'Cancel', 'إلغاء')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.critical),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(t(ctx, 'Delete', 'حذف')),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.deleteComment(id: comment.id);

    if (!mounted) return;

    if (!success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? t(context, 'Failed to delete.', 'فشل الحذف.')),
          backgroundColor: AppColors.critical,
        ),
      );
      return;
    }

    setState(() {
      if (isReply) {
        final parentId = parentCommentId ?? comment.parentId!;
        _repliesMap[parentId]?.removeWhere((r) => r.id == comment.id);

        // Decrement parent replyCount
        final pIdx = _comments.indexWhere((c) => c.id == parentId);
        if (pIdx != -1) {
          final newCount = (_comments[pIdx].replyCount - 1).clamp(0, 999999);
          if (_comments[pIdx].isDeleted && newCount == 0) {
            // Tombstone with no remaining replies disappears from list
            _comments.removeAt(pIdx);
          } else {
            _comments[pIdx] = _comments[pIdx].copyWith(replyCount: newCount);
          }
        }
      } else {
        // Top-level comment
        final idx = _comments.indexWhere((c) => c.id == comment.id);
        if (idx != -1) {
          if (comment.replyCount > 0) {
            // Surviving replies remain; convert to neutral tombstone
            _comments[idx] = _comments[idx].copyWith(
              status: 'DELETED',
              text: '[Deleted]',
              author: null,
            );
          } else {
            // No visible replies; disappears immediately
            _comments.removeAt(idx);
          }
        }
      }
    });

    widget.onCommentCreated?.call();
  }

  void _updateCommentBoostState(String commentId, bool isBoosted, int count) {
    setState(() {
      final idx = _comments.indexWhere((c) => c.id == commentId);
      if (idx != -1) {
        _comments[idx] = _comments[idx].copyWith(
          isBoostedByMe: isBoosted,
          boostCount: count.clamp(0, 999999),
        );
      }
    });
  }

  void _updateReplyBoostState(String parentId, String replyId, bool isBoosted, int count) {
    setState(() {
      final list = _repliesMap[parentId];
      if (list != null) {
        final idx = list.indexWhere((r) => r.id == replyId);
        if (idx != -1) {
          list[idx] = list[idx].copyWith(
            isBoostedByMe: isBoosted,
            boostCount: count.clamp(0, 999999),
          );
        }
      }
    });
  }

  Future<bool> _toggleCommentBoost(Comment comment) async {
    if (_currentUserId != null && comment.author?.id == _currentUserId) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(t(context, "You can't boost your own comment", 'لا يمكنك تعزيز تعليقك الخاص')),
          backgroundColor: AppColors.critical,
        ),
      );
      return false;
    }

    final prevBoosted = comment.isBoostedByMe;
    final prevCount = comment.boostCount;
    final nextBoosted = !prevBoosted;
    final nextCount = prevCount + (nextBoosted ? 1 : -1);

    _updateCommentBoostState(comment.id, nextBoosted, nextCount);

    final graphql = context.read<GraphQLService>();
    final (newCount, isBoosted, error) = await graphql.toggleCommentBoost(comment.id);

    if (!mounted) return false;

    if (error != null || newCount == null || isBoosted == null) {
      _updateCommentBoostState(comment.id, prevBoosted, prevCount);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? t(context, 'Could not update boost. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.')),
          backgroundColor: AppColors.critical,
        ),
      );
      return false;
    }

    _updateCommentBoostState(comment.id, isBoosted, newCount);
    return true;
  }

  Future<bool> _toggleReplyBoost(Comment reply, String parentCommentId) async {
    if (_currentUserId != null && reply.author?.id == _currentUserId) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(t(context, "You can't boost your own reply", 'لا يمكنك تعزيز ردك الخاص')),
          backgroundColor: AppColors.critical,
        ),
      );
      return false;
    }

    final prevBoosted = reply.isBoostedByMe;
    final prevCount = reply.boostCount;
    final nextBoosted = !prevBoosted;
    final nextCount = prevCount + (nextBoosted ? 1 : -1);

    _updateReplyBoostState(parentCommentId, reply.id, nextBoosted, nextCount);

    final graphql = context.read<GraphQLService>();
    final (newCount, isBoosted, error) = await graphql.toggleCommentBoost(reply.id);

    if (!mounted) return false;

    if (error != null || newCount == null || isBoosted == null) {
      _updateReplyBoostState(parentCommentId, reply.id, prevBoosted, prevCount);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? t(context, 'Could not update boost. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.')),
          backgroundColor: AppColors.critical,
        ),
      );
      return false;
    }

    _updateReplyBoostState(parentCommentId, reply.id, isBoosted, newCount);
    return true;
  }

  Future<void> _submit() async {
    final rawText = _textController.text;
    final trimmed = rawText.trim();

    if (trimmed.isEmpty) {
      setState(() {
        _createErrorMessage = _replyingToComment != null
            ? t(context, 'Please enter a reply.', 'يرجى كتابة رد.')
            : t(context, 'Please enter a comment.', 'يرجى كتابة تعليق.');
      });
      return;
    }

    setState(() {
      _submitting = true;
      _createErrorMessage = null;
    });

    final graphql = context.read<GraphQLService>();

    if (_replyingToComment != null) {
      // Create Reply
      final targetParent = _replyingToComment!;
      final (createdReply, error) = await graphql.createReply(
        clientRequestId: _currentClientRequestId,
        commentId: targetParent.id,
        text: trimmed,
      );

      if (!mounted) return;

      if (error != null || createdReply == null) {
        setState(() {
          _submitting = false;
          _createErrorMessage = error ?? t(context, 'Failed to publish reply.', 'فشل نشر الرد.');
        });
        return;
      }

      // Success for reply: add to cached replies, expand thread, increment parent replyCount
      setState(() {
        _submitting = false;
        _createErrorMessage = null;
        _replyingToComment = null;
        _textController.clear();
        _currentClientRequestId = _generateClientRequestId();

        _expandedComments.add(targetParent.id);
        if (_repliesMap.containsKey(targetParent.id)) {
          _repliesMap[targetParent.id]!.add(createdReply);
        } else {
          _repliesMap[targetParent.id] = [createdReply];
        }

        final pIdx = _comments.indexWhere((c) => c.id == targetParent.id);
        if (pIdx != -1) {
          _comments[pIdx] = _comments[pIdx].copyWith(
            replyCount: _comments[pIdx].replyCount + 1,
          );
        }
      });
    } else {
      // Create top-level Comment
      final (createdComment, error) = await graphql.createComment(
        clientRequestId: _currentClientRequestId,
        postId: widget.postId,
        text: trimmed,
      );

      if (!mounted) return;

      if (error != null || createdComment == null) {
        setState(() {
          _submitting = false;
          _createErrorMessage = error ?? t(context, 'Failed to publish comment.', 'فشل نشر التعليق.');
        });
        return;
      }

      // Success for comment: insert at top
      setState(() {
        _submitting = false;
        _createErrorMessage = null;
        _comments.insert(0, createdComment);
        _textController.clear();
        _currentClientRequestId = _generateClientRequestId();
      });
    }

    widget.onCommentCreated?.call();
  }

  void _onSortChanged(String newSort) {
    if (_sort == newSort) return;
    setState(() {
      _sort = newSort;
    });
    _loadInitial();
  }

  @override
  Widget build(BuildContext context) {
    final isAr = Localizations.localeOf(context).languageCode == 'ar';
    final mediaQuery = MediaQuery.of(context);

    return Container(
      height: mediaQuery.size.height * 0.85,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
      ),
      child: Column(
        children: [
          // Header handle
          const SizedBox(height: AppSpacing.sm),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.border,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          // Title and Sort Bar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
            child: Row(
              children: [
                Text(
                  t(context, 'Discussion', 'المناقشة'),
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const Spacer(),
                // Sort Segmented Buttons
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildSortButton('TOP', t(context, 'Top', 'الأبرز')),
                      _buildSortButton('NEWEST', t(context, 'Newest', 'الأحدث')),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.xs),
                IconButton(
                  icon: const Icon(Icons.close, size: 20),
                  onPressed: () => Navigator.of(context).pop(),
                  tooltip: t(context, 'Close', 'إغلاق'),
                ),
              ],
            ),
          ),
          const Divider(height: 1),

          // Main Comments Area
          Expanded(
            child: _buildBody(context, isAr),
          ),

          const Divider(height: 1),

          // Create Comment / Reply Input Area
          _buildInputArea(context, isAr),
        ],
      ),
    );
  }

  Widget _buildSortButton(String sortKey, String label) {
    final isSelected = _sort == sortKey;
    return GestureDetector(
      onTap: () => _onSortChanged(sortKey),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.chip),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
            color: isSelected ? Colors.white : AppColors.textSecondary,
          ),
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context, bool isAr) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppColors.critical, size: 40),
              const SizedBox(height: AppSpacing.sm),
              Text(
                _errorMessage!,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.md),
              OutlinedButton(
                onPressed: _loadInitial,
                child: Text(t(context, 'Retry', 'إعادة المحاولة')),
              ),
            ],
          ),
        ),
      );
    }

    if (_comments.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.chat_bubble_outline, size: 48, color: AppColors.textMuted),
              const SizedBox(height: AppSpacing.sm),
              Text(
                t(context, 'No comments yet', 'لا توجد تعليقات بعد'),
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 4),
              Text(
                t(context, 'Be the first to participate in this discussion!', 'كن أول من يشارك في هذه المناقشة!'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return ListView.separated(
      controller: _scrollController,
      padding: const EdgeInsets.all(AppSpacing.lg),
      itemCount: _comments.length + (_hasNextPage ? 1 : 0),
      separatorBuilder: (_, __) => const Divider(height: AppSpacing.lg),
      itemBuilder: (context, index) {
        if (index == _comments.length) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: _loadingMore
                  ? const CircularProgressIndicator()
                  : OutlinedButton(
                      onPressed: _loadMore,
                      child: Text(t(context, 'Load More', 'تحميل المزيد')),
                    ),
            ),
          );
        }

        final comment = _comments[index];
        return _buildTopLevelCommentItem(context, comment, isAr);
      },
    );
  }

  Widget _buildTopLevelCommentItem(BuildContext context, Comment comment, bool isAr) {
    final isTombstone = comment.isDeleted;
    final isAuthor = !isTombstone && _currentUserId != null && comment.author?.id == _currentUserId;
    final authorName = isTombstone ? '' : (comment.author?.displayName(isAr ? 'ar' : 'en') ?? 'User');
    final timeStr = formatTimeAgo(context, comment.createdAt);
    final isExpanded = _expandedComments.contains(comment.id);
    final replies = _repliesMap[comment.id] ?? [];
    final isLoadingReplies = _loadingReplies.contains(comment.id);
    final hasMoreReplies = _repliesHasNextPage[comment.id] ?? false;
    final isLoadingMoreReplies = _loadingMoreReplies.contains(comment.id);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Avatar (or neutral tombstone icon)
            if (isTombstone)
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.background,
                child: const Icon(Icons.delete_outline, size: 18, color: AppColors.textMuted),
              )
            else
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.border,
                backgroundImage: comment.author?.profilePictureUrl != null &&
                        comment.author!.profilePictureUrl!.isNotEmpty
                    ? NetworkImage(comment.author!.profilePictureUrl!)
                    : null,
                child: comment.author?.profilePictureUrl == null ||
                        comment.author!.profilePictureUrl!.isEmpty
                    ? Text(
                        authorName.isNotEmpty ? authorName[0].toUpperCase() : 'U',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: AppColors.textPrimary,
                        ),
                      )
                    : null,
              ),
            const SizedBox(width: AppSpacing.sm),

            // Content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Author Name & Time
                  Row(
                    children: [
                      if (isTombstone)
                        Text(
                          t(context, '[Deleted]', '[محذوف]'),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                fontStyle: FontStyle.italic,
                                color: AppColors.textMuted,
                              ),
                        )
                      else ...[
                        Flexible(
                          child: Text(
                            authorName,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textPrimary,
                                ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (comment.author?.isVerified == true) ...[
                          const SizedBox(width: 4),
                          const Icon(Icons.verified, size: 14, color: AppColors.primary),
                        ],
                      ],
                      const SizedBox(width: 8),
                      Text(
                        timeStr,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppColors.textMuted,
                              fontSize: 11,
                            ),
                      ),
                      const Spacer(),
                      // Delete button for author (active only)
                      if (isAuthor)
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(Icons.more_horiz, size: 18, color: AppColors.textMuted),
                          onPressed: () => _confirmDelete(comment),
                          tooltip: t(context, 'Delete', 'حذف'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),

                  // Comment Text — strictly plain text rendering to ensure user markup is never executed
                  Text(
                    isTombstone
                        ? t(context, 'This comment was deleted.', 'تم حذف هذا التعليق.')
                        : comment.text,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: isTombstone ? AppColors.textMuted : AppColors.textPrimary,
                          fontStyle: isTombstone ? FontStyle.italic : FontStyle.normal,
                        ),
                  ),
                  const SizedBox(height: 6),

                  // Action Row: Reply, View Replies & Boost buttons
                  Row(
                    children: [
                      if (!isTombstone) ...[
                        GestureDetector(
                          onTap: () => _startReplying(comment),
                          child: Text(
                            t(context, 'Reply', 'رد'),
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                      ],
                      if (comment.replyCount > 0) ...[
                        GestureDetector(
                          onTap: () => _toggleReplies(comment),
                          child: Text(
                            isExpanded
                                ? t(context, 'Hide replies', 'إخفاء الردود')
                                : t(
                                    context,
                                    'View ${comment.replyCount} ${comment.replyCount == 1 ? 'reply' : 'replies'}',
                                    'عرض ${comment.replyCount} رد',
                                  ),
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                      ],
                      const Spacer(),
                      if (!isTombstone)
                        AnimatedBoostChip(
                          count: comment.boostCount,
                          boosted: comment.isBoostedByMe,
                          onToggle: () => _toggleCommentBoost(comment),
                          boostedLabel: t(context, 'Boosted', 'مُعزَّز'),
                          unboostedLabel: t(context, 'Boost', 'تعزيز'),
                          activeColor: AppColors.primary,
                          inactiveColor: AppColors.textSecondary,
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          iconSize: 13,
                          fontSize: 11,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),

        // Replies Thread (indented)
        if (isExpanded) ...[
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 44, top: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (isLoadingReplies)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                else ...[
                  for (final reply in replies) ...[
                    _buildReplyItem(context, reply, comment.id, isAr),
                    const SizedBox(height: AppSpacing.sm),
                  ],
                  if (hasMoreReplies)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: isLoadingMoreReplies
                          ? const Center(
                              child: SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              ),
                            )
                          : GestureDetector(
                              onTap: () => _loadMoreReplies(comment.id),
                              child: Text(
                                t(context, 'Load more replies...', 'تحميل المزيد من الردود...'),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.primary,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildReplyItem(BuildContext context, Comment reply, String parentCommentId, bool isAr) {
    final isAuthor = _currentUserId != null && reply.author?.id == _currentUserId;
    final authorName = reply.author?.displayName(isAr ? 'ar' : 'en') ?? 'User';
    final timeStr = formatTimeAgo(context, reply.createdAt);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Reply Avatar
        CircleAvatar(
          radius: 14,
          backgroundColor: AppColors.border,
          backgroundImage: reply.author?.profilePictureUrl != null &&
                  reply.author!.profilePictureUrl!.isNotEmpty
              ? NetworkImage(reply.author!.profilePictureUrl!)
              : null,
          child: reply.author?.profilePictureUrl == null || reply.author!.profilePictureUrl!.isEmpty
              ? Text(
                  authorName.isNotEmpty ? authorName[0].toUpperCase() : 'U',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 11,
                    color: AppColors.textPrimary,
                  ),
                )
              : null,
        ),
        const SizedBox(width: AppSpacing.xs),

        // Reply Content
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      authorName,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (reply.author?.isVerified == true) ...[
                    const SizedBox(width: 4),
                    const Icon(Icons.verified, size: 12, color: AppColors.primary),
                  ],
                  const SizedBox(width: 6),
                  Text(
                    timeStr,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.textMuted,
                          fontSize: 10,
                        ),
                  ),
                  const Spacer(),
                  // Delete option for reply author
                  if (isAuthor)
                    IconButton(
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                      icon: const Icon(Icons.more_horiz, size: 16, color: AppColors.textMuted),
                      onPressed: () => _confirmDelete(reply, parentCommentId: parentCommentId),
                      tooltip: t(context, 'Delete', 'حذف'),
                    ),
                ],
              ),
              const SizedBox(height: 2),
              // Reply text (plain text)
              Text(
                reply.text,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.textPrimary,
                      fontSize: 13,
                    ),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  const Spacer(),
                  AnimatedBoostChip(
                    count: reply.boostCount,
                    boosted: reply.isBoostedByMe,
                    onToggle: () => _toggleReplyBoost(reply, parentCommentId),
                    boostedLabel: t(context, 'Boosted', 'مُعزَّز'),
                    unboostedLabel: t(context, 'Boost', 'تعزيز'),
                    activeColor: AppColors.primary,
                    inactiveColor: AppColors.textSecondary,
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    iconSize: 12,
                    fontSize: 10,
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInputArea(BuildContext context, bool isAr) {
    final isReplying = _replyingToComment != null;
    final maxLen = isReplying ? 500 : 1000;
    final targetAuthorName =
        _replyingToComment?.author?.displayName(isAr ? 'ar' : 'en') ?? 'User';

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: AppSpacing.md,
          right: AppSpacing.md,
          top: AppSpacing.xs,
          bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.xs,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Replying banner
            if (isReplying)
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primary.withAlpha(25),
                  borderRadius: BorderRadius.circular(AppRadius.chip),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.reply, size: 14, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        t(
                          context,
                          'Replying to $targetAuthorName',
                          'الرد على $targetAuthorName',
                        ),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.primary,
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    GestureDetector(
                      onTap: _cancelReplying,
                      child: const Icon(Icons.close, size: 16, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),

            // Error display
            if (_createErrorMessage != null) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, size: 14, color: AppColors.critical),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        _createErrorMessage!,
                        style: const TextStyle(color: AppColors.critical, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Input Row
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _textController,
                    maxLines: 3,
                    minLines: 1,
                    maxLength: maxLen,
                    decoration: InputDecoration(
                      hintText: isReplying
                          ? t(context, 'Write a reply...', 'اكتب ردًا...')
                          : t(context, 'Write a comment...', 'اكتب تعليقًا...'),
                      counterText: '',
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                        borderSide: const BorderSide(color: AppColors.primary),
                      ),
                      filled: true,
                      fillColor: AppColors.background,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.xs),
                IconButton(
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_rounded, color: AppColors.primary),
                  tooltip: t(context, 'Send', 'إرسال'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
