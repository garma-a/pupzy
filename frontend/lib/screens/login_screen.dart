import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'app_shell.dart';
import 'complete_profile_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _loading = false;

  Future<void> _continueWithGoogle() async {
    setState(() => _loading = true);

    try {
      final auth = context.read<AuthService>();
      final result = await auth.signInWithGoogle();
      if (result == null) {
        setState(() => _loading = false);
        return;
      }

      if (!mounted) return;

      final graphql = context.read<GraphQLService>();
      final me = await graphql.fetchMe();

      if (!mounted) return;

      final profileComplete = me?['profileComplete'] == true;

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => profileComplete
              ? const AppShell()
              : const CompleteProfileScreen(),
        ),
      );
    } catch (e) {
      if (mounted) {
        Fluttertoast.showToast(
          msg: 'Google sign-in failed. Please try again.',
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(24),
                  child: Image.asset(
                    'assets/images/Logo.png',
                    width: 100,
                    height: 100,
                    color: AppColors.primary,
                    colorBlendMode: BlendMode.srcIn,
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  'Welcome to Pupzy',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Help animals in need around Egypt',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 48),
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
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Colors.white,
                            ),
                          )
                        : Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                width: 30,
                                height: 30,
                                decoration: const BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                ),
                                padding: const EdgeInsets.all(5),
                                child: const _GoogleLogo(size: 20),
                              ),
                              const SizedBox(width: 12),
                              const Text(
                                'Continue with Google',
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  'By continuing, you agree to our\nTerms of Service and Privacy Policy',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
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
