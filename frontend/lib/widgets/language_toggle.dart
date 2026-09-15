import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// Animated English/Arabic segmented toggle — a sliding pill behind the
/// selected label, with the label color crossfading in sync.
///
/// Deliberately pinned to a fixed LTR layout internally (see the
/// [Directionality] override below) regardless of [lang]: this toggle's own
/// handedness must not flip when the language changes, because a language
/// switch also flips the ambient app-wide `Directionality` at the same
/// instant. If this toggle used `AlignmentDirectional` tied to that same
/// ambient direction, the Row's RTL mirroring and the pill's alignment
/// target would flip together and cancel out — the pill would land back on
/// the same physical side it started from with no visible slide. Keeping
/// English always on the physical left and Arabic always on the right gives
/// the slide a stable reference frame, independent of which language (and
/// therefore which ambient direction) is currently active.
class LanguageToggle extends StatelessWidget {
  final Lang lang;
  final ValueChanged<Lang> onChanged;

  const LanguageToggle({super.key, required this.lang, required this.onChanged});

  static const _duration = Duration(milliseconds: 260);

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 46,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: AppColors.border),
      ),
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Stack(
          children: [
            AnimatedAlign(
              duration: _duration,
              curve: Curves.easeOutCubic,
              alignment: lang == Lang.en ? Alignment.centerLeft : Alignment.centerRight,
              child: FractionallySizedBox(
                widthFactor: 0.5,
                heightFactor: 1,
                child: DecoratedBox(
                  key: const Key('languageTogglePill'),
                  decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(AppRadius.chip)),
                ),
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: _LanguageOption(
                    label: 'English',
                    selected: lang == Lang.en,
                    duration: _duration,
                    onTap: () => onChanged(Lang.en),
                  ),
                ),
                Expanded(
                  child: _LanguageOption(
                    label: 'العربية',
                    selected: lang == Lang.ar,
                    duration: _duration,
                    onTap: () => onChanged(Lang.ar),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _LanguageOption extends StatelessWidget {
  final String label;
  final bool selected;
  final Duration duration;
  final VoidCallback onTap;

  const _LanguageOption({required this.label, required this.selected, required this.duration, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Center(
        child: AnimatedDefaultTextStyle(
          duration: duration,
          style: TextStyle(color: selected ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600),
          child: Text(label),
        ),
      ),
    );
  }
}
