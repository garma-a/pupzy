import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/feature_flags.dart';
import '../localization/lang_provider.dart';
import '../models/rescue_proof.dart';
import '../services/graphql_service.dart';
import '../services/safety_events.dart';
import '../theme/app_theme.dart';
import 'image_with_fallback.dart';
import 'safety_actions.dart';

typedef ProofImageBuilder = Widget Function(String url, {double? width, double? height, BoxFit fit});

Widget _defaultProofImage(String url, {double? width, double? height, BoxFit fit = BoxFit.cover}) {
  return ImageWithFallback(url: url, width: width, height: height, fit: fit);
}

Future<bool> _defaultOpenLink(String url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

/// The post owner's side of the proof flow: the proofs people submitted for
/// their RESCUE / LOST_PET post, with Confirm and Reject.
///
/// Confirming closes the post ([ProofPostKind.closedStatus]), reports that
/// through [onPostClosed], and unlocks a "Contact on WhatsApp" button for the
/// confirmed rescuer. Renders nothing while loading or when there is nothing to
/// show, like the other owner sections.
class RescueProofsOwnerSection extends StatefulWidget {
  final String postId;
  final ProofPostKind kind;

  /// Called with the terminal status the post moved to once a proof is confirmed.
  final ValueChanged<String> onPostClosed;

  final ProofImageBuilder imageBuilder;
  final Future<bool> Function(String url) openLink;

  const RescueProofsOwnerSection({
    super.key,
    required this.postId,
    required this.kind,
    required this.onPostClosed,
    this.imageBuilder = _defaultProofImage,
    this.openLink = _defaultOpenLink,
  });

  @override
  State<RescueProofsOwnerSection> createState() => _RescueProofsOwnerSectionState();
}

class _RescueProofsOwnerSectionState extends State<RescueProofsOwnerSection> {
  bool _loading = true;
  List<RescueProof> _proofs = [];
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    if (kRescueProofEnabled) {
      _load();
    } else {
      _loading = false;
    }
  }

  Future<void> _load() async {
    final graphql = context.read<GraphQLService>();
    final (proofs, _) = await graphql.fetchPostRescueProofs(postId: widget.postId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _proofs = proofs;
    });
  }

  /// Confirmed first, then pending oldest-first (the order they arrived in).
  List<RescueProof> get _visible {
    final shown = _proofs.where((p) => p.isPending || p.isConfirmed).toList();
    shown.sort((a, b) {
      if (a.isConfirmed != b.isConfirmed) return a.isConfirmed ? -1 : 1;
      return a.createdAt.compareTo(b.createdAt);
    });
    return shown;
  }

  String _name(RescueProof proof) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return proof.submitter?.displayName(arabic: arabic) ?? (proof.submitter == null ? t(context, 'Deleted user', 'مستخدم محذوف') : t(context, 'Someone', 'شخص ما'));
  }

  Future<bool> _confirmDialog({required String title, required String body, required String action, bool destructive = false}) async {
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

  Future<void> _confirm(RescueProof proof) async {
    if (_busy.contains(proof.id)) return;
    final kind = widget.kind;
    final name = _name(proof);
    final ok = await _confirmDialog(
      title: t(context, 'Confirm this proof?', 'تأكيد هذا الإثبات؟'),
      body: t(
        context,
        '${kind.confirmEn} $name\'s WhatsApp number will be shared with you so you can coordinate.',
        '${kind.confirmAr} سيتم مشاركة رقم واتساب $name معك للتنسيق.',
      ),
      action: t(context, 'Confirm', 'تأكيد'),
    );
    if (!ok || !mounted) return;

    final graphql = context.read<GraphQLService>();
    final events = context.read<SafetyEvents>();
    final successCopy = t(context, 'Proof confirmed — your post is closed', 'تم تأكيد الإثبات — تم إغلاق منشورك');
    final failedCopy = t(context, 'Could not confirm this proof. Try again.', 'تعذر تأكيد هذا الإثبات. حاول مرة أخرى.');

    setState(() => _busy.add(proof.id));
    final (confirmed, _, message) = await graphql.confirmRescueProof(proof.id);
    if (!mounted) return;
    setState(() => _busy.remove(proof.id));
    if (confirmed == null) {
      Fluttertoast.showToast(msg: message ?? failedCopy);
      return;
    }
    setState(() {
      // The backend closes every other pending proof when the post closes.
      _proofs = _proofs.map((p) {
        if (p.id == confirmed.id) return confirmed;
        return p.isPending ? p.copyWith(status: 'CLOSED') : p;
      }).toList();
    });
    events.postsChanged();
    Fluttertoast.showToast(msg: successCopy);
    widget.onPostClosed(kind.closedStatus);
  }

  Future<void> _reject(RescueProof proof) async {
    if (_busy.contains(proof.id)) return;
    final name = _name(proof);
    final ok = await _confirmDialog(
      title: t(context, 'Reject this proof?', 'رفض هذا الإثبات؟'),
      body: t(
        context,
        '$name will be told it was not accepted. Your post stays open.',
        'سيتم إبلاغ $name بأنه لم يُقبل. سيبقى منشورك مفتوحًا.',
      ),
      action: t(context, 'Reject', 'رفض'),
      destructive: true,
    );
    if (!ok || !mounted) return;

    final graphql = context.read<GraphQLService>();
    final successCopy = t(context, 'Proof rejected', 'تم رفض الإثبات');
    final failedCopy = t(context, 'Could not reject this proof. Try again.', 'تعذر رفض هذا الإثبات. حاول مرة أخرى.');

    setState(() => _busy.add(proof.id));
    final (rejected, _, message) = await graphql.rejectRescueProof(proof.id);
    if (!mounted) return;
    setState(() => _busy.remove(proof.id));
    if (rejected == null) {
      Fluttertoast.showToast(msg: message ?? failedCopy);
      return;
    }
    setState(() => _proofs = _proofs.map((p) => p.id == rejected.id ? rejected : p).toList());
    Fluttertoast.showToast(msg: successCopy);
  }

  Future<void> _contact(RescueProof proof) async {
    final graphql = context.read<GraphQLService>();
    final unavailableCopy = t(context, 'Contact details are not available.', 'بيانات التواصل غير متاحة.');
    final failedOpenCopy = t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب');
    final (link, message) = await graphql.fetchRescueProofWhatsAppLink(proof.id);
    if (!mounted) return;
    if (link == null) {
      Fluttertoast.showToast(msg: message ?? unavailableCopy);
      return;
    }
    final opened = await widget.openLink(link);
    if (!opened) Fluttertoast.showToast(msg: failedOpenCopy);
  }

  void _dropProofsFrom(String userId) {
    setState(() => _proofs = _proofs.where((p) => p.submitter?.id != userId).toList());
  }

  void _openViewer(List<RescueProofMedia> media, int index) {
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: Stack(
          children: [
            PageView.builder(
              controller: PageController(initialPage: index),
              itemCount: media.length,
              itemBuilder: (_, i) => InteractiveViewer(
                child: Center(child: widget.imageBuilder(media[i].publicUrl, fit: BoxFit.contain)),
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.sm),
                child: CircleAvatar(
                  backgroundColor: Colors.black54,
                  child: IconButton(
                    key: const Key('proofViewerClose'),
                    icon: const Icon(Icons.close, color: Colors.white),
                    onPressed: () => Navigator.of(ctx).pop(),
                    tooltip: t(ctx, 'Close', 'إغلاق'),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _fact(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(text: value),
                ],
              ),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }

  Widget _card(RescueProof proof) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final loc = MaterialLocalizations.of(context);
    final when = '${loc.formatMediumDate(proof.happenedAt.toLocal())} · ${loc.formatTimeOfDay(TimeOfDay.fromDateTime(proof.happenedAt.toLocal()))}';
    final submitter = proof.submitter;
    final name = _name(proof);
    final busy = _busy.contains(proof.id);

    return Container(
      key: Key('proofCard_${proof.id}'),
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: proof.isConfirmed ? AppColors.sectionLineGreen : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundImage: submitter?.profilePictureUrl != null ? NetworkImage(submitter!.profilePictureUrl!) : null,
                child: submitter?.profilePictureUrl == null ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?') : null,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: Text(name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700))),
              if (proof.isConfirmed)
                Container(
                  key: const Key('proofConfirmedBadge'),
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 4),
                  decoration: BoxDecoration(color: AppColors.sectionLineGreen.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppRadius.chip)),
                  child: Text(t(context, 'Confirmed ✓', 'تم التأكيد ✓'), style: const TextStyle(color: AppColors.sectionLineGreen, fontWeight: FontWeight.w700, fontSize: 12)),
                )
              else if (submitter != null)
                SafetyMenuButton(
                  compact: true,
                  onReportAccount: () async {
                    final blocked = await reportAccountFlow(context, userId: submitter.id);
                    if (blocked && mounted) _dropProofsFrom(submitter.id);
                  },
                  onBlock: () async {
                    final blocked = await blockAccountFlow(context, userId: submitter.id);
                    if (blocked && mounted) _dropProofsFrom(submitter.id);
                  },
                ),
            ],
          ),
          if (proof.media.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            SizedBox(
              height: 112,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: proof.media.length,
                separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
                itemBuilder: (_, i) => GestureDetector(
                  key: Key('proofPhoto_${proof.id}_$i'),
                  onTap: () => _openViewer(proof.media, i),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(AppRadius.image),
                    child: widget.imageBuilder(proof.media[i].publicUrl, width: 112, height: 112),
                  ),
                ),
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _fact(Icons.event_outlined, t(context, widget.kind.whenEn.replaceAll('?', ''), widget.kind.whenAr.replaceAll('؟', '')), when),
          _fact(Icons.place_outlined, t(context, widget.kind.whereEn.replaceAll('?', ''), widget.kind.whereAr.replaceAll('؟', '')), proof.areaName),
          _fact(Icons.favorite_border, t(context, 'Condition', 'الحالة'), proofChoiceLabel(proofConditions, proof.condition, arabic: arabic)),
          _fact(Icons.home_outlined, t(context, 'Now', 'الآن'), proofChoiceLabel(proofWhereabouts, proof.whereabouts, arabic: arabic)),
          const SizedBox(height: AppSpacing.xs),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(color: AppColors.surfaceWarm, borderRadius: BorderRadius.circular(AppRadius.card)),
            child: Text('"${proof.story}"', style: Theme.of(context).textTheme.bodyMedium),
          ),
          const SizedBox(height: AppSpacing.md),
          if (proof.isPending)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: Key('proofReject_${proof.id}'),
                    onPressed: busy ? null : () => _reject(proof),
                    style: OutlinedButton.styleFrom(foregroundColor: AppColors.critical, side: const BorderSide(color: AppColors.critical)),
                    child: Text(t(context, 'Reject', 'رفض')),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton(
                    key: Key('proofConfirm_${proof.id}'),
                    onPressed: busy ? null : () => _confirm(proof),
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.sectionLineGreen),
                    child: Text(t(context, 'Confirm', 'تأكيد')),
                  ),
                ),
              ],
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                key: Key('proofContact_${proof.id}'),
                onPressed: () => _contact(proof),
                icon: const Icon(Icons.chat, size: 18),
                label: Text(t(context, 'Contact on WhatsApp', 'تواصل عبر واتساب')),
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.sectionLineGreen),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final shown = _visible;
    if (!kRescueProofEnabled || _loading || shown.isEmpty) return const SizedBox.shrink();
    final kind = widget.kind;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${t(context, kind.titleEn, kind.titleAr)} (${shown.length})', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: AppSpacing.sm),
        ...shown.map(_card),
      ],
    );
  }
}
