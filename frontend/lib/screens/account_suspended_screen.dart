import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import 'splash_screen.dart';

/// Shown the moment the backend rejects a request because the account has
/// been banned (`FirebaseAuthGuard` throws this on every authenticated
/// call once `user.isBanned` is true). The session is already signed out
/// by the time this is pushed \u2014 this screen just explains why and hands
/// the user back to the normal splash \u2192 login flow.
class AccountSuspendedScreen extends StatelessWidget {
  const AccountSuspendedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    color: AppColors.critical.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.block_outlined, size: 44, color: AppColors.critical),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  t(context, 'Account suspended', '\u062a\u0645 \u062a\u0639\u0644\u064a\u0642 \u0627\u0644\u062d\u0633\u0627\u0628'),
                  style: Theme.of(context).textTheme.headlineLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  t(
                    context,
                    "Your account has been suspended for violating Pupzy's community guidelines. You've been signed out.",
                    '\u062a\u0645 \u062a\u0639\u0644\u064a\u0642 \u062d\u0633\u0627\u0628\u0643 \u0644\u0645\u062e\u0627\u0644\u0641\u062a\u0647 \u0625\u0631\u0634\u0627\u062f\u0627\u062a \u0645\u062c\u062a\u0645\u0639 Pupzy. \u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u062e\u0631\u0648\u062c\u0643.',
                  ),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.xl),
                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.of(context).pushAndRemoveUntil(
                        MaterialPageRoute(builder: (_) => const SplashScreen()),
                        (route) => false,
                      );
                    },
                    child: Text(t(context, 'Return to sign in', '\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644')),
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
