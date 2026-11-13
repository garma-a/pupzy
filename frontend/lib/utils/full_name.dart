/// Full-name rules for sign-up and Edit profile.
library;

import 'package:flutter/widgets.dart';

import '../localization/lang_provider.dart';

/// Longest name the backend stores.
const int maxFullNameLength = 120;

/// Why a full name was rejected (see [checkFullName]).
enum FullNameProblem { empty, tooLong, hasDigits, hasSymbols, needsTwoParts, partTooShort }

final _spaces = RegExp(r'\s+');
// Latin, Arabic-Indic and Persian digits.
final _digits = RegExp(r'[0-9٠-٩۰-۹]');
// Letters and combining marks (Arabic diacritics) of any script, plus the
// hyphen and apostrophes used inside names: "Al-Sayed", "O'Neil".
final _nameCharacters = RegExp(r"^[\p{L}\p{M}\-'’ ]+$", unicode: true);
final _letter = RegExp(r'\p{L}', unicode: true);
// A part made of letters joined by single hyphens or apostrophes; it can't
// start or end with one ("-Aya", "Aya-") or repeat them ("Al--Sayed").
final _namePart = RegExp(r"^[\p{L}\p{M}]+(?:[\-'’][\p{L}\p{M}]+)*$", unicode: true);

/// [value] trimmed, with runs of spaces collapsed: what gets saved.
String normalizeFullName(String value) => value.trim().replaceAll(_spaces, ' ');

/// The first rule [value] breaks, or null when it is a valid full name: at
/// least two parts (first and last name), each with at least two letters, in
/// Arabic or English (or any script), without numbers or symbols other than
/// a hyphen or apostrophe inside a part.
FullNameProblem? checkFullName(String value) {
  final name = normalizeFullName(value);
  if (name.isEmpty) return FullNameProblem.empty;
  if (name.length > maxFullNameLength) return FullNameProblem.tooLong;
  if (_digits.hasMatch(name)) return FullNameProblem.hasDigits;
  if (!_nameCharacters.hasMatch(name)) return FullNameProblem.hasSymbols;
  final parts = name.split(' ');
  if (parts.length < 2) return FullNameProblem.needsTwoParts;
  for (final part in parts) {
    if (!_namePart.hasMatch(part)) return FullNameProblem.hasSymbols;
    if (_letter.allMatches(part).length < 2) return FullNameProblem.partTooShort;
  }
  return null;
}

/// The message shown under the field for [problem].
String fullNameMessage(BuildContext context, FullNameProblem problem) => switch (problem) {
  FullNameProblem.empty => t(context, 'Name is required', 'الاسم مطلوب'),
  FullNameProblem.tooLong => t(context, 'Maximum 120 characters', 'الحد الأقصى 120 حرفًا'),
  FullNameProblem.hasDigits => t(context, 'Name cannot contain numbers', 'لا يمكن أن يحتوي الاسم على أرقام'),
  FullNameProblem.hasSymbols => t(
    context,
    'Use letters only (a hyphen or apostrophe inside a name is fine)',
    'استخدم الحروف فقط (يُسمح بالشرطة أو الفاصلة العليا داخل الاسم)',
  ),
  FullNameProblem.needsTwoParts => t(context, 'Enter first and last name', 'أدخل الاسم الأول والأخير'),
  FullNameProblem.partTooShort => t(
    context,
    'Each name needs at least 2 letters',
    'يجب أن يتكون كل اسم من حرفين على الأقل',
  ),
};

/// A form validator for the full-name field.
String? validateFullName(BuildContext context, String? value) {
  final problem = checkFullName(value ?? '');
  return problem == null ? null : fullNameMessage(context, problem);
}
