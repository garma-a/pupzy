/// The password rules for new accounts. They mirror the Firebase
/// Authentication password policy (console → Authentication → Settings →
/// Password policy, "Require enforcement"), which rejects any other password
/// at sign-up with `password-does-not-meet-requirements`. Change both
/// together.
library;

import 'package:flutter/material.dart';

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

/// The whole policy in one sentence, for an error message.
String passwordPolicySummary(BuildContext context) => t(
  context,
  'Use at least $minPasswordLength characters, with an uppercase letter, a lowercase letter, a number and a symbol.',
  'استخدم $minPasswordLength حرفًا على الأقل، تشمل حرفًا إنجليزيًا كبيرًا وحرفًا صغيرًا ورقمًا ورمزًا.',
);

/// A form validator for a new password.
String? validateNewPassword(BuildContext context, String? value) {
  final password = value ?? '';
  if (password.isEmpty) return t(context, 'Password is required', 'كلمة المرور مطلوبة');
  final missing = missingPasswordRules(password);
  if (missing.isEmpty) return null;
  return missing.length == 1 ? passwordRuleLabel(context, missing.single) : passwordPolicySummary(context);
}

/// The rules under a new-password field, each ticked as the typed password
/// meets it.
class PasswordRulesChecklist extends StatelessWidget {
  const PasswordRulesChecklist({super.key, required this.controller});

  final TextEditingController controller;

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
                    color: passwordMeets(rule, value.text) ? AppColors.sectionLineGreen : AppColors.textMuted,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      passwordRuleLabel(context, rule),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: passwordMeets(rule, value.text) ? AppColors.textPrimary : AppColors.textMuted,
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
