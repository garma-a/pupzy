import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/safety.dart';
import '../theme/app_theme.dart';

/// Backend limit on report `details` (see the report input validators).
const int kReportDetailsMaxLength = 500;

/// Shows the shared report sheet — a reason picker plus optional details —
/// used for Post, Comment/Reply, and Account reports. [onSubmit] performs the
/// actual mutation; the sheet turns its [SafetyResult] into user feedback.
///
/// Resolves to `true` only when the report was committed, so callers can
/// follow up (e.g. offer to block the account) without re-checking anything.
Future<bool> showReportSheet(
  BuildContext context, {
  required String title,
  required List<ReportReasonOption> reasons,
  required bool detailsRequiredForOther,
  required Future<SafetyResult> Function(String reason, String? details) onSubmit,
}) async {
  final submitted = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ReportSheet(
      title: title,
      reasons: reasons,
      detailsRequiredForOther: detailsRequiredForOther,
      onSubmit: onSubmit,
    ),
  );
  return submitted == true;
}

class _ReportSheet extends StatefulWidget {
  final String title;
  final List<ReportReasonOption> reasons;
  final bool detailsRequiredForOther;
  final Future<SafetyResult> Function(String reason, String? details) onSubmit;

  const _ReportSheet({
    required this.title,
    required this.reasons,
    required this.detailsRequiredForOther,
    required this.onSubmit,
  });

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  final _detailsController = TextEditingController();
  String? _reason;
  bool _submitting = false;

  @override
  void dispose() {
    _detailsController.dispose();
    super.dispose();
  }

  bool get _detailsRequired => widget.detailsRequiredForOther && _reason == 'OTHER';

  bool get _canSubmit {
    if (_submitting || _reason == null) return false;
    if (_detailsRequired && _detailsController.text.trim().isEmpty) return false;
    return true;
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() => _submitting = true);
    final details = _detailsController.text.trim();
    final result = await widget.onSubmit(_reason!, details.isEmpty ? null : details);
    if (!mounted) return;
    setState(() => _submitting = false);

    if (result.ok) {
      Navigator.of(context).pop(true);
      return;
    }
    if (result.isAlreadyReported) {
      Fluttertoast.showToast(msg: t(context, "You've already reported this.", 'لقد أبلغت عن هذا بالفعل.'));
      Navigator.of(context).pop(false);
      return;
    }
    if (result.isRateLimited) {
      Fluttertoast.showToast(
        msg: t(
          context,
          "You've reached the daily limit of 10 reports. Try again later.",
          'لقد بلغت الحد اليومي وهو 10 تقارير. حاول مرة أخرى لاحقًا.',
        ),
      );
      Navigator.of(context).pop(false);
      return;
    }
    Fluttertoast.showToast(msg: result.message ?? t(context, 'Could not submit report. Try again.', 'تعذر إرسال البلاغ. حاول مرة أخرى.'));
  }

  @override
  Widget build(BuildContext context) {
    // Own modal route, cached independently of ancestor rebuilds — see
    // account_suspended_screen.dart for why this direct dependency exists.
    context.watch<LangProvider>();
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.92),
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(widget.title, style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  t(context, 'Why are you reporting this?', 'لماذا تبلغ عن هذا؟'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: AppSpacing.sm),
                ...widget.reasons.map((r) {
                  final selected = _reason == r.value;
                  return ListTile(
                    key: Key('reportReason_${r.value}'),
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: Icon(
                      selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                      color: selected ? AppColors.primary : AppColors.textMuted,
                    ),
                    title: Text(t(context, r.en, r.ar)),
                    onTap: _submitting ? null : () => setState(() => _reason = r.value),
                  );
                }),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  key: const Key('reportDetailsField'),
                  controller: _detailsController,
                  maxLines: 3,
                  maxLength: kReportDetailsMaxLength,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: t(context, 'Add details (required for Other)', 'أضف تفاصيل (مطلوبة عند اختيار أخرى)'),
                    filled: true,
                    fillColor: AppColors.surfaceWarm,
                    contentPadding: const EdgeInsets.all(16),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.card), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: ElevatedButton(
                    key: const Key('reportSubmitButton'),
                    onPressed: _canSubmit ? _submit : null,
                    child: _submitting
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(t(context, 'Submit report', 'إرسال البلاغ')),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
