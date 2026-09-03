import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/comment.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';

/// Reusable discussion surface for viewing and publishing top-level Comments on a Post.
/// Supports loading, empty, error, pagination, and successful-create states.
/// Renders all text strictly as plain text (never executes user-supplied markup).
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

  final List<Comment> _comments = [];
  String? _endCursor;
  bool _hasNextPage = false;
  String _sort = 'TOP'; // TOP or NEWEST

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

  Future<void> _submitComment() async {
    final rawText = _textController.text;
    final trimmed = rawText.trim();

    if (trimmed.isEmpty) {
      setState(() {
        _createErrorMessage = t(context, 'Please enter a comment.', 'يرجى كتابة تعليق.');
      });
      return;
    }

    setState(() {
      _submitting = true;
      _createErrorMessage = null;
    });

    final graphql = context.read<GraphQLService>();
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

    // Success: add comment to discussion, reset form and request ID
    setState(() {
      _submitting = false;
      _createErrorMessage = null;
      _comments.insert(0, createdComment);
      _textController.clear();
      _currentClientRequestId = _generateClientRequestId();
    });

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
      height: mediaQuery.size.height * 0.82,
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

          // Create Comment Input Area
          _buildInputArea(context),
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
        final authorName = comment.author.displayName(isAr ? 'ar' : 'en');
        final timeStr = formatTimeAgo(context, comment.createdAt);

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Author Avatar
            CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.border,
              backgroundImage: comment.author.profilePictureUrl != null &&
                      comment.author.profilePictureUrl!.isNotEmpty
                  ? NetworkImage(comment.author.profilePictureUrl!)
                  : null,
              child: comment.author.profilePictureUrl == null ||
                      comment.author.profilePictureUrl!.isEmpty
                  ? Text(
                      authorName.isNotEmpty ? authorName[0].toUpperCase() : 'U',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.textPrimary),
                    )
                  : null,
            ),
            const SizedBox(width: AppSpacing.sm),
            // Comment Content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Author Name & Time
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
                      if (comment.author.isVerified) ...[
                        const SizedBox(width: 4),
                        const Icon(Icons.verified, size: 14, color: AppColors.primary),
                      ],
                      const SizedBox(width: 8),
                      Text(
                        timeStr,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppColors.textMuted,
                              fontSize: 11,
                            ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  // Comment Text — strictly plain text rendering to ensure user markup is never executed
                  Text(
                    comment.text,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textPrimary,
                        ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildInputArea(BuildContext context) {
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
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _textController,
                    maxLines: 3,
                    minLines: 1,
                    maxLength: 1000,
                    decoration: InputDecoration(
                      hintText: t(context, 'Write a comment...', 'اكتب تعليقًا...'),
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
                  onPressed: _submitting ? null : _submitComment,
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
