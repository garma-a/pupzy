import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'app_shell.dart';
import 'complete_profile_screen.dart';
import 'login_screen.dart';

/// Resolves where the app should land (Login / CompleteProfile / AppShell)
/// while the OS-rendered native splash (see flutter_native_splash.yaml,
/// kept up via FlutterNativeSplash.preserve() in main.dart) is still
/// covering the screen. This widget renders nothing visible of its own —
/// no logo, no animation — so there's only ever one splash screen, not a
/// native one immediately followed by a second Flutter-drawn one.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();

    // Still enforce a short minimum before handing off, even though
    // nothing is visibly animating — an auth chain that resolves in a few
    // milliseconds (fully cached, fast network) shouldn't make the native
    // splash flicker off almost instantly; whichever of the two finishes
    // last decides when we navigate.
    Future.wait([
      _resolveDestination(),
      Future.delayed(const Duration(milliseconds: 400)),
    ]).then((results) {
      if (mounted) _goTo(results[0] as Widget);
    });
  }

  Future<Widget> _resolveDestination() async {
    User? user;
    try {
      user = FirebaseAuth.instance.currentUser;
    } catch (_) {}

    if (user == null) {
      return const LoginScreen();
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
      return const LoginScreen();
    }

    if (user == null) {
      return const LoginScreen();
    }

    // An unverified email/password account can't call the backend at all
    // (it rejects with EMAIL_NOT_VERIFIED) — send them straight to the
    // "verify your email" screen instead of a doomed fetchMe() call.
    if (!user.emailVerified) {
      return LoginScreen(pendingVerificationEmail: user.email);
    }

    try {
      if (!mounted) return const LoginScreen();
      final graphql = context.read<GraphQLService>();
      final me = await graphql.fetchMe();

      if (me == null) {
        return const LoginScreen();
      }

      final profileComplete = me['profileComplete'] == true;
      return profileComplete ? const AppShell() : const CompleteProfileScreen();
    } catch (_) {
      return const LoginScreen();
    }
  }

  void _goTo(Widget destination) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => destination),
    );
    // Reveal the destination now that it's the thing underneath — this is
    // the only place the native splash ever comes off.
    FlutterNativeSplash.remove();
  }

  @override
  Widget build(BuildContext context) {
    // Matches flutter_native_splash.yaml's background so there's no
    // mismatch in the unlikely event a frame of this paints before the
    // native splash is removed.
    return const Scaffold(backgroundColor: AppColors.background);
  }
}
