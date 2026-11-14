/// Egyptian mobile numbers for sign-up and Edit profile.
library;

import 'package:flutter/widgets.dart';

import '../localization/lang_provider.dart';

/// Longest input the phone fields allow: the 12 digits of "20 1XX XXX XXXX",
/// for a number pasted with the country code.
const int maxEgyptPhoneDigits = 12;

/// The national form, "01XXXXXXXXX", of an Egyptian mobile number typed
/// - with the leading 0: 01012345678,
/// - without it: 1012345678,
/// - or with the country code: 201012345678 / +20 101 234 5678;
/// or null when it isn't a valid Egyptian mobile number (010, 011, 012 or
/// 015 followed by 8 digits). Spaces, dashes and "+" are ignored.
String? egyptMobileNational(String input) {
  final digits = input.replaceAll(RegExp(r'\D'), '');
  final national = switch (digits) {
    _ when digits.startsWith('20') && digits.length == 12 => '0${digits.substring(2)}',
    _ when digits.startsWith('1') => '0$digits',
    _ => digits,
  };
  return _mobile.hasMatch(national) ? national : null;
}

final _mobile = RegExp(r'^01[0125]\d{8}$');

/// The number in E.164, "+201XXXXXXXXX", as the API expects it, or null when
/// [input] isn't a valid Egyptian mobile number (see [egyptMobileNational]).
String? egyptMobileE164(String input) {
  final national = egyptMobileNational(input);
  return national == null ? null : '+2$national';
}

/// A stored "+201XXXXXXXXX" number as the user types it: "01XXXXXXXXX".
String egyptMobileForField(String stored) {
  final national = egyptMobileNational(stored);
  return national ?? stored.replaceAll(RegExp(r'\D'), '');
}

/// A form validator for an Egyptian mobile number. With [required] false an
/// empty field is fine.
String? validateEgyptMobile(BuildContext context, String? value, {required bool required}) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) {
    return required ? t(context, 'Phone number is required', 'رقم الهاتف مطلوب') : null;
  }
  if (egyptMobileNational(text) != null) return null;
  final digits = text.replaceAll(RegExp(r'\D'), '');
  final startsRight = RegExp(r'^(?:0?1|201)[0125]').hasMatch(digits) || digits.length < 3;
  return startsRight
      ? t(
          context,
          'Enter 11 digits starting with 01, or 10 digits without the 0',
          'أدخل 11 رقمًا تبدأ بـ 01، أو 10 أرقام بدون الصفر',
        )
      : t(
          context,
          'Must start with 010, 011, 012 or 015 (the 0 is optional)',
          'يجب أن يبدأ بـ 010 أو 011 أو 012 أو 015 (الصفر اختياري)',
        );
}
