import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'splash_screen.dart';

/// Shown in two situations:
///
/// 1. Reactively, from `GraphQLService._checkForAccountLockout` —
///    `FirebaseAuthGuard` throws ACCOUNT_DELETED on every authenticated call
///    once a deletion has been accepted for this user (a "zero
///    ban-propagation window": access is cut the instant deletion is
///    accepted, not after cleanup finishes). The session is already signed
///    out by the time this is pushed, and there's no [deletionId]/
///    [progressToken] available — this device didn't necessarily initiate
///    the deletion, so it just shows the static explanation below.
/// 2. Directly, from [DeleteAccountScreen] right after a successful
///    `deleteMyAccount` call, passing the [deletionId]/[progressToken] the
///    mutation returned. In this case the screen polls the public
///    `accountDeletionProgress` query (no auth required — the account is
///    already locked out of ordinary access) a few times so the user sees a
///    real confirmation instead of just trusting a static message.
class AccountDeletionInProgressScreen extends StatefulWidget {
  final String? deletionId;
  final String? progressToken;

  const AccountDeletionInProgressScreen({super.key, this.deletionId, this.progressToken});

  @override
  State<AccountDeletionInProgressScreen> createState() => _AccountDeletionInProgressScreenState();
}

enum _ProgressState { checking, completed, pending, failed, unknown }

class _AccountDeletionInProgressScreenState extends State<AccountDeletionInProgressScreen> {
  static const _maxAttempts = 3;
  static const _retryDelay = Duration(seconds: 2);

  _ProgressState _state = _ProgressState.unknown;

  bool get _canPoll => widget.deletionId != null && widget.progressToken != null;

  @override
  void initState() {
    super.initState();
    if (_canPoll) {
      _state = _ProgressState.checking;
      _poll();
    }
  }

  Future<void> _poll() async {
    final graphql = context.read<GraphQLService>();
    for (var attempt = 0; attempt < _maxAttempts; attempt++) {
      final (payload, _) = await graphql.fetchAccountDeletionProgress(
        deletionId: widget.deletionId!,
        progressToken: widget.progressToken!,
      );
      if (!mounted) return;
      if (payload == null) {
        // Couldn't reach the status check at all — fall back to the
        // static "it's happening in the background" message rather than
        // implying anything went wrong with the deletion itself.
        setState(() => _state = _ProgressState.unknown);
        return;
      }
      if (payload.status == 'COMPLETED') {
        setState(() => _state = _ProgressState.completed);
        return;
      }
      if (payload.status == 'FAILED') {
        setState(() => _state = _ProgressState.failed);
        return;
      }
      // Still PENDING — cleanup (storage, related records) may take a
      // moment. Wait and check again rather than polling forever.
      if (attempt < _maxAttempts - 1) {
        await Future.delayed(_retryDelay);
        if (!mounted) return;
      }
    }
    setState(() => _state = _ProgressState.pending);
  }

  ({IconData icon, String title, String body}) _copyFor(BuildContext context) {
    switch (_state) {
      case _ProgressState.completed:
        return (
          icon: Icons.check_circle_outline,
          title: t(context, 'Account deleted', 'تم حذف الحساب'),
          body: t(
            context,
            'Your Pupzy account and its data have been permanently deleted. You’ve been signed out.',
            'تم حذف حسابك في Pupzy وبياناته نهائيًا. تم تسجيل خروجك.',
          ),
        );
      case _ProgressState.failed:
        return (
          icon: Icons.error_outline,
          title: t(context, 'Deletion needs attention', 'حذف الحساب يحتاج إلى متابعة'),
          body: t(
            context,
            'Something went wrong while finishing your account deletion. Your access has still been removed. Contact support if you have questions.',
            'حدث خطأ أثناء إتمام حذف حسابك. تم إلغاء وصولك على أي حال. تواصل مع الدعم إذا كانت لديك أي استفسارات.',
          ),
        );
      case _ProgressState.pending:
      case _ProgressState.checking:
      case _ProgressState.unknown:
        return (
          icon: Icons.delete_forever_outlined,
          title: t(context, 'Account deletion in progress', 'جارٍ حذف الحساب'),
          body: t(
            context,
            'You’ve requested to delete your Pupzy account. It’s now being permanently removed and can no longer be accessed. You’ve been signed out.',
            'لقد طلبت حذف حسابك في Pupzy. يتم الآن حذفه نهائيًا ولم يعد بالإمكان الوصول إليه. تم تسجيل خروجك.',
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = _copyFor(context);
    final checking = _state == _ProgressState.checking;

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
                    color: AppColors.textMuted.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: checking
                      ? const Padding(
                          padding: EdgeInsets.all(28),
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.textSecondary),
                        )
                      : Icon(copy.icon, size: 44, color: AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  copy.title,
                  style: Theme.of(context).textTheme.headlineLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  copy.body,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.xl),
                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: ElevatedButton(
                    onPressed: checking
                        ? null
                        : () {
                            Navigator.of(context).pushAndRemoveUntil(
                              MaterialPageRoute(builder: (_) => const SplashScreen()),
                              (route) => false,
                            );
                          },
                    child: Text(t(context, 'Done', 'تم')),
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
