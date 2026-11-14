import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/screens/login_screen.dart';
import 'package:pupzy/theme/app_theme.dart';
import 'package:pupzy/utils/password_policy.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('missingPasswordRules', () {
    test('accepts a password that meets every rule', () {
      expect(missingPasswordRules('Pupzy-2026dog'), isEmpty);
      expect(missingPasswordRules(r'Aa1!aaaaaaaa'), isEmpty, reason: 'exactly 12 characters');
    });

    test("rejects the tester's 6-digit password on every rule but the number", () {
      expect(missingPasswordRules('123456'), [PasswordRule.length, PasswordRule.uppercase, PasswordRule.lowercase, PasswordRule.symbol]);
    });

    test('names each missing rule', () {
      expect(missingPasswordRules('Aa1!aaaaaaa'), [PasswordRule.length], reason: '11 characters');
      expect(missingPasswordRules('aa1!aaaaaaaa'), [PasswordRule.uppercase]);
      expect(missingPasswordRules('AA1!AAAAAAAA'), [PasswordRule.lowercase]);
      expect(missingPasswordRules('Aa!!aaaaaaaa'), [PasswordRule.number]);
      expect(missingPasswordRules('Aa1aaaaaaaaa'), [PasswordRule.symbol]);
    });

    test('counts the symbols Firebase counts', () {
      for (final symbol in r'^$*.[]{}()?"!@#%&/\,><' ":;|_~`=+-".split('')) {
        expect(passwordMeets(PasswordRule.symbol, 'a$symbol'), isTrue, reason: symbol);
      }
      expect(passwordMeets(PasswordRule.symbol, 'a b'), isFalse, reason: 'a space is not a symbol');
    });

    test('Arabic letters are neither upper- nor lowercase', () {
      expect(missingPasswordRules('كلمةسر123!كلمة'), containsAll([PasswordRule.uppercase, PasswordRule.lowercase]));
    });
  });

  group('sign-up form', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    Future<void> openSignUp(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1600, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ChangeNotifierProvider<LangProvider>.value(
        value: LangProvider(),
        child: const MaterialApp(home: LoginScreen()),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign Up'));
      await tester.pumpAndSettle();
    }

    Finder field(String label) => find.widgetWithText(TextFormField, label);

    testWidgets('lists the rules and ticks them as the password is typed', (tester) async {
      await openSignUp(tester);
      expect(find.byKey(const Key('passwordRules')), findsOneWidget);
      expect(find.byKey(const Key('passwordRule-length-missing')), findsOneWidget);

      await tester.enterText(field('Password'), 'Pupzy');
      await tester.pump();
      expect(find.byKey(const Key('passwordRule-uppercase-met')), findsOneWidget);
      expect(find.byKey(const Key('passwordRule-lowercase-met')), findsOneWidget);
      expect(find.byKey(const Key('passwordRule-number-missing')), findsOneWidget);

      await tester.enterText(field('Password'), 'Pupzy-2026dog');
      await tester.pump();
      for (final rule in PasswordRule.values) {
        expect(find.byKey(Key('passwordRule-${rule.name}-met')), findsOneWidget, reason: rule.name);
      }
    });

    testWidgets('refuses a weak password before contacting Firebase', (tester) async {
      await openSignUp(tester);
      await tester.enterText(field('Email'), 'aya@example.test');
      await tester.enterText(field('Password'), '123456');
      await tester.enterText(field('Confirm password'), '123456');

      await tester.ensureVisible(find.text('Create Account'));
      await tester.tap(find.text('Create Account'));
      await tester.pumpAndSettle();

      // No AuthService is provided: reaching Firebase would throw.
      expect(tester.takeException(), isNull);
      expect(
        find.text(
          r'Your password still needs at least 12 characters, an uppercase letter (A–Z), a lowercase letter (a–z) and a symbol, such as ! @ # $.',
        ),
        findsOneWidget,
        reason: 'names exactly what is missing (it has a number)',
      );
      expect(find.byKey(const Key('passwordRule-length-missing')), findsOneWidget);
      final lengthText = tester.widget<Text>(find.text('At least 12 characters'));
      expect(lengthText.style?.color, AppColors.critical, reason: 'missing rules turn red after a refused attempt');

      // The message follows the typing: only what is still missing.
      await tester.enterText(field('Password'), 'Pupzy2026dog');
      await tester.pump();
      expect(find.text(r'Your password still needs a symbol, such as ! @ # $.'), findsOneWidget);

      await tester.enterText(field('Password'), 'Pupzy-2026dog');
      await tester.pump();
      expect(find.textContaining('Your password still needs'), findsNothing);
    });

    testWidgets('in Arabic the message lists what is missing in Arabic', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final lang = LangProvider();
      await lang.setLang(Lang.ar);
      tester.view.physicalSize = const Size(1600, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ChangeNotifierProvider<LangProvider>.value(value: lang, child: const MaterialApp(home: LoginScreen())));
      await tester.pumpAndSettle();
      await tester.tap(find.text('إنشاء حساب').first);
      await tester.pumpAndSettle();

      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'aya@example.test');
      await tester.enterText(fields.at(1), 'pupzy2026dog');
      await tester.enterText(fields.at(2), 'pupzy2026dog');
      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'إنشاء حساب'));
      await tester.tap(find.widgetWithText(OutlinedButton, 'إنشاء حساب'));
      await tester.pumpAndSettle();

      expect(find.text(r'كلمة المرور ما زالت تحتاج إلى حرف إنجليزي كبير (A–Z) ورمز، مثل ! @ # $.'), findsOneWidget);
    });

    testWidgets('signing in still accepts an older, shorter password', (tester) async {
      tester.view.physicalSize = const Size(1600, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ChangeNotifierProvider<LangProvider>.value(
        value: LangProvider(),
        child: const MaterialApp(home: LoginScreen()),
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('passwordRules')), findsNothing, reason: 'the rules are for new passwords only');
      final form = tester.state<FormState>(find.byType(Form));
      await tester.enterText(field('Email'), 'aya@example.test');
      await tester.enterText(field('Password'), 'abc123');
      expect(form.validate(), isTrue);
    });
  });
}
