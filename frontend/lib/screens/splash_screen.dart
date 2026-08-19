import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'app_shell.dart';
import 'complete_profile_screen.dart';
import 'login_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeIn);
    _scale = Tween<double>(begin: 0.75, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );
    _controller.forward();

    Future.delayed(const Duration(milliseconds: 2200), _navigate);
  }

  Future<void> _navigate() async {
    if (!mounted) return;

    User? user;
    try {
      user = FirebaseAuth.instance.currentUser;
    } catch (_) {}

    if (user == null) {
      _goTo(const LoginScreen());
      return;
    }

    final authService = context.read<AuthService>();

    // Verify the Firebase token is still valid, and force a fresh read of
    // emailVerified + the ID token itself — the cached values can be stale
    // (e.g. verified via the email link in a browser, then the app reopened
    // without ever refreshing locally), and a stale token keeps carrying an
    // old email_verified claim regardless of what the local flag says.
    try {
      await authService.reloadUser();
      user = authService.currentUser;
    } catch (_) {
      // Token invalid (user deleted from Firebase) — sign out and go to login
      await authService.signOut();
      if (mounted) _goTo(const LoginScreen());
      return;
    }
    if (!mounted) return;

    if (user == null) {
      _goTo(const LoginScreen());
      return;
    }

    // An unverified email/password account can't call the backend at all
    // (it rejects with EMAIL_NOT_VERIFIED) — send them straight to the
    // "verify your email" screen instead of a doomed fetchMe() call.
    if (!user.emailVerified) {
      _goTo(LoginScreen(pendingVerificationEmail: user.email));
      return;
    }

    try {
      final graphql = context.read<GraphQLService>();
      final me = await graphql.fetchMe();
      if (!mounted) return;

      if (me == null) {
        _goTo(const LoginScreen());
        return;
      }

      final profileComplete = me['profileComplete'] == true;
      _goTo(profileComplete ? const AppShell() : const CompleteProfileScreen());
    } catch (_) {
      if (mounted) _goTo(const LoginScreen());
    }
  }

  void _goTo(Widget destination) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => destination),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: FadeTransition(
          opacity: _fade,
          child: ScaleTransition(
            scale: _scale,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(24),
                  child: Image.asset(
                    'assets/images/Logo.png',
                    width: 120,
                    height: 120,
                    color: AppColors.primary,
                    colorBlendMode: BlendMode.srcIn,
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
