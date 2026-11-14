/// The password rules for new accounts. They mirror the Firebase
/// Authentication password policy (console → Authentication → Settings →
/// Password policy, "Require enforcement"), which rejects any other password
/// at sign-up with `password-does-not-meet-requirements`. Change both
/// together.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// Minimum length set in the Firebase policy.
const int minPasswordLength = 12;

/// One rule of the policy.
enum PasswordRule { length, uppercase, lowercase, number, symbol }

final _uppercase = RegExp('[A-Z]');
final _lowercase = RegExp('[a-z]');
final _number = RegExp('[0-9]');
// The characters Firebase counts as special.
final _symbol = RegExp(r'''[\^$*.\[\]{}()?"!@#%&/\\,><':;|_~`=+\-]''');

/// Whether [password] meets [rule].
bool passwordMeets(PasswordRule rule, String password) => switch (rule) {
  PasswordRule.length => password.length >= minPasswordLength,
  PasswordRule.uppercase => _uppercase.hasMatch(password),
  PasswordRule.lowercase => _lowercase.hasMatch(password),
  PasswordRule.number => _number.hasMatch(password),
  PasswordRule.symbol => _symbol.hasMatch(password),
};

/// The rules [password] doesn't meet yet, in display order.
List<PasswordRule> missingPasswordRules(String password) => [
  for (final rule in PasswordRule.values)
    if (!passwordMeets(rule, password)) rule,
];

String passwordRuleLabel(BuildContext context, PasswordRule rule) => switch (rule) {
  PasswordRule.length => t(context, 'At least $minPasswordLength characters', '$minPasswordLength حرفًا على الأقل'),
  PasswordRule.uppercase => t(context, 'An uppercase letter (A–Z)', 'حرف إنجليزي كبير (A–Z)'),
  PasswordRule.lowercase => t(context, 'A lowercase letter (a–z)', 'حرف إنجليزي صغير (a–z)'),
  PasswordRule.number => t(context, 'A number (0–9)', 'رقم (0–9)'),
  PasswordRule.symbol => t(context, 'A symbol, such as ! @ # \$ % & *', 'رمز، مثل ! @ # \$ % & *'),
};

/// [rule] as it reads inside a sentence ("…still needs a number").
String _ruleInSentence(BuildContext context, PasswordRule rule) => switch (rule) {
  PasswordRule.length => t(context, 'at least $minPasswordLength characters', '$minPasswordLength حرفًا على الأقل'),
  PasswordRule.uppercase => t(context, 'an uppercase letter (A–Z)', 'حرف إنجليزي كبير (A–Z)'),
  PasswordRule.lowercase => t(context, 'a lowercase letter (a–z)', 'حرف إنجليزي صغير (a–z)'),
  PasswordRule.number => t(context, 'a number (0–9)', 'رقم (0–9)'),
  PasswordRule.symbol => t(context, 'a symbol, such as ! @ # \$', 'رمز، مثل ! @ # \$'),
};

/// What [password] is still missing, in one sentence: "Your password still
/// needs an uppercase letter (A–Z) and a symbol, such as ! @ # $." Lists only
/// the rules it doesn't meet yet; with [password] null, all of them.
String passwordMissingMessage(BuildContext context, String? password) {
  final missing = password == null ? PasswordRule.values : missingPasswordRules(password);
  final parts = [for (final rule in missing) _ruleInSentence(context, rule)];
  final arabic = context.read<LangProvider>().lang == Lang.ar;
  final String list;
  if (parts.length == 1) {
    list = parts.single;
  } else if (arabic) {
    list = '${parts.sublist(0, parts.length - 1).join('، ')} و${parts.last}';
  } else {
    list = '${parts.sublist(0, parts.length - 1).join(', ')} and ${parts.last}';
  }
  return t(context, 'Your password still needs $list.', 'كلمة المرور ما زالت تحتاج إلى $list.');
}

/// A form validator for a new password: names exactly what is missing.
String? validateNewPassword(BuildContext context, String? value) {
  final password = value ?? '';
  if (password.isEmpty) return t(context, 'Password is required', 'كلمة المرور مطلوبة');
  if (missingPasswordRules(password).isEmpty) return null;
  return passwordMissingMessage(context, password);
}

/// The rules under a new-password field, each ticked as the typed password
/// meets it.
class PasswordRulesChecklist extends StatelessWidget {
  const PasswordRulesChecklist({super.key, required this.controller, this.highlightMissing = false});

  final TextEditingController controller;

  /// After a refused attempt, the rules still missing turn red, so it's
  /// clear what to fix.
  final bool highlightMissing;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) => Column(
        key: const Key('passwordRules'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final rule in PasswordRule.values)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  Icon(
                    passwordMeets(rule, value.text) ? Icons.check_circle : Icons.radio_button_unchecked,
                    key: Key('passwordRule-${rule.name}-${passwordMeets(rule, value.text) ? 'met' : 'missing'}'),
                    size: 16,
                    color: passwordMeets(rule, value.text)
                        ? AppColors.sectionLineGreen
                        : highlightMissing
                        ? AppColors.critical
                        : AppColors.textMuted,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      passwordRuleLabel(context, rule),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: passwordMeets(rule, value.text)
                            ? AppColors.textPrimary
                            : highlightMissing
                            ? AppColors.critical
                            : AppColors.textMuted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
