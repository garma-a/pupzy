import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../models/rescue_proof.dart';
import '../screens/rescue_proof_form_screen.dart';
import '../theme/app_theme.dart';

/// The rescuer's / finder's button on a RESCUE or LOST_PET post. Reflects the
/// state of *their own* latest proof for the post:
///
/// - none, or the last one was rejected → opens the proof form
/// - pending → disabled "waiting for the owner"
/// - confirmed → disabled "confirmed"
///
/// Shown only while the post is still open, or once the viewer's proof was the
/// one confirmed.
class RescueProofEntry extends StatelessWidget {
  final String postId;
  final ProofPostKind kind;
  final String? defaultArea;

  /// The viewer's own proofs for this post, in any order.
  final List<RescueProof> myProofs;
  final bool postIsActive;
  final ValueChanged<RescueProof> onSubmitted;

  final ProofPhotoPicker? photoPicker;
  final ProofPhotoUploader? photoUploader;

  const RescueProofEntry({
    super.key,
    required this.postId,
    required this.kind,
    required this.defaultArea,
    required this.myProofs,
    required this.postIsActive,
    required this.onSubmitted,
    this.photoPicker,
    this.photoUploader,
  });

  RescueProof? get _latest {
    if (myProofs.isEmpty) return null;
    return myProofs.reduce((a, b) => a.createdAt.isAfter(b.createdAt) ? a : b);
  }

  Future<void> _openForm(BuildContext context) async {
    final proof = await Navigator.of(context).push<RescueProof>(
      MaterialPageRoute(
        builder: (_) => RescueProofFormScreen(
          postId: postId,
          kind: kind,
          defaultArea: defaultArea,
          photoPicker: photoPicker,
          photoUploader: photoUploader,
        ),
      ),
    );
    if (proof != null) onSubmitted(proof);
  }

  @override
  Widget build(BuildContext context) {
    final latest = _latest;

    if (latest != null && latest.isConfirmed) {
      return SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          key: const Key('proofEntryButton'),
          onPressed: null,
          child: Text(t(context, 'Confirmed ✓ — thank you!', 'تم التأكيد ✓ — شكرًا لك!')),
        ),
      );
    }
    if (!postIsActive) return const SizedBox.shrink();

    if (latest != null && latest.isPending) {
      return SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          key: const Key('proofEntryButton'),
          onPressed: null,
          child: Text(t(context, 'Proof sent — waiting for the owner ✓', 'تم إرسال الإثبات — بانتظار المالك ✓')),
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (latest != null && latest.isRejected)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.xs),
            child: Text(
              t(context, "Your last proof wasn't accepted. You can send a new one.", 'لم يتم قبول إثباتك السابق. يمكنك إرسال إثبات جديد.'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textSecondary),
            ),
          ),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const Key('proofEntryButton'),
            onPressed: () => _openForm(context),
            icon: const Icon(Icons.verified_outlined, size: 18),
            label: Text(t(context, kind.entryEn, kind.entryAr)),
          ),
        ),
      ],
    );
  }
}
