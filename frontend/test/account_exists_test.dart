import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/screens/login_screen.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

class _User extends Fake implements User {
  _User({required this.emailVerified});

  @override
  final bool emailVerified;
}

/// The email already has an account, created earlier and (by default) never
/// verified.
class _FakeAuth extends ChangeNotifier implements AuthService {
  final List<String> calls = [];
  User? _user;

  @override
  User? get currentUser => _user;

  @override
  Future<UserCredential> signUpWithEmail(String email, String password) async {
    calls.add('signUp($email)');
    throw FirebaseAuthException(code: 'email-already-in-use');
  }

  @override
  Future<UserCredential> signInWithEmail(String email, String password) async {
    calls.add('signIn($email, $password)');
    _user = _User(emailVerified: false);
    return _FakeCredential();
  }

  @override
  Future<void> resendVerificationEmail() async => calls.add('resendVerification');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeCredential extends Fake implements UserCredential {}

void main() {
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    toasts = ToastRecorder()..install();
  });

  tearDown(() => toasts.uninstall());

  Finder field(String label) => find.widgetWithText(TextFormField, label);

  Future<void> signUpWithExistingEmail(WidgetTester tester, _FakeAuth auth) async {
    tester.view.physicalSize = const Size(1600, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<LangProvider>.value(value: LangProvider()),
        ChangeNotifierProvider<AuthService>.value(value: auth),
      ],
      child: const MaterialApp(home: LoginScreen()),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign Up'));
    await tester.pumpAndSettle();
    await tester.enterText(field('Email'), 'aya@example.test');
    await tester.enterText(field('Password'), 'Pupzy-2026dog');
    await tester.enterText(field('Confirm password'), 'Pupzy-2026dog');
    await tester.ensureVisible(find.text('Create Account'));
    await tester.tap(find.text('Create Account'));
    await tester.pumpAndSettle();
  }

  Future<void> choose(WidgetTester tester, String button) async {
    await tester.tap(find.descendant(of: find.byKey(const Key('accountExistsDialog')), matching: find.text(button)));
    await tester.pumpAndSettle();
  }

  testWidgets('an existing email offers ways forward instead of a dead-end error', (tester) async {
    final auth = _FakeAuth();
    await signUpWithExistingEmail(tester, auth);

    expect(find.byKey(const Key('accountExistsDialog')), findsOneWidget);
    expect(find.text('This email already has an account'), findsOneWidget);
    for (final button in ['Sign in', 'Resend verification email', 'Forgot password?', 'Cancel']) {
      expect(find.descendant(of: find.byKey(const Key('accountExistsDialog')), matching: find.text(button)), findsOneWidget);
    }
    expect(toasts.messages, isEmpty);
  });

  testWidgets('"Resend verification email" signs in, sends the link again and shows the verify step', (tester) async {
    final auth = _FakeAuth();
    await signUpWithExistingEmail(tester, auth);

    await choose(tester, 'Resend verification email');

    expect(auth.calls, ['signUp(aya@example.test)', 'signIn(aya@example.test, Pupzy-2026dog)', 'resendVerification']);
    expect(find.text('Verify your email'), findsOneWidget);
    expect(toasts.messages, ['Verification email sent']);
  });

  testWidgets('"Sign in" uses the typed email and password; an unverified account lands on the verify step', (tester) async {
    final auth = _FakeAuth();
    await signUpWithExistingEmail(tester, auth);

    await choose(tester, 'Sign in');

    expect(auth.calls.last, 'signIn(aya@example.test, Pupzy-2026dog)');
    expect(find.text('Verify your email'), findsOneWidget);
    expect(find.text('Resend email'), findsOneWidget, reason: 'the verify step can send the link again');
  });

  testWidgets('"Forgot password?" opens the reset dialog with the email filled in', (tester) async {
    final auth = _FakeAuth();
    await signUpWithExistingEmail(tester, auth);

    await choose(tester, 'Forgot password?');

    expect(find.text('Reset password'), findsOneWidget);
    expect(find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(TextField, 'aya@example.test')), findsOneWidget);
    expect(auth.calls, ['signUp(aya@example.test)'], reason: 'nothing is sent until the user confirms');
  });

  testWidgets('"Cancel" leaves the sign-up form as it was', (tester) async {
    final auth = _FakeAuth();
    await signUpWithExistingEmail(tester, auth);

    await choose(tester, 'Cancel');

    expect(find.byKey(const Key('accountExistsDialog')), findsNothing);
    expect(field('Confirm password'), findsOneWidget, reason: 'still on Sign Up');
    expect(auth.calls, ['signUp(aya@example.test)']);
  });
}
