import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../services/safety_events.dart';
import '../theme/app_theme.dart';

/// A terminal status a post type can move to via `updatePostStatus`, plus
/// the copy for it. Mirrors the backend's `ALLOWED_TRANSITIONS`
/// (RESCUE→RESOLVED or ANIMAL_DECEASED, LOST→REUNITED, FOUND_STRAY→RESOLVED
/// or REUNITED, ADOPTION→ADOPTED, PRODUCT→SOLD, MATING→RESOLVED).
class OwnerCloseAction {
  final String status;
  final String actionEn, actionAr;
  final String doneEn, doneAr;
  final String confirmEn, confirmAr;
  final String toastEn, toastAr;

  /// One line under the option when the owner chooses between two outcomes.
  final String? descriptionEn, descriptionAr;

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
    this.descriptionEn,
    this.descriptionAr,
  });

  /// "Rescued" = immediate danger addressed and appropriate care secured;
  /// the animal does not need to have been adopted. Stored as `RESOLVED`.
  static const rescue = OwnerCloseAction(
    status: 'RESOLVED',
    actionEn: 'Rescued',
    actionAr: 'تم الإنقاذ',
    doneEn: 'Rescued ✓',
    doneAr: 'تم الإنقاذ ✓',
    confirmEn:
        'Mark this animal as rescued? Its immediate danger has been addressed and it has appropriate care — it does not need to be adopted. This closes the post and cannot be undone.',
    confirmAr:
        'تحديد أن الحيوان تم إنقاذه؟ زال الخطر المباشر عنه وحصل على رعاية مناسبة — ولا يُشترط أن يكون قد تم تبنيه. سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Rescue marked as rescued',
    toastAr: 'تم تحديد حالة الإنقاذ كناجحة',
    descriptionEn: 'Danger addressed and care secured — adoption not required',
    descriptionAr: 'زال الخطر وتم تأمين الرعاية — لا يُشترط التبني',
  );

  /// RESCUE only. A completed outcome that is not a success: never shown
  /// with a tick or as "Rescued".
  static const animalDeceased = OwnerCloseAction(
    status: 'ANIMAL_DECEASED',
    actionEn: 'Animal deceased',
    actionAr: 'وفاة الحيوان',
    doneEn: 'Animal deceased',
    doneAr: 'وفاة الحيوان',
    confirmEn: 'Close this rescue because the animal died? This closes the post and cannot be undone.',
    confirmAr: 'إغلاق حالة الإنقاذ هذه بسبب وفاة الحيوان؟ سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Rescue closed',
    toastAr: 'تم إغلاق حالة الإنقاذ',
    descriptionEn: 'The animal died — closes the rescue without marking it rescued',
    descriptionAr: 'توفي الحيوان — يُغلق الحالة دون اعتبارها إنقاذًا',
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

  static const mating = OwnerCloseAction(
    status: 'RESOLVED',
    actionEn: 'Mark Resolved',
    actionAr: 'تحديد كمنتهية',
    doneEn: 'Resolved ✓',
    doneAr: 'تم الحل ✓',
    confirmEn: 'Mark this mating listing as resolved? This closes the post and cannot be undone.',
    confirmAr: 'تحديد إعلان التزاوج هذا كمنتهٍ؟ سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Listing marked as resolved',
    toastAr: 'تم تحديد الإعلان كمنتهٍ',
  );

  // A FOUND_STRAY report accepts either outcome (unlike LOST_PET, which is
  // REUNITED-only) — see post-lifecycle-transition-contract.md §1.
  static const foundResolved = OwnerCloseAction(
    status: 'RESOLVED',
    actionEn: 'Mark Resolved',
    actionAr: 'تحديد كمنتهية',
    doneEn: 'Resolved ✓',
    doneAr: 'تم الحل ✓',
    confirmEn: 'Mark this resolved (e.g. rehomed or handed to a shelter)? This closes the post and cannot be undone.',
    confirmAr: 'تحديد هذا البلاغ كمنتهٍ (مثل إيجاد منزل له أو تسليمه لملجأ)؟ سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Post marked as resolved',
    toastAr: 'تم تحديد المنشور كمنتهٍ',
  );

  static const foundReunited = OwnerCloseAction(
    status: 'REUNITED',
    actionEn: 'Mark Reunited',
    actionAr: 'تم لمّ الشمل',
    doneEn: 'Reunited ✓',
    doneAr: 'تم لمّ الشمل ✓',
    confirmEn: "Mark this pet as reunited with its owner? This closes the post and cannot be undone.",
    confirmAr: 'تحديد أن الحيوان عاد إلى صاحبه؟ سيتم إغلاق المنشور ولا يمكن التراجع عن ذلك.',
    toastEn: 'Post marked as reunited',
    toastAr: 'تم تحديد المنشور كمُلمّ الشمل',
  );
}

/// Bottom action bar for the owner of a post: close it (when its type has a
/// terminal status) and delete it. Both are confirmed first and both tell the
/// feeds to reload, since a closed or deleted post must leave them.
class OwnerPostActions extends StatefulWidget {
  final String postId;

  /// Null for post types with no terminal status (mating) — Delete only.
  final OwnerCloseAction? close;

  /// A second valid outcome (currently only FOUND_STRAY, which accepts
  /// RESOLVED or REUNITED). When set, closing asks which outcome first
  /// instead of jumping straight to [close]'s confirmation.
  final OwnerCloseAction? alternateClose;

  /// Whether the post is already past ACTIVE (closed).
  final bool isClosed;

  /// The post's actual current status — only needed when [alternateClose] is
  /// set, to show the right "done" label ([close] vs [alternateClose]) for
  /// an already-closed post.
  final String? currentStatus;

  /// Why closing isn't possible right now although the post isn't closed —
  /// e.g. an expired listing must be renewed first. Disables the close button
  /// and shows this line above it. Null when closing is allowed.
  final String? closeBlockedReason;

  /// Called with the new status after the post was closed.
  final ValueChanged<String> onClosed;

  /// Called after the post was deleted — the screen should leave.
  final VoidCallback onDeleted;

  const OwnerPostActions({
    super.key,
    required this.postId,
    required this.close,
    this.alternateClose,
    required this.isClosed,
    this.currentStatus,
    this.closeBlockedReason,
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

  /// When [OwnerPostActions.alternateClose] is set, asks which of the two
  /// valid outcomes the owner means before confirming — otherwise returns
  /// [OwnerPostActions.close] directly, unchanged from before this existed.
  Future<OwnerCloseAction?> _resolveCloseAction() async {
    final primary = widget.close;
    final alternate = widget.alternateClose;
    if (primary == null) return null;
    if (alternate == null) return primary;
    return showDialog<OwnerCloseAction>(
      context: context,
      builder: (ctx) => SimpleDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(t(ctx, 'Mark as...', 'تحديد كـ...')),
        children: [
          for (final option in [primary, alternate])
            SimpleDialogOption(
              onPressed: () => Navigator.of(ctx).pop(option),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t(ctx, option.actionEn, option.actionAr),
                    style: Theme.of(ctx).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  if (option.descriptionEn != null)
                    Text(
                      t(ctx, option.descriptionEn!, option.descriptionAr ?? option.descriptionEn!),
                      style: Theme.of(ctx).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _closePost() async {
    if (_busy || widget.isClosed || widget.closeBlockedReason != null) return;
    final close = await _resolveCloseAction();
    if (close == null || !mounted) return;
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
    final alternate = widget.alternateClose;
    // Which outcome actually happened, for the "done" label — falls back to
    // `close` when there's no second outcome or the current status doesn't
    // match the alternate one.
    final doneAction = (alternate != null && widget.currentStatus == alternate.status) ? alternate : close;
    final actionLabel = alternate != null
        ? t(context, 'Mark as...', 'تحديد كـ...')
        : close != null
            ? t(context, close.actionEn, close.actionAr)
            : '';
    final blockedReason = widget.isClosed ? null : widget.closeBlockedReason;
    final buttons = Row(
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
              onPressed: _busy || widget.isClosed || blockedReason != null ? null : _closePost,
              child: Text(widget.isClosed && doneAction != null ? t(context, doneAction.doneEn, doneAction.doneAr) : actionLabel),
            ),
          ),
        ],
      ],
    );
    if (close == null || blockedReason == null) return buttons;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        BlockedActionNote(blockedReason),
        const SizedBox(height: AppSpacing.sm),
        buttons,
      ],
    );
  }
}

/// One muted line explaining why an owner action is unavailable right now.
class BlockedActionNote extends StatelessWidget {
  const BlockedActionNote(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.info_outline, size: 16, color: AppColors.textSecondary),
        const SizedBox(width: AppSpacing.xs),
        Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }
}
