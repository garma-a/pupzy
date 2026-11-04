import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Two-option segmented toggle: a sliding pill behind the selected label,
/// with the label color crossfading in sync. Used for the language and
/// notifications settings so they look and move the same.
class PillToggle extends StatelessWidget {
  final String firstLabel;
  final String secondLabel;

  /// Whether the first option is the selected one.
  final bool firstSelected;

  /// Called with true when the first option is tapped, false for the second.
  /// Tapping the option that is already selected does nothing.
  final ValueChanged<bool> onChanged;

  /// Smaller, for a settings row rather than a section of its own.
  final bool compact;

  /// Fixes which physical side each option sits on. Null follows the app's
  /// reading direction, so the first option is on the right in Arabic.
  final TextDirection? textDirection;

  /// Key for the sliding pill, for tests.
  final Key? pillKey;

  const PillToggle({
    super.key,
    required this.firstLabel,
    required this.secondLabel,
    required this.firstSelected,
    required this.onChanged,
    this.compact = false,
    this.textDirection,
    this.pillKey,
  });

  static const _duration = Duration(milliseconds: 260);

  @override
  Widget build(BuildContext context) {
    final content = Stack(
      children: [
        AnimatedAlign(
          duration: _duration,
          curve: Curves.easeOutCubic,
          alignment: firstSelected ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
          child: FractionallySizedBox(
            widthFactor: 0.5,
            heightFactor: 1,
            child: DecoratedBox(
              key: pillKey,
              decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(AppRadius.chip)),
            ),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _PillOption(
                label: firstLabel,
                selected: firstSelected,
                fontSize: compact ? 13 : null,
                duration: _duration,
                onTap: firstSelected ? null : () => onChanged(true),
              ),
            ),
            Expanded(
              child: _PillOption(
                label: secondLabel,
                selected: !firstSelected,
                fontSize: compact ? 13 : null,
                duration: _duration,
                onTap: firstSelected ? () => onChanged(false) : null,
              ),
            ),
          ],
        ),
      ],
    );
    return Container(
      height: compact ? 34 : 46,
      padding: EdgeInsets.all(compact ? 2 : 3),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: AppColors.border),
      ),
      child: textDirection == null ? content : Directionality(textDirection: textDirection!, child: content),
    );
  }
}

class _PillOption extends StatelessWidget {
  final String label;
  final bool selected;
  final double? fontSize;
  final Duration duration;
  final VoidCallback? onTap;

  const _PillOption({required this.label, required this.selected, this.fontSize, required this.duration, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Center(
          child: AnimatedDefaultTextStyle(
            duration: duration,
            style: TextStyle(color: selected ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: fontSize),
            child: Text(label),
          ),
        ),
      ),
    );
  }
}
