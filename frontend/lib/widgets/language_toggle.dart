import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import 'pill_toggle.dart';

/// Animated English/Arabic segmented toggle — a sliding pill behind the
/// selected label, with the label color crossfading in sync.
///
/// Deliberately pinned to a fixed LTR layout internally (the
/// `textDirection` passed below) regardless of [lang]: this toggle's own
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

  /// Smaller, for a settings row rather than a section of its own.
  final bool compact;

  const LanguageToggle({super.key, required this.lang, required this.onChanged, this.compact = false});

  @override
  Widget build(BuildContext context) {
    return PillToggle(
      firstLabel: 'English',
      secondLabel: 'العربية',
      firstSelected: lang == Lang.en,
      onChanged: (english) => onChanged(english ? Lang.en : Lang.ar),
      compact: compact,
      // English always on the physical left, whatever the language (above).
      textDirection: TextDirection.ltr,
      pillKey: const Key('languageTogglePill'),
    );
  }
}
