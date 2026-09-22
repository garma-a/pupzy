import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../services/safety_events.dart';
import '../theme/app_theme.dart';

/// The one terminal status a post type can move to via `updatePostStatus`,
/// plus the copy for it. Mirrors the backend's `ALLOWED_TRANSITIONS`
/// (RESCUE→RESOLVED, LOST→REUNITED, ADOPTION→ADOPTED, PRODUCT→SOLD). Mating
/// posts have no transition, so they only get Delete.
class OwnerCloseAction {
  final String status;
  final String actionEn, actionAr;
  final String doneEn, doneAr;
  final String confirmEn, confirmAr;
  final String toastEn, toastAr;

  const OwnerCloseAction({
    required this.status,
    required this.actionEn,
    required this.actionAr,
    required this.doneEn,
    required this.doneAr,
    required this.confirmEn,
    required this.confirmAr,
    required this.toastEn,
    required this.toastAr,
  });

  static const rescue = OwnerCloseAction(
    status: 'RESOLVED',
    actionEn: 'Mark Resolved',
    actionAr: 'تحديد كمحلولة',
    doneEn: 'Resolved ✓',
    doneAr: 'تم الحل ✓',
    confirmEn: 'Mark this rescue as resolved? This closes the post and cannot be undone.',
    confirmAr: 'تحديد هذه الحالة كمحلولة؟ سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Post marked as resolved',
    toastAr: 'تم تحديد المنشور كمحلول',
  );

  static const lost = OwnerCloseAction(
    status: 'REUNITED',
    actionEn: 'Mark Reunited',
    actionAr: 'تم لمّ الشمل',
    doneEn: 'Reunited ✓',
    doneAr: 'تم لمّ الشمل ✓',
    confirmEn: 'Mark this pet as reunited? This closes the post and cannot be undone.',
    confirmAr: 'تحديد أن الحيوان عاد إلى صاحبه؟ سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Post marked as reunited',
    toastAr: 'تم تحديد المنشور كمُلمّ الشمل',
  );

  static const adoption = OwnerCloseAction(
    status: 'ADOPTED',
    actionEn: 'Mark Adopted',
    actionAr: 'تحديد كمُتبنّى',
    doneEn: 'Adopted ✓',
    doneAr: 'تم التبني ✓',
    confirmEn: 'Mark this pet as adopted? This closes the listing and cannot be undone.',
    confirmAr: 'تحديد أن الحيوان تم تبنيه؟ سيتم إغلاق الإعلان ولا يمكن التراجع عن ذلك.',
    toastEn: 'Listing marked as adopted',
    toastAr: 'تم تحديد الإعلان كمُتبنّى',
  );
}

/// Bottom action bar for the owner of a post: close it (when its type has a
/// terminal status) and delete it. Both are confirmed first and both tell the
/// feeds to reload, since a closed or deleted post must leave them.
class OwnerPostActions extends StatefulWidget {
  final String postId;

  /// Null for post types with no terminal status (mating) — Delete only.
  final OwnerCloseAction? close;

  /// Whether the post is already past ACTIVE (closed).
  final bool isClosed;

  /// Called with the new status after the post was closed.
  final ValueChanged<String> onClosed;

  /// Called after the post was deleted — the screen should leave.
  final VoidCallback onDeleted;

  const OwnerPostActions({
    super.key,
    required this.postId,
    required this.close,
    required this.isClosed,
    required this.onClosed,
    required this.onDeleted,
  });

  @override
  State<OwnerPostActions> createState() => _OwnerPostActionsState();
}

class _OwnerPostActionsState extends State<OwnerPostActions> {
  bool _busy = false;

  Future<bool> _confirm({required String title, required String body, required String action, bool destructive = false}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: destructive ? TextButton.styleFrom(foregroundColor: AppColors.critical) : null,
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _closePost() async {
    final close = widget.close;
    if (close == null || _busy || widget.isClosed) return;
    final confirmed = await _confirm(
      title: t(context, close.actionEn, close.actionAr),
      body: t(context, close.confirmEn, close.confirmAr),
      action: t(context, 'Confirm', 'تأكيد'),
    );
    if (!confirmed || !mounted) return;

    final graphql = context.read<GraphQLService>();
    final events = context.read<SafetyEvents>();
    final successCopy = t(context, close.toastEn, close.toastAr);
    final failedCopy = t(context, 'Could not update the post. Try again.', 'تعذر تحديث المنشور. حاول مرة أخرى.');

    setState(() => _busy = true);
    final (success, error) = await graphql.updatePostStatus(postId: widget.postId, status: close.status);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!success) {
      Fluttertoast.showToast(msg: error ?? failedCopy);
      return;
    }
    events.postsChanged();
    Fluttertoast.showToast(msg: successCopy);
    widget.onClosed(close.status);
  }

  Future<void> _deletePost() async {
    if (_busy) return;
    final confirmed = await _confirm(
      title: t(context, 'Delete post?', 'حذف المنشور؟'),
      body: t(context, 'This cannot be undone.', 'لا يمكن التراجع عن هذا الإجراء.'),
      action: t(context, 'Delete', 'حذف'),
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    final graphql = context.read<GraphQLService>();
    final events = context.read<SafetyEvents>();
    final successCopy = t(context, 'Post deleted', 'تم حذف المنشور');
    final failedCopy = t(context, 'Could not delete the post. Try again.', 'تعذر حذف المنشور. حاول مرة أخرى.');

    setState(() => _busy = true);
    final (success, error) = await graphql.deletePost(widget.postId);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!success) {
      Fluttertoast.showToast(msg: error ?? failedCopy);
      return;
    }
    events.postsChanged();
    Fluttertoast.showToast(msg: successCopy);
    widget.onDeleted();
  }

  @override
  Widget build(BuildContext context) {
    final close = widget.close;
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            key: const Key('ownerDeleteButton'),
            onPressed: _busy ? null : _deletePost,
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.critical, side: const BorderSide(color: AppColors.critical)),
            child: Text(t(context, 'Delete', 'حذف')),
          ),
        ),
        if (close != null) ...[
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: ElevatedButton(
              key: const Key('ownerCloseButton'),
              onPressed: _busy || widget.isClosed ? null : _closePost,
              child: Text(widget.isClosed ? t(context, close.doneEn, close.doneAr) : t(context, close.actionEn, close.actionAr)),
            ),
          ),
        ],
      ],
    );
  }
}
