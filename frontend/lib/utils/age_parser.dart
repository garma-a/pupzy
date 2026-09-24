/// Parses the free-text pet age typed into the Adoption and Find-a-Mate forms
/// into the backend's `ageValue` + `ageUnit` (`DAYS`, `WEEKS`, `MONTHS`,
/// `YEARS`). Returns null when no positive age can be read.
///
/// Arabic input matters as much as English: Arabic keyboards type
/// Arabic-Indic digits (٣) by default, units are written in Arabic (شهور),
/// and dual forms carry the number in the word itself (سنتان = two years —
/// the forms' own Arabic placeholder). A number with no unit means years,
/// matching how people usually state an adult pet's age.
(int, String)? parseAge(String text) {
  final normalized = _toAsciiDigits(text).toLowerCase().trim();
  if (normalized.isEmpty) return null;

  final number = RegExp(r'\d+').firstMatch(normalized);
  if (number != null) {
    final value = int.tryParse(number.group(0)!);
    if (value == null || value <= 0) return null;
    // The unit that follows the number wins ("1 year 6 months" → 1 YEARS).
    return (value, _firstUnit(normalized, from: number.end) ?? _firstUnit(normalized) ?? 'YEARS');
  }

  // No digits: an Arabic dual (سنتان, شهرين…) means two; a bare unit word
  // (سنة, شهر, "a year") means one.
  final unit = _firstUnit(normalized);
  if (unit == null) return null;
  return (_arabicDual.hasMatch(normalized) ? 2 : 1, unit);
}

String _toAsciiDigits(String input) {
  final out = StringBuffer();
  for (final rune in input.runes) {
    if (rune >= 0x0660 && rune <= 0x0669) {
      out.writeCharCode(0x30 + rune - 0x0660); // Arabic-Indic ٠-٩
    } else if (rune >= 0x06F0 && rune <= 0x06F9) {
      out.writeCharCode(0x30 + rune - 0x06F0); // Extended Arabic-Indic ۰-۹
    } else {
      out.writeCharCode(rune);
    }
  }
  return out.toString();
}

final _unitPatterns = <String, RegExp>{
  'YEARS': RegExp(r'year|(?<![a-z])yrs?(?![a-z])|سنة|سنه|سنوات|سنين|سنتان|سنتين|عام|أعوام|اعوام'),
  'MONTHS': RegExp(r'month|(?<![a-z])mos?(?![a-z])|شهر|شهور|أشهر|اشهر'),
  'WEEKS': RegExp(r'week|(?<![a-z])wks?(?![a-z])|أسبوع|اسبوع|أسابيع|اسابيع'),
  'DAYS': RegExp(r'(?<![a-z])days?(?![a-z])|يوم|أيام|ايام'),
};

final _arabicDual = RegExp('سنتان|سنتين|عامين|عامان|شهرين|شهران|أسبوعين|اسبوعين|يومين|يومان');

/// The unit whose keyword appears earliest at or after [from].
String? _firstUnit(String text, {int from = 0}) {
  String? best;
  var bestAt = text.length + 1;
  _unitPatterns.forEach((unit, pattern) {
    for (final m in pattern.allMatches(text)) {
      if (m.start >= from && m.start < bestAt) {
        best = unit;
        bestAt = m.start;
        break;
      }
    }
  });
  return best;
}
