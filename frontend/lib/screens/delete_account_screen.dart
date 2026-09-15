import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/client_request_id.dart';
import 'account_deletion_in_progress_screen.dart';

/// Full account-deletion flow: explains the consequences, requires typing
/// a confirmation phrase, re-authenticates (the backend only accepts
/// deleteMyAccount within 5 minutes of the user's last sign-in, so this
/// screen re-establishes that immediately before submitting rather than
/// relying on however old the existing session happens to be), then
/// submits and signs the user out.
class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  bool _submitting = false;

  Future<void> _startDeletion() async {
    final confirmed = await _showConfirmationDialog();
    if (confirmed != true || !mounted) return;
    await _reauthenticateThenDelete();
  }

  Future<bool?> _showConfirmationDialog() {
    final controller = TextEditingController();
    const confirmWord = 'DELETE';
    return showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          final canConfirm = controller.text.trim().toUpperCase() == confirmWord;
          return AlertDialog(
            backgroundColor: AppColors.background,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
            title: Text(t(ctx, 'Are you absolutely sure?', 'هل أنت متأكد تمامًا؟')),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t(
                    ctx,
                    'This cannot be undone. Type DELETE to confirm.',
                    'لا يمكن التراجع عن هذا. اكتب DELETE للتأكيد.',
                  ),
                  style: Theme.of(ctx).textTheme.bodyMedium,
                ),
                const SizedBox(height: AppSpacing.md),
                TextField(
                  controller: controller,
                  autofocus: true,
                  textCapitalization: TextCapitalization.characters,
                  onChanged: (_) => setDialogState(() {}),
                  decoration: InputDecoration(
                    hintText: confirmWord,
                    filled: true,
                    fillColor: AppColors.surfaceWarm,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.chip), borderSide: BorderSide.none),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
              TextButton(
                onPressed: canConfirm ? () => Navigator.of(ctx).pop(true) : null,
                style: TextButton.styleFrom(foregroundColor: AppColors.critical),
                child: Text(t(ctx, 'Delete forever', 'حذف نهائيًا')),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Prompts for a password when the account is email/password-based
  /// (Google accounts re-authenticate via the Google sign-in sheet
  /// instead, with no typed input needed).
  Future<String?> _promptForPassword() {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(t(ctx, 'Confirm your password', 'أكّد كلمة المرور')),
        content: TextField(
          controller: controller,
          autofocus: true,
          obscureText: true,
          decoration: InputDecoration(
            hintText: t(ctx, 'Password', 'كلمة المرور'),
            filled: true,
            fillColor: AppColors.surfaceWarm,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.chip), borderSide: BorderSide.none),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text),
            child: Text(t(ctx, 'Confirm', 'تأكيد')),
          ),
        ],
      ),
    );
  }

  Future<void> _reauthenticateThenDelete() async {
    setState(() => _submitting = true);
    final auth = context.read<AuthService>();
    try {
      if (auth.signedInWithGoogle) {
        await auth.reauthenticateWithGoogle();
      } else {
        final password = await _promptForPassword();
        if (!mounted) return;
        if (password == null || password.isEmpty) {
          setState(() => _submitting = false);
          return;
        }
        await auth.reauthenticateWithPassword(password);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      Fluttertoast.showToast(
        msg: t(
          context,
          "Couldn't verify your identity. Please try again.",
          'تعذر التحقق من هويتك. يرجى المحاولة مرة أخرى.',
        ),
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
      );
      return;
    }

    if (!mounted) return;
    final graphql = context.read<GraphQLService>();
    final progressToken = generateClientRequestId();
    final (payload, error) = await graphql.deleteMyAccount(confirm: true, progressToken: progressToken);
    if (!mounted) return;
    setState(() => _submitting = false);

    if (payload == null) {
      Fluttertoast.showToast(
        msg: error ?? t(context, 'Could not delete your account. Try again.', 'تعذر حذف حسابك. حاول مرة أخرى.'),
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
      );
      return;
    }

    await auth.signOut();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => AccountDeletionInProgressScreen(
          deletionId: payload.deletionId,
          progressToken: payload.progressToken,
        ),
      ),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, 'Delete Account', 'حذف الحساب'), style: Theme.of(context).textTheme.headlineSmall),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(color: AppColors.critical.withValues(alpha: 0.1), shape: BoxShape.circle),
                child: const Icon(Icons.warning_amber_rounded, size: 32, color: AppColors.critical),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                t(context, 'This will permanently delete your account', 'سيؤدي هذا إلى حذف حسابك نهائيًا'),
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                t(
                  context,
                  'Before you continue, here\'s what happens:',
                  'قبل المتابعة، إليك ما سيحدث:',
                ),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              _ConsequenceRow(
                icon: Icons.grid_view_outlined,
                text: t(
                  context,
                  'All your posts, photos, and listings will be removed',
                  'ستتم إزالة جميع منشوراتك وصورك وإعلاناتك',
                ),
              ),
              _ConsequenceRow(
                icon: Icons.mail_outline,
                text: t(
                  context,
                  'Your contact requests and adoption applications will be deleted',
                  'سيتم حذف طلبات التواصل وطلبات التبني الخاصة بك',
                ),
              ),
              _ConsequenceRow(
                icon: Icons.block_outlined,
                text: t(
                  context,
                  "You'll be signed out immediately and can't undo this",
                  'سيتم تسجيل خروجك فورًا ولا يمكن التراجع عن هذا',
                ),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: OutlinedButton(
                  onPressed: _submitting ? null : _startDeletion,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.critical,
                    side: BorderSide(color: AppColors.critical.withValues(alpha: 0.4)),
                  ),
                  child: _submitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.critical),
                        )
                      : Text(t(context, 'Delete my account', 'حذف حسابي')),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: _submitting ? null : () => Navigator.of(context).pop(),
                  child: Text(t(context, 'Cancel', 'إلغاء')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConsequenceRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _ConsequenceRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.textMuted),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
