import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/comment.dart';
import '../models/safety.dart';
import '../services/comment_drafts.dart';
import '../services/comment_image_uploader.dart';
import '../services/graphql_service.dart';
import '../services/terms_gate.dart';
import '../theme/app_theme.dart';
import '../utils/comment_ordering.dart';
import '../utils/time_format.dart';
import 'safety_actions.dart';

String _authorName(BuildContext context, CommentAuthor? author) {
  if (author == null) return t(context, 'Deleted user', 'مستخدم محذوف');
  final ar = Localizations.localeOf(context).languageCode == 'ar';
  final name = ar ? (author.fullNameArabic ?? author.fullName) : (author.fullName ?? author.fullNameArabic);
  return name ?? t(context, 'Pupzy user', 'مستخدم Pupzy');
}

/// Bottom sheet showing a post's discussion: top-level comments (with Top/
/// Newest sort), expandable text-only replies, boosts, pinning (post owner
/// only), delete (own comments), and reporting. Opens via
/// `showModalBottomSheet(... builder: (_) => CommentsSheet(...))`.
class CommentsSheet extends StatefulWidget {
  final String postId;
  final bool isPostOwner;

  /// Whether photo comments are offered here. The backend only accepts
  /// image comments on RESCUE and LOST posts (both subtypes) — ADOPTION,
  /// PRODUCT and MATING reject them with `COMMENT_MEDIA_NOT_ALLOWED` (see
  /// comments-flutter-integration-contract.md §3). Text comments remain
  /// available everywhere regardless of this flag.
  final bool allowImages;

  /// Prepares and uploads photos; replaceable in tests.
  final CommentImageUploader imageUploader;

  /// Where unsent Comments and Replies are kept; replaceable in tests.
  final CommentDraftStore drafts;

  /// Up to two photos per Comment (contract §3).
  static const maxImages = 2;

  const CommentsSheet({
    super.key,
    required this.postId,
    this.isPostOwner = false,
    this.allowImages = true,
    this.imageUploader = const CommentImageUploader(),
    this.drafts = const CommentDraftStore(),
  });

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
  List<XFile> _pendingImages = [];
  bool _sending = false;

  /// The submission being sent or retried; see [PendingComment].
  PendingComment? _pending;

  /// Why the last send stopped short, shown above the composer with the way
  /// forward. Null when there's nothing to say.
  _ComposerNotice? _notice;

  /// Bumped whenever the list is reloaded, so an older background re-sync
  /// never overwrites a newer list.
  int _listGeneration = 0;
  Timer? _resyncTimer;

  @override
  void initState() {
    super.initState();
    _load();
    _restoreDraft();
    context.read<GraphQLService>().fetchMe().then((me) {
      if (mounted) setState(() => _myUserId = me?['id'] as String?);
    });
  }

  @override
  void dispose() {
    _resyncTimer?.cancel();
    _keepDraftOnClose();
    _textController.dispose();
    super.dispose();
  }

  /// Brings back a Comment that wasn't confirmed as sent — after the sheet
  /// or the app was closed — with its submission identity, so sending it
  /// again can't publish it twice.
  Future<void> _restoreDraft() async {
    final draft = await widget.drafts.loadComment(widget.postId);
    if (draft == null || !mounted || _textController.text.isNotEmpty) return;
    setState(() {
      _pending = draft;
      _textController.text = draft.text;
      _pendingImages = widget.allowImages ? draft.imagePaths.map(XFile.new).toList() : [];
      if (draft.outcomeUnknown) _notice = const _ComposerNotice(_NoticeKind.outcomeUnknown);
    });
  }

  /// Keeps whatever is in the composer when the sheet closes. A draft that
  /// was already sent with no answer keeps its identity.
  void _keepDraftOnClose() {
    final text = _textController.text.trim();
    final paths = _pendingImages.map((x) => x.path).toList();
    if (text.isEmpty && paths.isEmpty) {
      widget.drafts.clearComment(widget.postId);
      return;
    }
    final pending = _pending;
    final draft = pending != null && pending.matches(text, paths)
        ? pending
        : PendingComment.start(text: text, imagePaths: paths);
    widget.drafts.saveComment(widget.postId, draft);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    _resyncTimer?.cancel();
    final generation = ++_listGeneration;
    final graphql = context.read<GraphQLService>();
    final (comments, endCursor, hasNext, error) = await graphql.fetchComments(postId: widget.postId, sort: _sort);
    if (!mounted || generation != _listGeneration) return;
    setState(() {
      _loading = false;
      _comments = appendPage(const [], comments);
      _endCursor = endCursor;
      _hasNextPage = hasNext;
      _errorMessage = error;
    });
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage) return;
    setState(() => _loadingMore = true);
    final generation = _listGeneration;
    final graphql = context.read<GraphQLService>();
    final (comments, endCursor, hasNext, _) = await graphql.fetchComments(postId: widget.postId, sort: _sort, after: _endCursor);
    if (!mounted) return;
    if (generation != _listGeneration) {
      setState(() => _loadingMore = false);
      return;
    }
    setState(() {
      _loadingMore = false;
      // Ranks can shift between two page loads; never show a Comment twice.
      _comments = appendPage(_comments, comments);
      _endCursor = endCursor;
      _hasNextPage = hasNext;
    });
  }

  void _setSort(String sort) {
    if (sort == _sort) return;
    _resyncTimer?.cancel();
    setState(() => _sort = sort);
    _load();
  }

  Future<void> _pickImage() async {
    final remaining = CommentsSheet.maxImages - _pendingImages.length;
    if (remaining <= 0) return;
    final picker = ImagePicker();
    final picked = remaining >= 2
        ? await picker.pickMultiImage(limit: remaining, maxWidth: 1600, maxHeight: 1600, imageQuality: 90)
        : [?await picker.pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600, imageQuality: 90)];
    if (picked.isEmpty || !mounted) return;
    setState(() => _pendingImages = [..._pendingImages, ...picked].take(CommentsSheet.maxImages).toList());
  }

  void _removeImage(int index) {
    setState(() => _pendingImages = [..._pendingImages]..removeAt(index));
  }

  /// Sends the composer's Comment, or retries the last one unchanged.
  ///
  /// A photo that fails to upload stops the send: the draft stays as it is
  /// and the user chooses Retry or [withoutPhotos]. The Comment is never
  /// silently published without the photos they picked.
  Future<void> _send({bool withoutPhotos = false}) async {
    final text = _textController.text.trim();
    if (text.isEmpty || _sending) return;
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    if (withoutPhotos) _pendingImages = [];
    final paths = _pendingImages.map((x) => x.path).toList();
    final previous = _pending;
    var pending = previous != null && previous.matches(text, paths)
        ? previous
        : PendingComment.start(text: text, imagePaths: paths);
    setState(() {
      _sending = true;
      _notice = null;
      _pending = pending;
    });
    final graphql = context.read<GraphQLService>();
    final genericFailure = t(context, 'Could not post comment. Try again.', 'تعذر نشر التعليق. حاول مرة أخرى.');

    try {
      await widget.drafts.saveComment(widget.postId, pending);
      // One automatic re-upload when the tickets expired or were used up:
      // nothing was published, so uploading again is safe.
      for (var attempt = 0; attempt < 2; attempt++) {
        final failure = await _uploadMissingPhotos(graphql, pending);
        pending = _pending!;
        if (!mounted) return;
        if (failure != null) {
          setState(() => _notice = _ComposerNotice(_NoticeKind.photoFailed, failure.errorMessage));
          return;
        }

        final result = await withTermsRecovery(context, () => graphql.createComment(
          clientRequestId: pending.clientRequestId,
          postId: widget.postId,
          text: pending.text,
          mediaIds: pending.mediaIds.whereType<String>().toList(),
        ));
        if (!mounted) return;

        final created = result.comment;
        if (created != null) {
          await widget.drafts.clearComment(widget.postId);
          if (!mounted) return;
          setState(() {
            _textController.clear();
            _pendingImages = [];
            _pending = null;
            _comments = insertNewComment(_comments, created);
          });
          return;
        }

        if (result.outcomeUnknown) {
          _savePending(pending.withOutcomeUnknown(true));
          setState(() => _notice = const _ComposerNotice(_NoticeKind.outcomeUnknown));
          return;
        }

        switch (result.errorCode) {
          case 'COMMENT_MEDIA_NOT_AVAILABLE' ||
                'COMMENT_MEDIA_NOT_READY' ||
                'COMMENT_MEDIA_ALREADY_USED' ||
                'COMMENT_MEDIA_CLAIM_CONFLICT':
            if (attempt == 0) {
              pending = pending.withFreshUploads();
              _savePending(pending);
              continue;
            }
            setState(() => _notice = _ComposerNotice(_NoticeKind.photoFailed, result.errorMessage));
          case 'COMMENT_MEDIA_NOT_ALLOWED' || 'COMMENT_IMAGES_DISABLED':
            _savePending(pending.withOutcomeUnknown(false));
            setState(() => _notice = _ComposerNotice(_NoticeKind.photosNotAccepted, result.errorMessage));
          case 'COMMENT_MEDIA_PROCESSING_FAILED':
            // Retryable: the same request (same id, same photos) may succeed.
            _savePending(pending.withOutcomeUnknown(false));
            setState(() => _notice = _ComposerNotice(_NoticeKind.retryable, result.errorMessage));
          case 'CONFLICT':
            // This id was already used for different content.
            _savePending(pending.withNewId());
            Fluttertoast.showToast(msg: result.errorMessage ?? genericFailure);
          default:
            _savePending(pending.withOutcomeUnknown(false));
            Fluttertoast.showToast(msg: result.errorMessage ?? genericFailure);
        }
        return;
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _savePending(PendingComment pending) {
    _pending = pending;
    widget.drafts.saveComment(widget.postId, pending);
  }

  /// Uploads every photo of [pending] that has no ticket yet, recording each
  /// ticket as it arrives so a retry never uploads it again. Returns the
  /// first failure, or null when every photo is uploaded.
  Future<CommentImageUpload?> _uploadMissingPhotos(GraphQLService graphql, PendingComment pending) async {
    var current = pending;
    _pending = current;
    for (var i = 0; i < current.imagePaths.length; i++) {
      if (current.mediaIds[i] != null) continue;
      final upload = await widget.imageUploader.upload(graphql, XFile(current.imagePaths[i]));
      if (!upload.ok) {
        _savePending(current);
        return upload;
      }
      current = current.withMediaId(i, upload.mediaId!);
      _savePending(current);
    }
    return null;
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
    setState(() => _comments = applyPin(_comments, pinned, _sort));
    _scheduleResync();
  }

  Future<void> _unpinComment(Comment comment) async {
    final graphql = context.read<GraphQLService>();
    final (success, error) = await graphql.unpinComment(widget.postId);
    if (!mounted) return;
    if (!success) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not unpin comment.', 'تعذر إلغاء تثبيت التعليق.'));
      return;
    }
    setState(() => _comments = applyUpdate(_comments, comment.copyWith(isPinned: false), _sort));
    _scheduleResync();
  }

  void _onBoostChanged(Comment updated) {
    setState(() => _comments = applyUpdate(_comments, updated, _sort));
    // Newest order doesn't depend on Boosts.
    if (_sort == 'TOP') _scheduleResync();
  }

  /// Pin, unpin and Boost can move a Comment across a page boundary, which
  /// reordering the loaded Comments can't show correctly. Shortly after the
  /// last such change, reload the same range from the server and take its
  /// order.
  void _scheduleResync() {
    _resyncTimer?.cancel();
    _resyncTimer = Timer(const Duration(milliseconds: 700), _resync);
  }

  Future<void> _resync() async {
    final generation = ++_listGeneration;
    final sort = _sort;
    final wanted = _comments.length;
    final graphql = context.read<GraphQLService>();
    var fresh = <Comment>[];
    String? cursor;
    var hasNext = true;
    while (hasNext && fresh.length < wanted) {
      final (page, endCursor, next, error) =
          await graphql.fetchComments(postId: widget.postId, sort: sort, first: 50, after: cursor);
      if (!mounted || generation != _listGeneration) return;
      if (error != null) return; // Keep the local order; the next load corrects it.
      fresh = appendPage(fresh, page);
      cursor = endCursor;
      hasNext = next;
    }
    setState(() {
      _comments = fresh.where((c) => c.author?.id == null || !_hiddenAuthorIds.contains(c.author!.id)).toList();
      _endCursor = cursor;
      _hasNextPage = hasNext;
    });
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
                                    onBoostChanged: _onBoostChanged,
                                    onPin: () => _pinComment(comment),
                                    onUnpin: () => _unpinComment(comment),
                                    onDelete: () => _deleteComment(comment),
                                    onReport: _reportComment,
                                    onReportAccount: _reportAccountOf,
                                    onBlockAuthor: _blockAuthorOf,
                                    hiddenAuthorIds: _hiddenAuthorIds,
                                    onReplyCountChanged: (count) => _replaceComment(comment.copyWith(replyCount: count)),
                                    drafts: widget.drafts,
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
                      if (_notice != null)
                        _ComposerNoticeBar(
                          notice: _notice!,
                          photoCount: _pendingImages.length,
                          busy: _sending,
                          onRetry: () => _send(),
                          onPostWithoutPhotos: () => _send(withoutPhotos: true),
                        ),
                      if (widget.allowImages && _pendingImages.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Row(
                            children: [
                              for (var i = 0; i < _pendingImages.length; i++)
                                Padding(
                                  padding: const EdgeInsetsDirectional.only(end: AppSpacing.sm),
                                  child: _PendingImageThumb(
                                    path: _pendingImages[i].path,
                                    onRemove: _sending ? null : () => _removeImage(i),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          if (widget.allowImages)
                            IconButton(
                              onPressed: !_sending && _pendingImages.length < CommentsSheet.maxImages ? _pickImage : null,
                              icon: const Icon(Icons.image_outlined),
                              color: AppColors.textMuted,
                              tooltip: _pendingImages.length < CommentsSheet.maxImages
                                  ? t(context, 'Attach photos (up to 2)', 'إرفاق صور (حتى صورتين)')
                                  : t(context, 'Up to 2 photos per comment', 'حتى صورتين لكل تعليق'),
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
                            onPressed: _sending || _textController.text.trim().isEmpty ? null : () => _send(),
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
  final CommentDraftStore drafts;

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
    required this.drafts,
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

  /// The Reply being sent or retried; see [PendingReply].
  PendingReply? _pendingReply;

  @override
  void initState() {
    super.initState();
    _restoreReplyDraft();
  }

  @override
  void dispose() {
    _keepReplyDraftOnClose();
    _replyController.dispose();
    super.dispose();
  }

  Future<void> _restoreReplyDraft() async {
    final draft = await widget.drafts.loadReply(widget.comment.id);
    if (draft == null || !mounted) return;
    setState(() {
      _pendingReply = draft;
      _replyController.text = draft.text;
      _replying = true;
    });
  }

  void _keepReplyDraftOnClose() {
    final text = _replyController.text.trim();
    if (text.isEmpty) {
      widget.drafts.clearReply(widget.comment.id);
      return;
    }
    final pending = _pendingReply;
    widget.drafts.saveReply(widget.comment.id, pending != null && pending.text == text ? pending : PendingReply.start(text));
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

  /// Sends the Reply, or retries the last one unchanged with the same
  /// `clientRequestId`, so a retry after a lost response can't post twice.
  Future<void> _sendReply() async {
    final text = _replyController.text.trim();
    if (text.isEmpty || _sendingReply) return;
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    final previous = _pendingReply;
    final pending = previous != null && previous.text == text ? previous : PendingReply.start(text);
    setState(() {
      _sendingReply = true;
      _pendingReply = pending;
    });
    final graphql = context.read<GraphQLService>();
    final failedCopy = t(context, 'Could not post reply. Try again.', 'تعذر نشر الرد. حاول مرة أخرى.');
    final unknownCopy = t(
      context,
      "We couldn't confirm your reply was posted. Tap send to try again — it won't be posted twice.",
      'تعذر التأكد من نشر ردك. اضغط إرسال للمحاولة مرة أخرى — لن يُنشر مرتين.',
    );
    try {
      await widget.drafts.saveReply(widget.comment.id, pending);
      if (!mounted) return;
      final result = await withTermsRecovery(context, () => graphql.createReply(
        clientRequestId: pending.clientRequestId,
        commentId: widget.comment.id,
        text: pending.text,
      ));
      if (!mounted) return;
      final reply = result.comment;
      if (reply != null) {
        await widget.drafts.clearReply(widget.comment.id);
        if (!mounted) return;
        final isNew = !_replies.any((r) => r.id == reply.id);
        setState(() {
          _replyController.clear();
          _pendingReply = null;
          _replying = false;
          _repliesExpanded = true;
          if (isNew) _replies = [..._replies, reply];
        });
        if (isNew) widget.onReplyCountChanged(widget.comment.replyCount + 1);
        return;
      }
      final next = result.outcomeUnknown
          ? pending.withOutcomeUnknown(true)
          : result.errorCode == 'CONFLICT'
              ? pending.withNewId()
              : pending.withOutcomeUnknown(false);
      _pendingReply = next;
      widget.drafts.saveReply(widget.comment.id, next);
      Fluttertoast.showToast(msg: result.outcomeUnknown ? unknownCopy : result.errorMessage ?? failedCopy);
    } finally {
      if (mounted) setState(() => _sendingReply = false);
    }
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
                      // Up to two photos, side by side, in their published order.
                      Row(
                        children: [
                          for (final (i, m) in ([...comment.media]..sort((a, b) => a.displayOrder.compareTo(b.displayOrder))).take(2).indexed) ...[
                            if (i > 0) const SizedBox(width: AppSpacing.sm),
                            Flexible(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.network(
                                  m.publicUrl,
                                  height: 140,
                                  fit: BoxFit.cover,
                                  // A photo that can't load leaves a quiet placeholder,
                                  // not an error.
                                  errorBuilder: (_, _, _) => Container(
                                    height: 140,
                                    color: AppColors.surfaceWarm,
                                    alignment: Alignment.center,
                                    child: const Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ],
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

enum _NoticeKind { photoFailed, photosNotAccepted, retryable, outcomeUnknown }

class _ComposerNotice {
  final _NoticeKind kind;

  /// The server's own message, when it gave one.
  final String? serverMessage;

  const _ComposerNotice(this.kind, [this.serverMessage]);
}

/// Explains why the last send stopped and offers the way forward. The
/// Comment is never changed or published behind the user's back: dropping
/// photos is always their explicit choice.
class _ComposerNoticeBar extends StatelessWidget {
  final _ComposerNotice notice;
  final int photoCount;
  final bool busy;
  final VoidCallback onRetry;
  final VoidCallback onPostWithoutPhotos;

  const _ComposerNoticeBar({
    required this.notice,
    required this.photoCount,
    required this.busy,
    required this.onRetry,
    required this.onPostWithoutPhotos,
  });

  @override
  Widget build(BuildContext context) {
    final photos = photoCount == 1;
    final message = switch (notice.kind) {
      _NoticeKind.photoFailed => photos
          ? t(context, "Your photo couldn't be uploaded, so your comment wasn't posted.",
              'تعذر رفع صورتك، لذلك لم يُنشر تعليقك.')
          : t(context, "Your photos couldn't be uploaded, so your comment wasn't posted.",
              'تعذر رفع صورك، لذلك لم يُنشر تعليقك.'),
      _NoticeKind.photosNotAccepted => notice.serverMessage ??
          t(context, "Photos can't be added here right now. You can still post your comment without them.",
              'لا يمكن إضافة صور هنا الآن. يمكنك نشر تعليقك بدونها.'),
      _NoticeKind.retryable => t(context, "Your photos couldn't be processed. Try again.",
          'تعذرت معالجة صورك. حاول مرة أخرى.'),
      _NoticeKind.outcomeUnknown => t(context, "We couldn't confirm your comment was posted. Retrying won't post it twice.",
          'تعذر التأكد من نشر تعليقك. إعادة المحاولة لن تنشره مرتين.'),
    };
    final offerRetry = notice.kind != _NoticeKind.photosNotAccepted;
    final offerWithout = photoCount > 0 && notice.kind != _NoticeKind.outcomeUnknown;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.sm, AppSpacing.xs),
      decoration: BoxDecoration(
        color: AppColors.surfaceWarm,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Icon(Icons.error_outline, size: 16, color: AppColors.textSecondary),
              ),
              const SizedBox(width: AppSpacing.xs),
              Expanded(child: Text(message, style: Theme.of(context).textTheme.bodySmall)),
            ],
          ),
          Wrap(
            alignment: WrapAlignment.end,
            spacing: AppSpacing.xs,
            children: [
              if (offerWithout)
                TextButton(
                  onPressed: busy ? null : onPostWithoutPhotos,
                  child: Text(photos
                      ? t(context, 'Post without photo', 'انشر بدون الصورة')
                      : t(context, 'Post without photos', 'انشر بدون الصور')),
                ),
              if (offerRetry)
                TextButton(
                  onPressed: busy ? null : onRetry,
                  child: Text(t(context, 'Retry', 'إعادة المحاولة')),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PendingImageThumb extends StatelessWidget {
  final String path;
  final VoidCallback? onRemove;

  const _PendingImageThumb({required this.path, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    final file = File(path);
    return SizedBox(
      width: 72,
      height: 72,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: file.existsSync()
                ? Image.file(file, width: 64, height: 64, fit: BoxFit.cover)
                : Container(
                    width: 64,
                    height: 64,
                    color: AppColors.surfaceWarm,
                    child: const Icon(Icons.image_outlined, color: AppColors.textMuted),
                  ),
          ),
          if (onRemove != null)
            PositionedDirectional(
              top: -6,
              end: 2,
              child: Semantics(
                button: true,
                label: t(context, 'Remove photo', 'إزالة الصورة'),
                child: GestureDetector(
                  onTap: onRemove,
                  child: const CircleAvatar(
                    radius: 11,
                    backgroundColor: Colors.black54,
                    child: Icon(Icons.close, size: 13, color: Colors.white),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
