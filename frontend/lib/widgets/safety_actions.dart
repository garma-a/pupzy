import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/safety.dart';
import '../services/graphql_service.dart';
import '../services/safety_events.dart';
import '../theme/app_theme.dart';
import 'report_sheet.dart';

/// Copy for the block confirmation, shared by the explicit "Block Account"
/// action and the post-report "Block this account too?" follow-up.
String _blockExplanation(BuildContext context) => t(
      context,
      "Block this account? You won't see each other's content or be able to contact each other.",
      'هل تريد حظر هذا الحساب؟ لن تتمكنا من رؤية محتوى بعضكما أو التواصل.',
    );

/// Creates the Block, tells the rest of the app the block list changed (so
/// feeds reload), and toasts the outcome. Returns whether the block committed.
///
/// Every string is resolved before the network call so nothing touches
/// [context] after the async gap — the caller's screen may already be gone.
Future<bool> _performBlock(BuildContext context, String userId) async {
  final graphql = context.read<GraphQLService>();
  final events = context.read<SafetyEvents>();
  final blockedCopy = t(context, 'Account blocked.', 'تم حظر الحساب.');
  final failedCopy = t(context, 'Could not block this account. Try again.', 'تعذر حظر هذا الحساب. حاول مرة أخرى.');

  final result = await graphql.blockUser(userId);
  if (!result.ok) {
    Fluttertoast.showToast(msg: result.message ?? failedCopy);
    return false;
  }
  events.blockListChanged();
  Fluttertoast.showToast(msg: blockedCopy);
  return true;
}

/// The explicit "Block Account" action: confirm, then block. Returns whether
/// the account was blocked.
Future<bool> blockAccountFlow(BuildContext context, {required String userId}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: AppColors.background,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
      title: Text(t(ctx, 'Block Account', 'حظر الحساب')),
      content: Text(_blockExplanation(ctx)),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          style: TextButton.styleFrom(foregroundColor: AppColors.critical),
          child: Text(t(ctx, 'Block', 'حظر')),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return false;
  return _performBlock(context, userId);
}

/// After a successful report, offers Block as a separate, optional follow-up
/// (never automatic — Report and Block are distinct actions). Returns whether
/// the account ended up blocked.
Future<bool> _offerBlockAfterReport(BuildContext context, String userId) async {
  final block = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: AppColors.background,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
      title: Text(t(ctx, 'Block this account too?', 'هل تريد حظر هذا الحساب أيضًا؟')),
      content: Text(_blockExplanation(ctx)),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Not now', 'ليس الآن'))),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          style: TextButton.styleFrom(foregroundColor: AppColors.critical),
          child: Text(t(ctx, 'Block', 'حظر')),
        ),
      ],
    ),
  );
  if (block != true || !context.mounted) return false;
  return _performBlock(context, userId);
}

void _toastReportSubmitted(BuildContext context) {
  Fluttertoast.showToast(msg: t(context, "Thanks for reporting. We'll review it.", 'شكرًا لإبلاغك، سنراجع الأمر.'));
}

/// Report a Post → optional block of its creator. Returns whether the creator
/// was blocked as part of this flow.
Future<bool> reportPostFlow(BuildContext context, {required String postId, required String creatorId}) async {
  final graphql = context.read<GraphQLService>();
  final submitted = await showReportSheet(
    context,
    title: t(context, 'Report Post', 'الإبلاغ عن المنشور'),
    reasons: contentReportReasons,
    detailsRequiredForOther: true,
    onSubmit: (reason, details) => graphql.reportPost(postId: postId, reason: reason, details: details),
  );
  if (!submitted || !context.mounted) return false;
  _toastReportSubmitted(context);
  return _offerBlockAfterReport(context, creatorId);
}

/// Report a Comment or Reply → optional block of its author. [authorId] is
/// null for a deleted author (nothing to block). Note `OTHER` does not require
/// details for comment reports, unlike post/account reports.
Future<bool> reportCommentFlow(BuildContext context, {required String commentId, String? authorId}) async {
  final graphql = context.read<GraphQLService>();
  final submitted = await showReportSheet(
    context,
    title: t(context, 'Report Comment', 'الإبلاغ عن التعليق'),
    reasons: contentReportReasons,
    detailsRequiredForOther: false,
    onSubmit: (reason, details) => graphql.reportComment(commentId: commentId, reason: reason, details: details),
  );
  if (!submitted || !context.mounted) return false;
  _toastReportSubmitted(context);
  if (authorId == null) return false;
  return _offerBlockAfterReport(context, authorId);
}

/// Report a Pupzy Account (optionally pointing at the evidence record it
/// concerns) → optional block. Returns whether the account was blocked.
Future<bool> reportAccountFlow(
  BuildContext context, {
  required String userId,
  AccountReportSource? sourceType,
  String? sourceId,
}) async {
  final graphql = context.read<GraphQLService>();
  final submitted = await showReportSheet(
    context,
    title: t(context, 'Report Account', 'الإبلاغ عن الحساب'),
    reasons: accountReportReasons,
    detailsRequiredForOther: true,
    onSubmit: (reason, details) => graphql.reportUser(
      userId: userId,
      reason: reason,
      details: details,
      sourceType: sourceType,
      sourceId: sourceId,
    ),
  );
  if (!submitted || !context.mounted) return false;
  _toastReportSubmitted(context);
  return _offerBlockAfterReport(context, userId);
}

enum SafetyContentKind { post, comment }

enum _SafetyMenuAction { reportContent, reportAccount, block }

/// The "…" menu offered on someone else's content or conversation: report the
/// content (when [onReportContent] is given), report the account, or block it.
/// Callers must not show it on the viewer's own content.
class SafetyMenuButton extends StatelessWidget {
  final SafetyContentKind? contentKind;
  final VoidCallback? onReportContent;
  final VoidCallback onReportAccount;
  final VoidCallback onBlock;

  /// White icon on a dark translucent disc, for use over a hero photo.
  final bool overlay;

  /// Small icon with a tight tap target, for dense rows such as replies.
  final bool compact;

  const SafetyMenuButton({
    super.key,
    this.contentKind,
    this.onReportContent,
    required this.onReportAccount,
    required this.onBlock,
    this.overlay = false,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final menu = PopupMenuButton<_SafetyMenuAction>(
      key: const Key('safetyMenuButton'),
      tooltip: t(context, 'More options', 'خيارات إضافية'),
      icon: Icon(Icons.more_vert, color: overlay ? Colors.white : AppColors.textSecondary),
      padding: compact ? EdgeInsets.zero : const EdgeInsets.all(8),
      iconSize: compact ? 16 : 24,
      style: compact ? IconButton.styleFrom(minimumSize: const Size(24, 24), tapTargetSize: MaterialTapTargetSize.shrinkWrap) : null,
      onSelected: (action) {
        switch (action) {
          case _SafetyMenuAction.reportContent:
            onReportContent?.call();
          case _SafetyMenuAction.reportAccount:
            onReportAccount();
          case _SafetyMenuAction.block:
            onBlock();
        }
      },
      itemBuilder: (ctx) => [
        if (onReportContent != null)
          PopupMenuItem(
            value: _SafetyMenuAction.reportContent,
            child: Text(
              contentKind == SafetyContentKind.comment
                  ? t(ctx, 'Report Comment', 'الإبلاغ عن التعليق')
                  : t(ctx, 'Report Post', 'الإبلاغ عن المنشور'),
            ),
          ),
        PopupMenuItem(value: _SafetyMenuAction.reportAccount, child: Text(t(ctx, 'Report Account', 'الإبلاغ عن الحساب'))),
        PopupMenuItem(
          value: _SafetyMenuAction.block,
          child: Text(t(ctx, 'Block Account', 'حظر الحساب'), style: const TextStyle(color: AppColors.critical)),
        ),
      ],
    );
    if (!overlay) return menu;
    return CircleAvatar(backgroundColor: Colors.black45, child: menu);
  }
}

/// Ready-made safety menu for a post detail screen: Report Post · Report
/// Account (attaching the post as evidence) · Block Account. Show it only when
/// the viewer is not the post's creator. [onBlocked] fires when the creator was
/// blocked — the post is no longer reachable, so screens typically pop.
class PostSafetyMenu extends StatelessWidget {
  final String postId;
  final String creatorId;
  final VoidCallback? onBlocked;
  final bool overlay;

  const PostSafetyMenu({super.key, required this.postId, required this.creatorId, this.onBlocked, this.overlay = true});

  Future<void> _run(Future<bool> Function() flow) async {
    final blocked = await flow();
    if (blocked) onBlocked?.call();
  }

  @override
  Widget build(BuildContext context) {
    return SafetyMenuButton(
      overlay: overlay,
      contentKind: SafetyContentKind.post,
      onReportContent: () => _run(() => reportPostFlow(context, postId: postId, creatorId: creatorId)),
      onReportAccount: () => _run(
        () => reportAccountFlow(context, userId: creatorId, sourceType: AccountReportSource.post, sourceId: postId),
      ),
      onBlock: () => _run(() => blockAccountFlow(context, userId: creatorId)),
    );
  }
}
