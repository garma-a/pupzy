import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/comment.dart';
import '../models/comment_submission.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/comment_image_compressor.dart';
import '../utils/comment_submission_manager.dart';
import '../utils/time_format.dart';
import 'animated_boost_chip.dart';

/// Reusable discussion surface for viewing and publishing top-level Comments and Replies on a Post.
/// Supports loading, empty, error, pagination, reply creation, thread expansion, and owner deletion.
/// Renders all text strictly as plain text (never executes user-supplied markup).
/// Renders deleted comments as neutral tombstones without leaking author identity or original text.
class PostCommentsSheet extends StatefulWidget {
  final String postId;
  final String? postCreatorId;
  final VoidCallback? onCommentCreated;

  const PostCommentsSheet({
    super.key,
    required this.postId,
    this.postCreatorId,
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
  bool _compressing = false;
  String? _errorMessage;
  String? _createErrorMessage;
  CommentSubmissionError? _submissionError;
  String? _currentUserId;

  final CommentSubmissionManager _submissionManager = CommentSubmissionManager();

  CommentSubmissionManager get submissionManager => _submissionManager;
  CommentSubmissionError? get submissionError => _submissionError;
  String? get currentClientRequestId =>
      _submissionManager.currentSubmission?.clientRequestId;

  final List<XFile> _selectedImages = [];
  final List<Uint8List> _compressedImagesBytes = [];

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

  String _getLocalizedErrorMessage(BuildContext context, CommentSubmissionError error) {
    final pos = error.mediaPosition;
    final posPrefix = pos != null
        ? t(context, 'Image ${pos + 1}: ', 'الصورة ${pos + 1}: ')
        : '';
    switch (error.code) {
      case 'COMMENT_MEDIA_INVALID_FORMAT':
        return '$posPrefix${t(context, 'Only static WebP images are supported. Please choose another image.', 'يتم دعم صور WebP الثابتة فقط. يرجى اختيار صورة أخرى.')}';
      case 'COMMENT_MEDIA_TOO_LARGE':
        return '$posPrefix${t(context, 'Image exceeds the 100 KB limit. Please choose another image.', 'يتجاوز حجم الصورة حد 100 كيلوبايت. يرجى اختيار صورة أخرى.')}';
      case 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED':
        return '$posPrefix${t(context, 'Image dimensions exceed 480x480 pixels.', 'تتجاوز أبعاد الصورة 480×480 بكسل.')}';
      case 'COMMENT_MEDIA_METADATA_FORBIDDEN':
        return '$posPrefix${t(context, 'Image contains embedded metadata. Please re-select.', 'تحتوي الصورة على بيانات وصفية مدمجة. يرجى إعادة الاختيار.')}';
      case 'COMMENT_MEDIA_NOT_READY':
        return '$posPrefix${t(context, 'Media upload is still processing. Please retry.', 'لا يزال رفع الوسائط قيد المعالجة. يرجى إعادة المحاولة.')}';
      case 'COMMENT_MEDIA_BLOCKED':
        return '$posPrefix${t(context, 'This image cannot be uploaded as it violates platform guidelines.', 'لا يمكن رفع هذه الصورة لأنها تنتهك إرشادات المنصة.')}';
      case 'COMMENT_MEDIA_CLAIM_CONFLICT':
        return '$posPrefix${t(context, 'Upload ticket is invalid. Please select the image again.', 'تذكرة الرفع غير صالحة. يرجى تحديد الصورة مرة أخرى.')}';
      case 'COMMENT_MEDIA_NOT_AVAILABLE':
        return '$posPrefix${t(context, 'Media is no longer available. Please select the image again.', 'الوسائط لم تعد متاحة. يرجى تحديد الصورة مرة أخرى.')}';
      case 'COMMENT_MEDIA_ALREADY_USED':
        return '$posPrefix${t(context, 'Media has already been published. Please select a fresh image.', 'تم نشر الوسائط بالفعل. يرجى تحديد صورة جديدة.')}';
      case 'COMMENT_MEDIA_PROCESSING_FAILED':
        return '$posPrefix${t(context, 'Media processing temporarily failed. Please retry.', 'فشلت معالجة الوسائط مؤقتًا. يرجى إعادة المحاولة.')}';
      case 'COMMENT_IMAGES_DISABLED':
        return t(context, 'Image attachments are temporarily disabled. You can still post text comments.', 'تم تعطيل إرفاق الصور مؤقتًا. لا يزال بإمكانك نشر تعليقات نصية.');
      case 'CONFLICT':
        return t(context, 'A different comment with this request ID was already submitted. Please try again.', 'تم إرسال تعليق مختلف بمعرف الطلب هذا بالفعل. يرجى المحاولة مرة أخرى.');
      case 'RATE_LIMITED':
        return t(context, 'You are commenting too fast. Please wait a moment.', 'أنت تعلق بسرعة كبيرة. يرجى الانتظار لحظة.');
      case 'NETWORK_ERROR':
        return '$posPrefix${t(context, 'Network error. Please check your connection and retry.', 'خطأ في الشبكة. يرجى التحقق من اتصالك وإعادة المحاولة.')}';
      default:
        return '$posPrefix${error.message}';
    }
  }

  @override
  void initState() {
    super.initState();
    _loadInitial();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
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
      _submissionError = null;
      _selectedImages.clear();
      _compressedImagesBytes.clear();
      _submissionManager.reset();
    });
  }

  void _cancelReplying() {
    setState(() {
      _replyingToComment = null;
      _createErrorMessage = null;
      _submissionError = null;
      _submissionManager.reset();
    });
  }

  Future<void> _pickCommentImage() async {
    if (_replyingToComment != null) return;
    if (_selectedImages.length >= 2) {
      setState(() {
        _submissionError = null;
        _createErrorMessage = t(
          context,
          'You can only attach up to 2 images.',
          'يمكنك إرفاق صورتين كحد أقصى.',
        );
      });
      return;
    }

    setState(() {
      _compressing = true;
      _createErrorMessage = null;
      _submissionError = null;
    });

    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: ImageSource.gallery,
      );

      if (picked == null) {
        if (mounted) setState(() => _compressing = false);
        return;
      }

      final rawBytes = await picked.readAsBytes();
      final result = CommentImageCompressor.compress(rawBytes);

      if (!mounted) return;

      if (result is CommentImageSuccess) {
        setState(() {
          _selectedImages.add(picked);
          _compressedImagesBytes.add(result.bytes);
          _compressing = false;
          _createErrorMessage = null;
          _submissionError = null;
          _submissionManager.reset();
        });
      } else if (result is CommentImageFailure) {
        setState(() {
          _compressing = false;
          _submissionError = CommentSubmissionError.permanent(
            code: 'COMMENT_MEDIA_TOO_LARGE',
            message: result.messageEn,
          );
          _createErrorMessage = t(
            context,
            result.messageEn,
            result.messageAr,
          );
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _compressing = false;
          _submissionError = null;
          _createErrorMessage = t(
            context,
            'Failed to pick or compress image.',
            'فشل اختيار أو ضغط الصورة.',
          );
        });
      }
    }
  }

  void _removeCommentImage(int index) {
    setState(() {
      if (index >= 0 && index < _selectedImages.length) {
        _selectedImages.removeAt(index);
        _compressedImagesBytes.removeAt(index);
        _submissionManager.reset();
        _createErrorMessage = null;
        _submissionError = null;
      }
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
          if (_comments[pIdx].isTombstone && newCount == 0) {
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
              isPinned: false,
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

  Future<void> _pinComment(Comment comment) async {
    if (comment.isPinned) return; // Idempotent no-op

    // Snapshot for rollback
    final previousComments = List<Comment>.from(_comments);

    // Optimistic update:
    // Move comment to index 0, mark isPinned = true, and unpin any other comment
    setState(() {
      final index = _comments.indexWhere((c) => c.id == comment.id);
      if (index != -1) {
        final target = _comments.removeAt(index).copyWith(isPinned: true);
        for (int i = 0; i < _comments.length; i++) {
          if (_comments[i].isPinned) {
            _comments[i] = _comments[i].copyWith(isPinned: false);
          }
        }
        _comments.insert(0, target);
      }
    });

    final graphql = context.read<GraphQLService>();
    final (pinnedComment, error) = await graphql.pinComment(comment.id);

    if (!mounted) return;

    if (pinnedComment == null || error != null) {
      // Rollback on failure
      setState(() {
        _comments
          ..clear()
          ..addAll(previousComments);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? t(context, 'Failed to pin comment.', 'فشل تثبيت التعليق.')),
          backgroundColor: AppColors.critical,
        ),
      );
    } else {
      // Reconcile server response
      setState(() {
        final idx = _comments.indexWhere((c) => c.id == pinnedComment.id);
        if (idx != -1) {
          _comments[idx] = pinnedComment;
        }
      });
    }
  }

  Future<void> _unpinComment(Comment comment) async {
    if (!comment.isPinned) return; // Idempotent no-op

    // Snapshot for rollback
    final previousComments = List<Comment>.from(_comments);

    // Optimistic update: mark isPinned = false
    setState(() {
      final index = _comments.indexWhere((c) => c.id == comment.id);
      if (index != -1) {
        _comments[index] = _comments[index].copyWith(isPinned: false);
      }
    });

    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.unpinComment(widget.postId);

    if (!mounted) return;

    if (!success) {
      // Rollback on failure
      setState(() {
        _comments
          ..clear()
          ..addAll(previousComments);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? t(context, 'Failed to unpin comment.', 'فشل إلغاء تثبيت التعليق.')),
          backgroundColor: AppColors.critical,
        ),
      );
    }
  }

  void _showCommentOptions(
    BuildContext context,
    Comment comment, {
    required bool isAuthor,
    required bool isPostCreator,
    required bool isAr,
    String? parentCommentId,
  }) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Wrap(
              children: [
                if (isPostCreator && !comment.isReply) ...[
                  if (comment.isPinned)
                    ListTile(
                      leading: const Icon(Icons.push_pin_outlined, color: AppColors.textPrimary),
                      title: Text(t(ctx, 'Unpin Comment', 'إلغاء تثبيت التعليق')),
                      onTap: () {
                        Navigator.of(ctx).pop();
                        _unpinComment(comment);
                      },
                    )
                  else
                    ListTile(
                      leading: const Icon(Icons.push_pin, color: AppColors.primary),
                      title: Text(t(ctx, 'Pin Comment', 'تثبيت التعليق')),
                      onTap: () {
                        Navigator.of(ctx).pop();
                        _pinComment(comment);
                      },
                    ),
                ],
                if (isAuthor)
                  ListTile(
                    leading: const Icon(Icons.delete_outline, color: AppColors.critical),
                    title: Text(
                      comment.isReply
                          ? t(ctx, 'Delete Reply', 'حذف الرد')
                          : t(ctx, 'Delete Comment', 'حذف التعليق'),
                      style: const TextStyle(color: AppColors.critical),
                    ),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      _confirmDelete(comment, parentCommentId: parentCommentId);
                    },
                  ),
                if (!isAuthor)
                  ListTile(
                    leading: const Icon(Icons.flag_outlined, color: AppColors.critical),
                    title: Text(
                      comment.isReply
                          ? t(ctx, 'Report Reply', 'الإبلاغ عن الرد')
                          : t(ctx, 'Report Comment', 'الإبلاغ عن التعليق'),
                      style: const TextStyle(color: AppColors.critical),
                    ),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      if (_currentUserId == null) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              t(
                                context,
                                'Please log in to report content.',
                                'يرجى تسجيل الدخول للإبلاغ عن المحتوى.',
                              ),
                            ),
                            backgroundColor: AppColors.critical,
                          ),
                        );
                        return;
                      }
                      _showReportDialog(context, comment, parentCommentId: parentCommentId, isAr: isAr);
                    },
                  ),
                ListTile(
                  leading: const Icon(Icons.close, color: AppColors.textMuted),
                  title: Text(t(ctx, 'Cancel', 'إلغاء')),
                  onTap: () => Navigator.of(ctx).pop(),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showReportDialog(
    BuildContext context,
    Comment comment, {
    String? parentCommentId,
    required bool isAr,
  }) {
    String selectedReason = 'INAPPROPRIATE_CONTENT';
    final detailsController = TextEditingController();

    final reasons = [
      (
        'INAPPROPRIATE_CONTENT',
        t(context, 'Inappropriate content', 'محتوى غير لائق'),
        t(context, 'Offensive, harmful, or inappropriate imagery/text', 'محتوى مسيء أو ضار أو غير لائق'),
      ),
      (
        'SPAM',
        t(context, 'Spam', 'محتوى غير مرغوب فيه (سبام)'),
        t(context, 'Advertising, promotional, or repetitive content', 'إعلانات أو ترويج أو تكرار'),
      ),
      (
        'UNRELATED_TO_ANIMALS',
        t(context, 'Unrelated to animals', 'لا علاقة له بالحيوانات'),
        t(context, 'Off-topic or irrelevant to pet community', 'خارج عن سياق مجتمع الحيوانات الأليفة'),
      ),
      (
        'SCAM',
        t(context, 'Scam or fraud', 'احتيال أو خداع'),
        t(context, 'Suspected financial fraud or deceptive behavior', 'اشتباه في احتيال مالي أو سلوك مخادع'),
      ),
      (
        'DUPLICATE',
        t(context, 'Duplicate', 'محتوى مكرر'),
        t(context, 'Repeated or duplicate submission', 'مشاركة متكررة أو منسوخة'),
      ),
      (
        'OTHER',
        t(context, 'Other', 'سبب آخر'),
        t(context, 'Any other concern', 'أي سبب أو ملاحظة أخرى'),
      ),
    ];

    showDialog<void>(
      context: context,
      builder: (dialogCtx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              backgroundColor: AppColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.card),
              ),
              title: Text(
                comment.isReply
                    ? t(ctx, 'Report Reply', 'الإبلاغ عن الرد')
                    : t(ctx, 'Report Comment', 'الإبلاغ عن التعليق'),
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary,
                    ),
              ),
              content: SizedBox(
                width: double.maxFinite,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t(ctx, 'Why are you reporting this?', 'لماذا تبلغ عن هذا التعليق؟'),
                        style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                              color: AppColors.textSecondary,
                            ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      ...reasons.map((r) {
                        final (value, label, subtitle) = r;
                        return RadioListTile<String>(
                          value: value,
                          // ignore: deprecated_member_use
                          groupValue: selectedReason,
                          // ignore: deprecated_member_use
                          onChanged: (val) {
                            if (val != null) {
                              setDialogState(() => selectedReason = val);
                            }
                          },
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          activeColor: AppColors.primary,
                          title: Text(
                            label,
                            style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.textPrimary,
                                ),
                          ),
                          subtitle: Text(
                            subtitle,
                            style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                                  color: AppColors.textMuted,
                                  fontSize: 11,
                                ),
                          ),
                        );
                      }),
                      const SizedBox(height: AppSpacing.sm),
                      TextField(
                        controller: detailsController,
                        maxLength: 500,
                        maxLines: 2,
                        decoration: InputDecoration(
                          hintText: t(ctx, 'Additional details (optional)', 'تفاصيل إضافية (اختياري)'),
                          hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.image),
                            borderSide: const BorderSide(color: AppColors.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.image),
                            borderSide: const BorderSide(color: AppColors.primary),
                          ),
                          contentPadding: const EdgeInsets.all(AppSpacing.sm),
                        ),
                        style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogCtx).pop(),
                  child: Text(
                    t(ctx, 'Cancel', 'إلغاء'),
                    style: const TextStyle(color: AppColors.textMuted),
                  ),
                ),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                  ),
                  onPressed: () {
                    Navigator.of(dialogCtx).pop();
                    _submitReport(
                      comment,
                      selectedReason,
                      detailsController.text,
                      parentCommentId: parentCommentId,
                    );
                  },
                  child: Text(t(ctx, 'Submit Report', 'إرسال البلاغ')),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _submitReport(
    Comment comment,
    String reason,
    String? details, {
    String? parentCommentId,
  }) async {
    final graphql = context.read<GraphQLService>();
    final (success, errorMessage, isDuplicate) = await graphql.reportComment(
      commentId: comment.id,
      reason: reason,
      details: details,
    );

    if (!mounted) return;

    if (isDuplicate) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            t(
              context,
              'You have already reported this comment.',
              'لقد قمت بالإبلاغ عن هذا التعليق مسبقاً.',
            ),
          ),
          backgroundColor: AppColors.textSecondary,
        ),
      );
      return;
    }

    if (!success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            errorMessage ??
                t(
                  context,
                  'Failed to submit report. Please try again.',
                  'فشل إرسال البلاغ. يرجى المحاولة مرة أخرى.',
                ),
          ),
          backgroundColor: AppColors.critical,
        ),
      );
      return;
    }

    // Success state
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          t(
            context,
            'Thank you for reporting. Our moderation team will review this.',
            'شكراً لإبلاغك. سيقوم فريق الإشراف بمراجعة المحتوى.',
          ),
        ),
        backgroundColor: AppColors.sectionLineGreen,
      ),
    );

    // Refresh discussion visibility
    await _loadInitial();
    if (parentCommentId != null) {
      await _fetchRepliesForComment(parentCommentId);
    }
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
        _submissionError = null;
        _createErrorMessage = _replyingToComment != null
            ? t(context, 'Please enter a reply.', 'يرجى كتابة رد.')
            : t(context, 'Please enter a comment.', 'يرجى كتابة تعليق.');
      });
      return;
    }

    setState(() {
      _submitting = true;
      _createErrorMessage = null;
      _submissionError = null;
    });

    final graphql = context.read<GraphQLService>();
    final isReply = _replyingToComment != null;
    final targetId = isReply ? _replyingToComment!.id : widget.postId;
    final targetType = isReply ? CommentTargetType.reply : CommentTargetType.post;

    // Prepare or reuse canonical submission (AC 1, AC 5, AC 6)
    final submission = _submissionManager.prepareSubmission(
      targetId: targetId,
      targetType: targetType,
      text: trimmed,
      compressedImagesBytes: isReply ? [] : _compressedImagesBytes,
    );

    // Execute upload tickets + R2 PUTs + GraphQL create (AC 1, AC 3, AC 7)
    final result = await _submissionManager.execute(
      graphql: graphql,
      submission: submission,
    );

    if (!mounted) return;

    if (!result.success || result.comment == null) {
      setState(() {
        _submitting = false;
        _submissionError = result.error;
        _createErrorMessage = result.error != null
            ? _getLocalizedErrorMessage(context, result.error!)
            : t(context, 'Failed to publish.', 'فشل النشر.');
      });
      return;
    }

    final created = result.comment!;

    if (isReply) {
      final targetParent = _replyingToComment!;
      setState(() {
        _submitting = false;
        _createErrorMessage = null;
        _submissionError = null;
        _replyingToComment = null;
        _textController.clear();

        _expandedComments.add(targetParent.id);
        final currentReplies = _repliesMap[targetParent.id] ?? [];
        final alreadyExists = currentReplies.any((r) => r.id == created.id);

        if (!alreadyExists) {
          if (_repliesMap.containsKey(targetParent.id)) {
            _repliesMap[targetParent.id]!.add(created);
          } else {
            _repliesMap[targetParent.id] = [created];
          }

          final pIdx = _comments.indexWhere((c) => c.id == targetParent.id);
          if (pIdx != -1) {
            _comments[pIdx] = _comments[pIdx].copyWith(
              replyCount: _comments[pIdx].replyCount + 1,
            );
          }
        } else {
          // Reconcile in place without duplicate list entries (AC 2)
          final rIdx = currentReplies.indexWhere((r) => r.id == created.id);
          if (rIdx != -1) {
            currentReplies[rIdx] = created;
          }
        }
      });
    } else {
      setState(() {
        _submitting = false;
        _createErrorMessage = null;
        _submissionError = null;
        _selectedImages.clear();
        _compressedImagesBytes.clear();
        _textController.clear();

        // Reconcile canonical result without creating duplicate list entries (AC 2)
        final alreadyExists = _comments.any((c) => c.id == created.id);
        if (!alreadyExists) {
          final insertIndex = (_comments.isNotEmpty && _comments[0].isPinned) ? 1 : 0;
          _comments.insert(insertIndex, created);
        } else {
          final existingIdx = _comments.indexWhere((c) => c.id == created.id);
          if (existingIdx != -1) {
            _comments[existingIdx] = created;
          }
        }
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
      separatorBuilder: (_, index) => const Divider(height: AppSpacing.lg),
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
    final isPostCreator = !isTombstone && _currentUserId != null && widget.postCreatorId != null && widget.postCreatorId == _currentUserId;
    final isPinned = comment.isPinned && !isTombstone;
    final authorName = isTombstone ? '' : (comment.author?.displayName(isAr ? 'ar' : 'en') ?? 'User');
    final timeStr = timeAgo(comment.createdAt, isAr ? Lang.ar : Lang.en);
    final isExpanded = _expandedComments.contains(comment.id);
    final replies = _repliesMap[comment.id] ?? [];
    final isLoadingReplies = _loadingReplies.contains(comment.id);
    final hasMoreReplies = _repliesHasNextPage[comment.id] ?? false;
    final isLoadingMoreReplies = _loadingMoreReplies.contains(comment.id);

    final itemWidget = Column(
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
                  // Pinned badge
                  if (isPinned) ...[
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.push_pin, size: 12, color: AppColors.primary),
                        const SizedBox(width: 4),
                        Text(
                          t(context, 'Pinned comment', 'تعليق مثبّت'),
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                  ],

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
                      // Options button (delete for author, pin/unpin for post creator, report for non-author)
                      if (!isTombstone)
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(Icons.more_horiz, size: 18, color: AppColors.textMuted),
                          onPressed: () => _showCommentOptions(
                            context,
                            comment,
                            isAuthor: isAuthor,
                            isPostCreator: isPostCreator,
                            isAr: isAr,
                          ),
                          tooltip: t(context, 'Options', 'خيارات'),
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
                  if (!isTombstone && comment.media.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sm),
                    if (comment.media.length == 1)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(AppRadius.image),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(
                            maxHeight: 280,
                            maxWidth: 320,
                          ),
                          child: CachedNetworkImage(
                            imageUrl: comment.media.first.publicUrl,
                            fit: BoxFit.cover,
                            placeholder: (ctx, url) => Container(
                              height: 160,
                              color: AppColors.background,
                              child: const Center(
                                child: CircularProgressIndicator(strokeWidth: 2),
                              ),
                            ),
                            errorWidget: (ctx, url, error) => Container(
                              height: 120,
                              color: AppColors.background,
                              child: const Center(
                                child: Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                              ),
                            ),
                          ),
                        ),
                      )
                    else
                      Row(
                        children: [
                          Expanded(
                            child: AspectRatio(
                              aspectRatio: 1.0,
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(AppRadius.image),
                                child: CachedNetworkImage(
                                  imageUrl: comment.media[0].publicUrl,
                                  fit: BoxFit.cover,
                                  placeholder: (ctx, url) => Container(
                                    color: AppColors.background,
                                    child: const Center(
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  ),
                                  errorWidget: (ctx, url, error) => Container(
                                    color: AppColors.background,
                                    child: const Center(
                                      child: Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: AspectRatio(
                              aspectRatio: 1.0,
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(AppRadius.image),
                                child: CachedNetworkImage(
                                  imageUrl: comment.media[1].publicUrl,
                                  fit: BoxFit.cover,
                                  placeholder: (ctx, url) => Container(
                                    color: AppColors.background,
                                    child: const Center(
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  ),
                                  errorWidget: (ctx, url, error) => Container(
                                    color: AppColors.background,
                                    child: const Center(
                                      child: Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                  ],
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

    if (isPinned) {
      return Container(
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.18)),
        ),
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: itemWidget,
      );
    }

    return itemWidget;
  }

  Widget _buildReplyItem(BuildContext context, Comment reply, String parentCommentId, bool isAr) {
    final isAuthor = _currentUserId != null && reply.author?.id == _currentUserId;
    final authorName = reply.author?.displayName(isAr ? 'ar' : 'en') ?? 'User';
    final timeStr = timeAgo(reply.createdAt, isAr ? Lang.ar : Lang.en);

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
                  // Options button (delete for author, report for non-author)
                  IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    icon: const Icon(Icons.more_horiz, size: 16, color: AppColors.textMuted),
                    onPressed: () => _showCommentOptions(
                      context,
                      reply,
                      isAuthor: isAuthor,
                      isPostCreator: false,
                      isAr: isAr,
                      parentCommentId: parentCommentId,
                    ),
                    tooltip: t(context, 'Options', 'خيارات'),
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

            // Image previews above input row if selected
            if (_selectedImages.isNotEmpty && !isReplying) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: List.generate(_selectedImages.length, (index) {
                    final bytes = _compressedImagesBytes[index];
                    return Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Stack(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(AppRadius.image),
                              child: Image.memory(
                                bytes,
                                width: 60,
                                height: 60,
                                fit: BoxFit.cover,
                              ),
                            ),
                            Positioned(
                              top: 2,
                              left: 2,
                              child: Container(
                                padding: const EdgeInsets.all(3),
                                decoration: const BoxDecoration(
                                  color: Colors.black87,
                                  shape: BoxShape.circle,
                                ),
                                child: Text(
                                  '${index + 1}',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ),
                            Positioned(
                              top: 2,
                              right: 2,
                              child: GestureDetector(
                                onTap: () => _removeCommentImage(index),
                                child: Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: const BoxDecoration(
                                    color: Colors.black54,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(Icons.close, size: 14, color: Colors.white),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '${(bytes.length / 1024).toStringAsFixed(1)} KB',
                          style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                        ),
                      ],
                    );
                  }),
                ),
              ),
            ],

            // Input Row
            Row(
              children: [
                if (!isReplying) ...[
                  IconButton(
                    onPressed: _submitting || _compressing || _selectedImages.length >= 2
                        ? null
                        : _pickCommentImage,
                    icon: _compressing
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            _selectedImages.isNotEmpty ? Icons.photo : Icons.photo_outlined,
                            color: _selectedImages.isNotEmpty ? AppColors.primary : AppColors.textMuted,
                          ),
                    tooltip: t(context, 'Attach Image (Max 2)', 'إرفاق صورة (بحد أقصى 2)'),
                  ),
                ],
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
