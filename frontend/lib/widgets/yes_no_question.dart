import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// A form question answered with two labelled buttons, "Yes" and "No".
///
/// Used instead of a bare switch or checkbox wherever a form asks something:
/// the answer is written on the control, so it reads the same at a glance,
/// in Arabic, and to a screen reader — no guessing what "on" means for
/// "Can the animal move on its own?". Both answers stay visible, the chosen
/// one filled, so a reviewer can scan a long form and see every answer.
///
/// Neither answer is styled as good or bad: "Yes" to "Is its life in
/// danger?" is not a success state, so the selected answer always uses the
/// brand colour.
///
/// A null [value] means "not answered yet": neither button is filled. Forms
/// use that for questions that must be answered deliberately rather than
/// left on a default, and keep their submit button disabled until then.
///
/// Short questions sit on one line with the buttons at the end; at large
/// text sizes the buttons move under the question so nothing gets squeezed.
class YesNoQuestion extends StatelessWidget {
  const YesNoQuestion({super.key, required this.question, required this.value, required this.onChanged, this.helper});

  /// Phrase it as a question ("Is it vaccinated?").
  final String question;

  /// Optional clarification under the question (examples, when to say No).
  final String? helper;

  /// The answer, or null when it hasn't been answered yet.
  final bool? value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final stacked = MediaQuery.textScalerOf(context).scale(1) > 1.3;

    final label = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(question, style: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        if (helper != null) ...[const SizedBox(height: 2), Text(helper!, style: textTheme.bodySmall)],
      ],
    );
    final answers = _YesNoSegments(question: question, value: value, onChanged: onChanged);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: stacked
          ? Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                label,
                const SizedBox(height: AppSpacing.sm),
                answers,
              ],
            )
          : Row(
              children: [
                Expanded(child: label),
                const SizedBox(width: AppSpacing.md),
                answers,
              ],
            ),
    );
  }
}

class _YesNoSegments extends StatelessWidget {
  const _YesNoSegments({required this.question, required this.value, required this.onChanged});

  final String question;
  final bool? value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: question,
      value: value == null ? t(context, 'Not answered', 'لم تتم الإجابة') : null,
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: AppColors.surfaceWarm,
          borderRadius: BorderRadius.circular(AppRadius.chip),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _Segment(label: t(context, 'Yes', 'نعم'), selected: value == true, onTap: () => _choose(true)),
            _Segment(label: t(context, 'No', 'لا'), selected: value == false, onTap: () => _choose(false)),
          ],
        ),
      ),
    );
  }

  void _choose(bool answer) {
    if (answer == value) return;
    HapticFeedback.selectionClick();
    onChanged(answer);
  }
}

class _Segment extends StatelessWidget {
  const _Segment({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? AppColors.onPrimary : AppColors.textSecondary;
    return Semantics(
      button: true,
      inMutuallyExclusiveGroup: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        // 40dp pill inside a 3dp track: a 46dp touch target.
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
          // Wide enough for "✓ Yes" either way, so answers line up down a form
          // and the control does not shift when the tick moves.
          constraints: const BoxConstraints(minWidth: 76, minHeight: 40),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          decoration: BoxDecoration(
            color: selected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.chip),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: 0.25),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : null,
          ),
          // Sized to the label (at least the min constraints), never stretched
          // by the parent; the label sits in the middle.
          child: Center(
            widthFactor: 1,
            heightFactor: 1,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // The tick marks the answer without relying on colour alone.
                AnimatedSize(
                  duration: const Duration(milliseconds: 160),
                  child: selected
                      ? Padding(
                          padding: const EdgeInsetsDirectional.only(end: 4),
                          child: Icon(Icons.check, size: 16, color: foreground),
                        )
                      : const SizedBox.shrink(),
                ),
                Text(
                  label,
                  style: TextStyle(color: foreground, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
