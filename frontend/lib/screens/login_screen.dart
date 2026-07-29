import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'app_shell.dart';
import 'complete_profile_screen.dart';

class LoginScreen extends StatefulWidget {
  /// When set, the screen opens straight into the "verify your email" state
  /// instead of the sign-in form — used when the splash screen finds a
  /// signed-in but unverified email/password account on app start.
  final String? pendingVerificationEmail;

  const LoginScreen({super.key, this.pendingVerificationEmail});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _confirmPasswordFocusNode = FocusNode();

  bool _loading = false;
  bool _isSignUp = false;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  String? _pendingVerificationEmail;

  @override
  void initState() {
    super.initState();
    _pendingVerificationEmail = widget.pendingVerificationEmail;
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _confirmPasswordFocusNode.dispose();
    super.dispose();
  }

  String _authErrorMessage(FirebaseAuthException e) {
    switch (e.code) {
      case 'email-already-in-use':
        return t(context, 'An account already exists for this email.', 'يوجد حساب مسجل بهذا البريد الإلكتروني بالفعل.');
      case 'weak-password':
        return t(context, 'Password must be at least 6 characters.', 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.');
      case 'invalid-email':
        return t(context, 'Please enter a valid email address.', 'يرجى إدخال بريد إلكتروني صالح.');
      case 'user-not-found':
        return t(context, 'No account found with this email.', 'لا يوجد حساب مسجل بهذا البريد الإلكتروني.');
      case 'wrong-password':
      case 'invalid-credential':
        return t(context, 'Incorrect email or password.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      case 'user-disabled':
        return t(context, 'This account has been disabled.', 'تم تعطيل هذا الحساب.');
      case 'too-many-requests':
        return t(context, 'Too many attempts. Please try again later.', 'محاولات كثيرة جدًا. يرجى المحاولة لاحقًا.');
      default:
        return t(context, 'Something went wrong. Please try again.', 'حدث خطأ ما. يرجى المحاولة مرة أخرى.');
    }
  }

  Future<void> _afterAuthSuccess() async {
    if (!mounted) return;
    final graphql = context.read<GraphQLService>();
    final me = await graphql.fetchMe();
    if (!mounted) return;

    final profileComplete = me?['profileComplete'] == true;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => profileComplete ? const AppShell() : const CompleteProfileScreen(),
      ),
    );
  }

  Future<void> _continueWithGoogle() async {
    setState(() => _loading = true);

    try {
      final auth = context.read<AuthService>();
      final result = await auth.signInWithGoogle();
      if (result == null) {
        setState(() => _loading = false);
        return;
      }
      await _afterAuthSuccess();
    } catch (e) {
      if (mounted) {
        Fluttertoast.showToast(
          msg: t(context, 'Google sign-in failed. Please try again.', 'فشل تسجيل الدخول عبر Google. يرجى المحاولة مرة أخرى.'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submitEmailForm() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);

    final auth = context.read<AuthService>();
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    try {
      if (_isSignUp) {
        await auth.signUpWithEmail(email, password);
        if (!mounted) return;
        setState(() => _pendingVerificationEmail = email);
      } else {
        await auth.signInWithEmail(email, password);
        if (!mounted) return;
        if (auth.currentUser?.emailVerified == false) {
          setState(() => _pendingVerificationEmail = email);
        } else {
          await _afterAuthSuccess();
        }
      }
    } on FirebaseAuthException catch (e) {
      if (mounted) {
        Fluttertoast.showToast(
          msg: _authErrorMessage(e),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } catch (_) {
      if (mounted) {
        Fluttertoast.showToast(
          msg: t(context, 'Something went wrong. Please try again.', 'حدث خطأ ما. يرجى المحاولة مرة أخرى.'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resendVerification() async {
    try {
      await context.read<AuthService>().resendVerificationEmail();
      if (mounted) {
        Fluttertoast.showToast(
          msg: t(context, 'Verification email sent', 'تم إرسال بريد التحقق'),
          backgroundColor: AppColors.primary,
          textColor: Colors.white,
        );
      }
    } catch (_) {
      if (mounted) {
        Fluttertoast.showToast(
          msg: t(context, 'Could not resend email. Please try again.', 'تعذر إعادة إرسال البريد. يرجى المحاولة مرة أخرى.'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    }
  }

  Future<void> _checkVerifiedAndContinue() async {
    setState(() => _loading = true);
    final auth = context.read<AuthService>();
    await auth.reloadUser();
    if (!mounted) return;

    if (auth.currentUser?.emailVerified == true) {
      await _afterAuthSuccess();
    } else {
      setState(() => _loading = false);
      Fluttertoast.showToast(
        msg: t(context, "Not verified yet — check your inbox and tap the link.", 'لم يتم التحقق بعد — تحقق من بريدك واضغط على الرابط.'),
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
      );
    }
  }

  Future<void> _useDifferentAccount() async {
    await context.read<AuthService>().signOut();
    if (mounted) {
      setState(() {
        _pendingVerificationEmail = null;
        _passwordController.clear();
      });
    }
  }

  void _showForgotPasswordDialog() {
    final resetEmailController = TextEditingController(text: _emailController.text.trim());
    showDialog(
      context: context,
      builder: (ctx) {
        bool sending = false;
        return StatefulBuilder(
          builder: (ctx, setDialogState) => AlertDialog(
            backgroundColor: AppColors.background,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
            title: Text(t(ctx, 'Reset password', 'إعادة تعيين كلمة المرور')),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t(ctx, "Enter your email and we'll send you a reset link.", 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين.'),
                  style: Theme.of(ctx).textTheme.bodySmall,
                ),
                const SizedBox(height: AppSpacing.md),
                TextField(
                  controller: resetEmailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    hintText: t(ctx, 'Email', 'البريد الإلكتروني'),
                    filled: true,
                    fillColor: AppColors.surface,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
              TextButton(
                onPressed: sending
                    ? null
                    : () async {
                        final email = resetEmailController.text.trim();
                        if (email.isEmpty) return;
                        setDialogState(() => sending = true);
                        try {
                          await context.read<AuthService>().sendPasswordResetEmail(email);
                          if (!ctx.mounted) return;
                          Navigator.of(ctx).pop();
                          Fluttertoast.showToast(
                            msg: t(ctx, 'Password reset email sent', 'تم إرسال بريد إعادة تعيين كلمة المرور'),
                            backgroundColor: AppColors.primary,
                            textColor: Colors.white,
                          );
                        } on FirebaseAuthException catch (e) {
                          setDialogState(() => sending = false);
                          Fluttertoast.showToast(msg: _authErrorMessage(e), backgroundColor: AppColors.critical, textColor: Colors.white);
                        }
                      },
                child: sending
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(t(ctx, 'Send link', 'إرسال الرابط')),
              ),
            ],
          ),
        );
      },
    );
  }

  InputDecoration _fieldDecoration(String hint, {Widget? suffixIcon}) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 14),
      filled: true,
      fillColor: AppColors.surface,
      suffixIcon: suffixIcon,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.primary, width: 1.5)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.critical)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.xl),
            child: _pendingVerificationEmail != null ? _buildVerificationPending(context) : _buildForm(context),
          ),
        ),
      ),
    );
  }

  Widget _buildVerificationPending(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.12), shape: BoxShape.circle),
          child: const Icon(Icons.mark_email_unread_outlined, color: AppColors.primary, size: 34),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(t(context, 'Verify your email', 'تحقق من بريدك الإلكتروني'), style: Theme.of(context).textTheme.headlineLarge, textAlign: TextAlign.center),
        const SizedBox(height: AppSpacing.sm),
        Text(
          '${t(context, 'We sent a verification link to', 'أرسلنا رابط تحقق إلى')} $_pendingVerificationEmail. ${t(context, 'Tap it, then continue below.', 'اضغط عليه، ثم تابع أدناه.')}',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: AppSpacing.xl),
        SizedBox(
          width: double.infinity,
          height: 54,
          child: ElevatedButton(
            onPressed: _loading ? null : _checkVerifiedAndContinue,
            child: _loading
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : Text(t(context, "I've verified — Continue", 'لقد تحققت — متابعة')),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        TextButton(onPressed: _resendVerification, child: Text(t(context, 'Resend email', 'إعادة إرسال البريد'))),
        TextButton(onPressed: _useDifferentAccount, child: Text(t(context, 'Use a different account', 'استخدام حساب آخر'))),
      ],
    );
  }

  Widget _buildForm(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: Image.asset(
            'assets/images/Logo.png',
            width: 88,
            height: 88,
            color: AppColors.primary,
            colorBlendMode: BlendMode.srcIn,
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(t(context, 'Welcome to Pupzy', 'مرحبًا بك في Pupzy'), style: Theme.of(context).textTheme.headlineLarge, textAlign: TextAlign.center),
        const SizedBox(height: AppSpacing.sm),
        Text(
          t(context, 'Help animals in need around Egypt', 'ساعد الحيوانات المحتاجة في جميع أنحاء مصر'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: AppSpacing.xl),
        SizedBox(
          width: double.infinity,
          height: 54,
          child: ElevatedButton(
            onPressed: _loading ? null : _continueWithGoogle,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              shape: const StadiumBorder(),
              padding: const EdgeInsets.symmetric(horizontal: 24),
              elevation: 0,
            ),
            child: _loading
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 30,
                        height: 30,
                        decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                        padding: const EdgeInsets.all(5),
                        child: const _GoogleLogo(size: 20),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        t(context, 'Continue with Google', 'المتابعة باستخدام Google'),
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Row(
          children: [
            Expanded(child: Divider(color: AppColors.border)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
              child: Text(t(context, 'or', 'أو'), style: Theme.of(context).textTheme.bodySmall),
            ),
            Expanded(child: Divider(color: AppColors.border)),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.chip),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _isSignUp = false),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(
                      color: !_isSignUp ? AppColors.primary : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                    ),
                    child: Center(
                      child: Text(
                        t(context, 'Sign In', 'تسجيل الدخول'),
                        style: TextStyle(color: !_isSignUp ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _isSignUp = true),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(
                      color: _isSignUp ? AppColors.primary : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                    ),
                    child: Center(
                      child: Text(
                        t(context, 'Sign Up', 'إنشاء حساب'),
                        style: TextStyle(color: _isSignUp ? Colors.white : AppColors.textPrimary, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                decoration: _fieldDecoration(t(context, 'Email', 'البريد الإلكتروني')),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return t(context, 'Email is required', 'البريد الإلكتروني مطلوب');
                  if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim())) {
                    return t(context, 'Enter a valid email', 'أدخل بريدًا إلكترونيًا صالحًا');
                  }
                  return null;
                },
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscurePassword,
                textInputAction: _isSignUp ? TextInputAction.next : TextInputAction.done,
                onFieldSubmitted: (_) {
                  if (_isSignUp) {
                    FocusScope.of(context).requestFocus(_confirmPasswordFocusNode);
                  } else if (!_loading) {
                    _submitEmailForm();
                  }
                },
                decoration: _fieldDecoration(
                  t(context, 'Password', 'كلمة المرور'),
                  suffixIcon: IconButton(
                    icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined, color: AppColors.textMuted, size: 20),
                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    tooltip: _obscurePassword ? t(context, 'Show password', 'إظهار كلمة المرور') : t(context, 'Hide password', 'إخفاء كلمة المرور'),
                  ),
                ),
                validator: (v) {
                  if (v == null || v.isEmpty) return t(context, 'Password is required', 'كلمة المرور مطلوبة');
                  if (v.length < 6) return t(context, 'At least 6 characters', '6 أحرف على الأقل');
                  return null;
                },
              ),
              if (_isSignUp) ...[
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _confirmPasswordController,
                  focusNode: _confirmPasswordFocusNode,
                  obscureText: _obscureConfirmPassword,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _loading ? null : _submitEmailForm(),
                  decoration: _fieldDecoration(
                    t(context, 'Confirm password', 'تأكيد كلمة المرور'),
                    suffixIcon: IconButton(
                      icon: Icon(_obscureConfirmPassword ? Icons.visibility_outlined : Icons.visibility_off_outlined, color: AppColors.textMuted, size: 20),
                      onPressed: () => setState(() => _obscureConfirmPassword = !_obscureConfirmPassword),
                      tooltip: _obscureConfirmPassword ? t(context, 'Show password', 'إظهار كلمة المرور') : t(context, 'Hide password', 'إخفاء كلمة المرور'),
                    ),
                  ),
                  validator: (v) {
                    if (v != _passwordController.text) return t(context, 'Passwords do not match', 'كلمتا المرور غير متطابقتين');
                    return null;
                  },
                ),
              ],
              if (!_isSignUp) ...[
                const SizedBox(height: 4),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: TextButton(
                    onPressed: _showForgotPasswordDialog,
                    child: Text(t(context, 'Forgot password?', 'نسيت كلمة المرور؟')),
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.sm),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: OutlinedButton(
                  onPressed: _loading ? null : _submitEmailForm,
                  child: _loading
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                      : Text(_isSignUp ? t(context, 'Create Account', 'إنشاء حساب') : t(context, 'Sign In', 'تسجيل الدخول')),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Text(
          t(
            context,
            'By continuing, you agree to our\nTerms of Service and Privacy Policy',
            'بالمتابعة، فإنك توافق على شروط الخدمة وسياسة الخصوصية الخاصة بنا',
          ),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _GoogleLogo extends StatelessWidget {
  final double size;
  const _GoogleLogo({required this.size});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _GoogleLogoPainter()),
    );
  }
}

class _GoogleLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final double f = size.width / 120;
    final paint = Paint()..style = PaintingStyle.fill;

    // Blue (#4285F4)
    paint.color = const Color(0xFF4285F4);
    final blue = Path()
      ..moveTo(117.6 * f, 61.36 * f)
      ..cubicTo(
        117.6 * f,
        57.11 * f,
        117.22 * f,
        53.02 * f,
        116.51 * f,
        49.09 * f,
      )
      ..lineTo(60 * f, 49.09 * f)
      ..lineTo(60 * f, 72.3 * f)
      ..lineTo(92.29 * f, 72.3 * f)
      ..cubicTo(90.9 * f, 79.8 * f, 86.67 * f, 86.15 * f, 80.32 * f, 90.41 * f)
      ..lineTo(80.32 * f, 105.46 * f)
      ..lineTo(99.71 * f, 105.46 * f)
      ..cubicTo(
        111.05 * f,
        95.02 * f,
        117.6 * f,
        79.64 * f,
        117.6 * f,
        61.36 * f,
      )
      ..close();
    canvas.drawPath(blue, paint);

    // Green (#34A853)
    paint.color = const Color(0xFF34A853);
    final green = Path()
      ..moveTo(60 * f, 120 * f)
      ..cubicTo(76.2 * f, 120 * f, 89.78 * f, 114.63 * f, 99.71 * f, 105.46 * f)
      ..lineTo(80.32 * f, 90.41 * f)
      ..cubicTo(74.95 * f, 94.01 * f, 68.07 * f, 96.14 * f, 60 * f, 96.14 * f)
      ..cubicTo(44.37 * f, 96.14 * f, 31.15 * f, 85.58 * f, 26.43 * f, 71.4 * f)
      ..lineTo(6.38 * f, 71.4 * f)
      ..lineTo(6.38 * f, 86.95 * f)
      ..cubicTo(16.25 * f, 106.55 * f, 36.55 * f, 120 * f, 60 * f, 120 * f)
      ..close();
    canvas.drawPath(green, paint);

    // Yellow (#FBBC05)
    paint.color = const Color(0xFFFBBC05);
    final yellow = Path()
      ..moveTo(26.43 * f, 71.4 * f)
      ..cubicTo(25.23 * f, 67.8 * f, 24.55 * f, 63.95 * f, 24.55 * f, 60 * f)
      ..cubicTo(24.55 * f, 56.05 * f, 25.23 * f, 52.2 * f, 26.43 * f, 48.6 * f)
      ..lineTo(26.43 * f, 33.05 * f)
      ..lineTo(6.38 * f, 33.05 * f)
      ..cubicTo(2.32 * f, 41.15 * f, 0, 50.32 * f, 0, 60 * f)
      ..cubicTo(0, 69.68 * f, 2.32 * f, 78.85 * f, 6.38 * f, 86.95 * f)
      ..lineTo(26.43 * f, 71.4 * f)
      ..close();
    canvas.drawPath(yellow, paint);

    // Red (#EA4335)
    paint.color = const Color(0xFFEA4335);
    final red = Path()
      ..moveTo(60 * f, 23.86 * f)
      ..cubicTo(
        68.81 * f,
        23.86 * f,
        76.72 * f,
        26.89 * f,
        82.94 * f,
        32.84 * f,
      )
      ..lineTo(100.15 * f, 15.63 * f)
      ..cubicTo(89.75 * f, 5.95 * f, 76.17 * f, 0, 60 * f, 0)
      ..cubicTo(36.55 * f, 0, 16.25 * f, 13.45 * f, 6.38 * f, 33.05 * f)
      ..lineTo(26.43 * f, 48.6 * f)
      ..cubicTo(31.15 * f, 34.42 * f, 44.37 * f, 23.86 * f, 60 * f, 23.86 * f)
      ..close();
    canvas.drawPath(red, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
