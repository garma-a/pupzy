import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/comment.dart';
import '../models/safety.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/client_request_id.dart';
import '../utils/time_format.dart';
import 'safety_actions.dart';

/// Max bytes the backend accepts for a comment image (see
/// MAX_COMMENT_IMAGE_BYTES in comment-image.validator.ts).
const int _kCommentImageMaxBytes = 100000;

/// Max width/height and pixel count the backend accepts for a comment image
/// (see MAX_COMMENT_IMAGE_WIDTH/HEIGHT/PIXELS in comment-image.validator.ts
/// — it rejects on dimensions independently of byte size).
const int _kCommentImageMaxSide = 480;
const int _kCommentImageMaxPixels = _kCommentImageMaxSide * _kCommentImageMaxSide;

String _authorName(BuildContext context, CommentAuthor? author) {
  if (author == null) return t(context, 'Deleted user', 'مستخدم محذوف');
  final ar = Localizations.localeOf(context).languageCode == 'ar';
  final name = ar ? (author.fullNameArabic ?? author.fullName) : (author.fullName ?? author.fullNameArabic);
  return name ?? t(context, 'Pupzy user', 'مستخدم Pupzy');
}

/// Decodes [bytes] just far enough to read its actual pixel dimensions.
Future<(int width, int height)> _decodedDimensions(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  final size = (frame.image.width, frame.image.height);
  frame.image.dispose();
  codec.dispose();
  return size;
}

/// Compresses a picked image down to WebP that fits both the backend's byte
/// budget ([_kCommentImageMaxBytes]) and its pixel-dimension cap
/// ([_kCommentImageMaxSide] on each side). Returns null if compression isn't
/// achievable (e.g. unsupported platform) so the caller can skip the image
/// gracefully.
///
/// `compressWithFile`'s `minWidth`/`minHeight` are NOT a hard ceiling on
/// their own: the plugin picks `scale = min(srcW/minWidth, srcH/minHeight)`,
/// so for any non-square source (i.e. virtually every real camera photo)
/// only the axis needing *less* shrinking is guaranteed to land at the
/// target — the other axis can still come out larger. Passing 480 for both
/// only reliably works for square sources. So every attempt's actual output
/// is re-decoded and measured here rather than trusted from the input
/// parameters, and the retry loop keeps shrinking until it's verified to
/// actually fit — this is what makes the guarantee real instead of
/// aspirational.
Future<Uint8List?> _compressToWebpUnderLimit(XFile file) async {
  try {
    int quality = 80;
    int minSide = _kCommentImageMaxSide;
    for (var attempt = 0; attempt < 8; attempt++) {
      final result = await FlutterImageCompress.compressWithFile(
        file.path,
        format: CompressFormat.webp,
        quality: quality,
        minWidth: minSide,
        minHeight: minSide,
      );
      if (result == null) return null;
      if (result.lengthInBytes <= _kCommentImageMaxBytes) {
        final (width, height) = await _decodedDimensions(result);
        if (width <= _kCommentImageMaxSide && height <= _kCommentImageMaxSide && width * height <= _kCommentImageMaxPixels) {
          return result;
        }
      }
      quality = (quality - 12).clamp(20, 100);
      minSide = (minSide * 0.75).round();
      if (minSide < 16) return null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

/// Bottom sheet showing a post's discussion: top-level comments (with Top/
/// Newest sort), expandable text-only replies, boosts, pinning (post owner
/// only), delete (own comments), and reporting. Opens via
/// `showModalBottomSheet(... builder: (_) => CommentsSheet(...))`.
class CommentsSheet extends StatefulWidget {
  final String postId;
  final bool isPostOwner;

  const CommentsSheet({super.key, required this.postId, this.isPostOwner = false});

  @override
  State<CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends State<CommentsSheet> {
  bool _loading = true;
  String? _errorMessage;
  String _sort = 'TOP';
  List<Comment> _comments = [];
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  String? _myUserId;

  /// Authors blocked during this sheet's lifetime. Their comments and replies
  /// disappear immediately; the server already omits them on the next load.
  final Set<String> _hiddenAuthorIds = {};

  final _textController = TextEditingController();
  XFile? _pendingImage;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
    context.read<GraphQLService>().fetchMe().then((me) {
      if (mounted) setState(() => _myUserId = me?['id'] as String?);
    });
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final (comments, endCursor, hasNext, error) = await graphql.fetchComments(postId: widget.postId, sort: _sort);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _comments = comments;
      _endCursor = endCursor;
      _hasNextPage = hasNext;
      _errorMessage = error;
    });
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage) return;
    setState(() => _loadingMore = true);
    final graphql = context.read<GraphQLService>();
    final (comments, endCursor, hasNext, _) = await graphql.fetchComments(postId: widget.postId, sort: _sort, after: _endCursor);
    if (!mounted) return;
    setState(() {
      _loadingMore = false;
      _comments = [..._comments, ...comments];
      _endCursor = endCursor;
      _hasNextPage = hasNext;
    });
  }

  void _setSort(String sort) {
    if (sort == _sort) return;
    setState(() => _sort = sort);
    _load();
  }

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600, imageQuality: 90);
    if (picked != null && mounted) setState(() => _pendingImage = picked);
  }

  Future<void> _send() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    final graphql = context.read<GraphQLService>();

    List<String>? mediaIds;
    final image = _pendingImage;
    if (image != null) {
      final webpBytes = await _compressToWebpUnderLimit(image);
      if (webpBytes == null) {
        if (!mounted) return;
        Fluttertoast.showToast(
          msg: t(context, "Couldn't prepare that image for upload — posting without it.", 'تعذر تجهيز هذه الصورة للرفع \u2014 سيتم النشر بدونها.'),
        );
      } else {
        final ticket = await graphql.requestCommentImageUploadUrl(contentType: 'image/webp', fileSizeBytes: webpBytes.length);
        if (!mounted) return;
        final uploadInfo = ticket.$1;
        if (uploadInfo == null) {
          Fluttertoast.showToast(msg: ticket.$2 ?? t(context, 'Could not upload image. Posting without it.', 'تعذر رفع الصورة. سيتم النشر بدونها.'));
        } else {
          final response = await http.put(
            Uri.parse(uploadInfo['uploadUrl'] as String),
            headers: {'Content-Type': 'image/webp'},
            body: webpBytes,
          );
          if (!mounted) return;
          if (response.statusCode >= 200 && response.statusCode < 300) {
            mediaIds = [uploadInfo['mediaId'] as String];
          } else {
            Fluttertoast.showToast(msg: t(context, 'Image upload failed. Posting without it.', 'فشل رفع الصورة. سيتم النشر بدونها.'));
          }
        }
      }
    }

    final (comment, error) = await graphql.createComment(
      clientRequestId: generateClientRequestId(),
      postId: widget.postId,
      text: text,
      mediaIds: mediaIds,
    );
    if (!mounted) return;
    setState(() => _sending = false);
    if (comment == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not post comment. Try again.', 'تعذر نشر التعليق. حاول مرة أخرى.'));
      return;
    }
    setState(() {
      _textController.clear();
      _pendingImage = null;
      // New comments always sort first under both TOP (no boosts yet) and
      // NEWEST, so prepending matches what a re-fetch would show.
      _comments = [comment, ..._comments];
    });
  }

  void _replaceComment(Comment updated) {
    setState(() {
      _comments = _comments.map((c) => c.id == updated.id ? updated : c).toList();
    });
  }

  void _removeComment(String id) {
    setState(() => _comments = _comments.where((c) => c.id != id).toList());
  }

  Future<void> _pinComment(Comment comment) async {
    final graphql = context.read<GraphQLService>();
    final (pinned, error) = await graphql.pinComment(comment.id);
    if (!mounted) return;
    if (pinned == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not pin comment.', 'تعذر تثبيت التعليق.'));
      return;
    }
    setState(() {
      _comments = _comments.map((c) {
        if (c.id == pinned.id) return pinned;
        if (c.isPinned) return c.copyWith(isPinned: false);
        return c;
      }).toList();
    });
  }

  Future<void> _unpinComment(Comment comment) async {
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.unpinComment(widget.postId);
    if (!mounted) return;
    if (!success) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not unpin comment.', 'تعذر إلغاء تثبيت التعليق.'));
      return;
    }
    _replaceComment(comment.copyWith(isPinned: false));
  }

  Future<void> _deleteComment(Comment comment) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(t(ctx, 'Delete this comment?', 'حذف هذا التعليق؟')),
        content: Text(t(ctx, 'This cannot be undone.', 'لا يمكن التراجع عن هذا.')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t(ctx, 'Delete', 'حذف'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.deleteComment(comment.id);
    if (!mounted) return;
    if (!success) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not delete comment.', 'تعذر حذف التعليق.'));
      return;
    }
    _removeComment(comment.id);
  }

  void _hideAuthor(String authorId) {
    setState(() {
      _hiddenAuthorIds.add(authorId);
      _comments = _comments.where((c) => c.author?.id != authorId).toList();
    });
  }

  /// Reports a Comment or Reply (same `commentId` space), then offers to block
  /// its author. Hides the author's content if the follow-up block happens.
  Future<void> _reportComment(Comment target) async {
    final authorId = target.author?.id;
    final blocked = await reportCommentFlow(context, commentId: target.id, authorId: authorId);
    if (blocked && authorId != null && mounted) _hideAuthor(authorId);
  }

  Future<void> _reportAccountOf(Comment target) async {
    final authorId = target.author?.id;
    if (authorId == null) return;
    final blocked = await reportAccountFlow(
      context,
      userId: authorId,
      sourceType: AccountReportSource.comment,
      sourceId: target.id,
    );
    if (blocked && mounted) _hideAuthor(authorId);
  }

  Future<void> _blockAuthorOf(Comment target) async {
    final authorId = target.author?.id;
    if (authorId == null) return;
    final blocked = await blockAccountFlow(context, userId: authorId);
    if (blocked && mounted) _hideAuthor(authorId);
  }

  @override
  Widget build(BuildContext context) {
    final lang = context.watch<LangProvider>().lang;
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
          ),
          child: Column(
            children: [
              const SizedBox(height: AppSpacing.sm),
              Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
                child: Row(
                  children: [
                    Text(t(context, 'Comments', 'التعليقات'), style: Theme.of(context).textTheme.headlineMedium),
                    const Spacer(),
                    _SortToggle(sort: _sort, onChanged: _setSort),
                  ],
                ),
              ),
              const Divider(height: 1, color: AppColors.border),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _errorMessage != null
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(AppSpacing.xl),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.cloud_off_outlined, size: 36, color: AppColors.textMuted),
                                  const SizedBox(height: AppSpacing.sm),
                                  Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                                  const SizedBox(height: AppSpacing.md),
                                  OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                                ],
                              ),
                            ),
                          )
                        : _comments.isEmpty
                            ? Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.mode_comment_outlined, size: 40, color: AppColors.textMuted),
                                    const SizedBox(height: AppSpacing.sm),
                                    Text(t(context, 'No comments yet — be the first', 'لا توجد تعليقات بعد \u2014 كن أول من يعلق'), style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted)),
                                  ],
                                ),
                              )
                            : ListView.builder(
                                controller: scrollController,
                                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
                                itemCount: _comments.length + (_hasNextPage ? 1 : 0),
                                itemBuilder: (context, i) {
                                  if (i >= _comments.length) {
                                    if (!_loadingMore) {
                                      WidgetsBinding.instance.addPostFrameCallback((_) => _loadMore());
                                    }
                                    return const Padding(
                                      padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                                      child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
                                    );
                                  }
                                  final comment = _comments[i];
                                  return _CommentTile(
                                    key: ValueKey(comment.id),
                                    comment: comment,
                                    lang: lang,
                                    isMine: comment.author?.id == _myUserId,
                                    myUserId: _myUserId,
                                    isPostOwner: widget.isPostOwner,
                                    onBoostChanged: (updated) => _replaceComment(updated),
                                    onPin: () => _pinComment(comment),
                                    onUnpin: () => _unpinComment(comment),
                                    onDelete: () => _deleteComment(comment),
                                    onReport: _reportComment,
                                    onReportAccount: _reportAccountOf,
                                    onBlockAuthor: _blockAuthorOf,
                                    hiddenAuthorIds: _hiddenAuthorIds,
                                    onReplyCountChanged: (count) => _replaceComment(comment.copyWith(replyCount: count)),
                                  );
                                },
                              ),
              ),
              const Divider(height: 1, color: AppColors.border),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_pendingImage != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Stack(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.file(File(_pendingImage!.path), width: 64, height: 64, fit: BoxFit.cover),
                              ),
                              Positioned(
                                top: -6,
                                right: -6,
                                child: GestureDetector(
                                  onTap: () => setState(() => _pendingImage = null),
                                  child: const CircleAvatar(radius: 10, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 12, color: Colors.white)),
                                ),
                              ),
                            ],
                          ),
                        ),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          IconButton(
                            onPressed: _pendingImage == null ? _pickImage : null,
                            icon: const Icon(Icons.image_outlined),
                            color: AppColors.textMuted,
                            tooltip: t(context, 'Attach image', 'إرفاق صورة'),
                          ),
                          Expanded(
                            child: TextField(
                              controller: _textController,
                              minLines: 1,
                              maxLines: 4,
                              // Backend hard-limit (validateCommentText): 1,000 Unicode characters.
                              maxLength: 1000,
                              onChanged: (_) => setState(() {}),
                              decoration: InputDecoration(
                                hintText: t(context, 'Add a comment...', 'أضف تعليقًا...'),
                                filled: true,
                                fillColor: AppColors.surfaceWarm,
                                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.chip), borderSide: BorderSide.none),
                                counterText: '',
                              ),
                            ),
                          ),
                          const SizedBox(width: AppSpacing.xs),
                          IconButton(
                            onPressed: _sending || _textController.text.trim().isEmpty ? null : _send,
                            icon: _sending
                                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(Icons.send),
                            color: AppColors.primary,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SortToggle extends StatelessWidget {
  final String sort;
  final ValueChanged<String> onChanged;
  const _SortToggle({required this.sort, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    Widget option(String value, String label) {
      final selected = sort == value;
      return GestureDetector(
        onTap: () => onChanged(value),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? AppColors.primary.withValues(alpha: 0.15) : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.chip),
          ),
          child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: selected ? AppColors.primary : AppColors.textMuted)),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(color: AppColors.surfaceWarm, borderRadius: BorderRadius.circular(AppRadius.chip)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        option('TOP', t(context, 'Top', 'الأعلى')),
        option('NEWEST', t(context, 'Newest', 'الأحدث')),
      ]),
    );
  }
}

class _CommentTile extends StatefulWidget {
  final Comment comment;
  final Lang lang;
  final bool isMine;
  final String? myUserId;
  final bool isPostOwner;
  final ValueChanged<Comment> onBoostChanged;
  final VoidCallback onPin;
  final VoidCallback onUnpin;
  final VoidCallback onDelete;
  final ValueChanged<Comment> onReport;
  final ValueChanged<Comment> onReportAccount;
  final ValueChanged<Comment> onBlockAuthor;
  final Set<String> hiddenAuthorIds;
  final ValueChanged<int> onReplyCountChanged;

  const _CommentTile({
    super.key,
    required this.comment,
    required this.lang,
    required this.isMine,
    required this.myUserId,
    required this.isPostOwner,
    required this.onBoostChanged,
    required this.onPin,
    required this.onUnpin,
    required this.onDelete,
    required this.onReport,
    required this.onReportAccount,
    required this.onBlockAuthor,
    required this.hiddenAuthorIds,
    required this.onReplyCountChanged,
  });

  @override
  State<_CommentTile> createState() => _CommentTileState();
}

class _CommentTileState extends State<_CommentTile> {
  bool _repliesExpanded = false;
  bool _loadingReplies = false;
  List<Comment> _replies = [];
  bool _replying = false;
  final _replyController = TextEditingController();
  bool _sendingReply = false;

  @override
  void dispose() {
    _replyController.dispose();
    super.dispose();
  }

  Future<void> _toggleBoost() async {
    final graphql = context.read<GraphQLService>();
    final comment = widget.comment;
    // Optimistic flip.
    final optimistic = comment.copyWith(isBoostedByMe: !comment.isBoostedByMe, boostCount: comment.boostCount + (comment.isBoostedByMe ? -1 : 1));
    widget.onBoostChanged(optimistic);
    final (count, boosted, error) = await graphql.toggleCommentBoost(comment.id);
    if (!mounted) return;
    if (count == null || boosted == null) {
      widget.onBoostChanged(comment); // revert
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return;
    }
    widget.onBoostChanged(comment.copyWith(boostCount: count, isBoostedByMe: boosted));
  }

  Future<void> _loadReplies() async {
    if (_loadingReplies) return;
    setState(() => _loadingReplies = true);
    final graphql = context.read<GraphQLService>();
    final (replies, _, _, _) = await graphql.fetchReplies(commentId: widget.comment.id);
    if (!mounted) return;
    setState(() {
      _loadingReplies = false;
      _replies = replies;
      _repliesExpanded = true;
    });
  }

  Future<void> _sendReply() async {
    final text = _replyController.text.trim();
    if (text.isEmpty || _sendingReply) return;
    setState(() => _sendingReply = true);
    final graphql = context.read<GraphQLService>();
    final (reply, error) = await graphql.createReply(
      clientRequestId: generateClientRequestId(),
      commentId: widget.comment.id,
      text: text,
    );
    if (!mounted) return;
    setState(() => _sendingReply = false);
    if (reply == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not post reply. Try again.', 'تعذر نشر الرد. حاول مرة أخرى.'));
      return;
    }
    setState(() {
      _replyController.clear();
      _replying = false;
      _repliesExpanded = true;
      _replies = [..._replies, reply];
    });
    widget.onReplyCountChanged(widget.comment.replyCount + 1);
  }

  Future<void> _deleteReply(Comment reply) async {
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.deleteComment(reply.id);
    if (!mounted) return;
    if (!success) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not delete reply.', 'تعذر حذف الرد.'));
      return;
    }
    setState(() => _replies = _replies.where((r) => r.id != reply.id).toList());
    widget.onReplyCountChanged((widget.comment.replyCount - 1).clamp(0, 1 << 30));
  }

  @override
  Widget build(BuildContext context) {
    final comment = widget.comment;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: AppColors.surfaceWarm,
                backgroundImage: comment.author?.profilePictureUrl != null ? NetworkImage(comment.author!.profilePictureUrl!) : null,
                child: comment.author?.profilePictureUrl == null ? const Icon(Icons.person, size: 16, color: AppColors.textMuted) : null,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(child: Text(_authorName(context, comment.author), style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
                        if (comment.isPinned) ...[
                          const SizedBox(width: 6),
                          Icon(Icons.push_pin, size: 12, color: AppColors.primary),
                        ],
                        const SizedBox(width: 6),
                        Text(timeAgo(comment.createdAt, widget.lang), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(comment.text, style: Theme.of(context).textTheme.bodyMedium),
                    if (comment.media.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(comment.media.first.publicUrl, height: 140, fit: BoxFit.cover),
                      ),
                    ] else if (comment.imageWasHidden) ...[
                      const SizedBox(height: 4),
                      Text(t(context, '[Image removed by moderation]', '[تمت إزالة الصورة بواسطة الإشراف]'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted, fontStyle: FontStyle.italic)),
                    ],
                    const SizedBox(height: AppSpacing.xs),
                    Row(
                      children: [
                        GestureDetector(
                          onTap: _toggleBoost,
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.arrow_upward, size: 14, color: comment.isBoostedByMe ? AppColors.primary : AppColors.textMuted),
                              const SizedBox(width: 3),
                              Text('${comment.boostCount}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: comment.isBoostedByMe ? AppColors.primary : AppColors.textMuted)),
                            ],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        GestureDetector(
                          onTap: () => setState(() => _replying = !_replying),
                          child: Text(t(context, 'Reply', 'رد'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        PopupMenuButton<String>(
                          icon: const Icon(Icons.more_horiz, size: 16, color: AppColors.textMuted),
                          padding: EdgeInsets.zero,
                          onSelected: (value) {
                            switch (value) {
                              case 'pin':
                                widget.onPin();
                                break;
                              case 'unpin':
                                widget.onUnpin();
                                break;
                              case 'delete':
                                widget.onDelete();
                                break;
                              case 'report':
                                widget.onReport(comment);
                                break;
                              case 'reportAccount':
                                widget.onReportAccount(comment);
                                break;
                              case 'block':
                                widget.onBlockAuthor(comment);
                                break;
                            }
                          },
                          itemBuilder: (ctx) => [
                            if (widget.isPostOwner && !comment.isPinned) PopupMenuItem(value: 'pin', child: Text(t(ctx, 'Pin comment', 'تثبيت التعليق'))),
                            if (widget.isPostOwner && comment.isPinned) PopupMenuItem(value: 'unpin', child: Text(t(ctx, 'Unpin comment', 'إلغاء تثبيت التعليق'))),
                            if (widget.isMine) PopupMenuItem(value: 'delete', child: Text(t(ctx, 'Delete', 'حذف'))),
                            if (!widget.isMine) PopupMenuItem(value: 'report', child: Text(t(ctx, 'Report Comment', 'الإبلاغ عن التعليق'))),
                            if (!widget.isMine && comment.author != null) PopupMenuItem(value: 'reportAccount', child: Text(t(ctx, 'Report Account', 'الإبلاغ عن الحساب'))),
                            if (!widget.isMine && comment.author != null)
                              PopupMenuItem(value: 'block', child: Text(t(ctx, 'Block Account', 'حظر الحساب'), style: const TextStyle(color: AppColors.critical))),
                          ],
                        ),
                      ],
                    ),
                    if (comment.replyCount > 0 && !_repliesExpanded)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: GestureDetector(
                          onTap: _loadReplies,
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(width: 20, height: 1, color: AppColors.border),
                              const SizedBox(width: 6),
                              _loadingReplies
                                  ? const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 1.5))
                                  : Text(
                                      comment.replyCount == 1
                                          ? t(context, 'View 1 reply', 'عرض رد واحد')
                                          : t(context, 'View ${comment.replyCount} replies', 'عرض ${comment.replyCount} ردود'),
                                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.primary),
                                    ),
                            ],
                          ),
                        ),
                      ),
                    if (_repliesExpanded)
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpacing.sm),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: _replies
                              .where((r) => r.author?.id == null || !widget.hiddenAuthorIds.contains(r.author!.id))
                              .map(
                                (r) => _ReplyTile(
                                  reply: r,
                                  lang: widget.lang,
                                  isMine: r.author?.id != null && r.author!.id == widget.myUserId,
                                  onDelete: () => _deleteReply(r),
                                  onReport: () => widget.onReport(r),
                                  onReportAccount: () => widget.onReportAccount(r),
                                  onBlock: () => widget.onBlockAuthor(r),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                    if (_replying)
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpacing.sm),
                        child: Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _replyController,
                                autofocus: true,
                                minLines: 1,
                                maxLines: 3,
                                // Backend hard-limit (validateReplyText): 500 Unicode characters
                                // — half the top-level comment limit.
                                maxLength: 500,
                                onChanged: (_) => setState(() {}),
                                decoration: InputDecoration(
                                  hintText: t(context, 'Write a reply...', 'اكتب ردًا...'),
                                  filled: true,
                                  fillColor: AppColors.surfaceWarm,
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.chip), borderSide: BorderSide.none),
                                  counterText: '',
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: _sendingReply || _replyController.text.trim().isEmpty ? null : _sendReply,
                              icon: _sendingReply
                                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Icon(Icons.send, size: 18),
                              color: AppColors.primary,
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReplyTile extends StatelessWidget {
  final Comment reply;
  final Lang lang;
  final bool isMine;
  final VoidCallback onDelete;
  final VoidCallback onReport;
  final VoidCallback onReportAccount;
  final VoidCallback onBlock;

  const _ReplyTile({
    required this.reply,
    required this.lang,
    required this.isMine,
    required this.onDelete,
    required this.onReport,
    required this.onReportAccount,
    required this.onBlock,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 12,
            backgroundColor: AppColors.surfaceWarm,
            backgroundImage: reply.author?.profilePictureUrl != null ? NetworkImage(reply.author!.profilePictureUrl!) : null,
            child: reply.author?.profilePictureUrl == null ? const Icon(Icons.person, size: 12, color: AppColors.textMuted) : null,
          ),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(child: Text(_authorName(context, reply.author), style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
                    const SizedBox(width: 6),
                    Text(timeAgo(reply.createdAt, lang), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
                    const Spacer(),
                    if (isMine)
                      GestureDetector(
                        onTap: onDelete,
                        child: Text(t(context, 'Delete', 'حذف'), style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                      )
                    else if (reply.author != null)
                      SafetyMenuButton(
                        compact: true,
                        contentKind: SafetyContentKind.comment,
                        onReportContent: onReport,
                        onReportAccount: onReportAccount,
                        onBlock: onBlock,
                      ),
                  ],
                ),
                Text(reply.text, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
