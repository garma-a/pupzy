import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/screens/legal_document_screen.dart';
import 'package:pupzy/screens/login_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  late LangProvider lang;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    lang = LangProvider();
  });

  Future<void> pumpLogin(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1600, 2600);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider<LangProvider>.value(
      value: lang,
      child: const MaterialApp(home: LoginScreen()),
    ));
    await tester.pumpAndSettle();
  }

  /// Taps the link span reading [text] in the legal notice under the form.
  Future<void> tapLink(WidgetTester tester, String text) async {
    final notice = tester.widget<RichText>(find.byWidgetPredicate(
      (w) => w is RichText && w.text.toPlainText().contains(text) && w.text.toPlainText().contains('agree'),
    ));
    TapGestureRecognizer? recognizer;
    notice.text.visitChildren((span) {
      if (span is TextSpan && span.text == text) recognizer = span.recognizer as TapGestureRecognizer?;
      return recognizer == null;
    });
    expect(recognizer, isNotNull, reason: '"$text" is a link');
    recognizer!.onTap!();
    await tester.pumpAndSettle();
  }

  testWidgets('the language can be switched before signing in', (tester) async {
    await pumpLogin(tester);
    expect(find.text('Welcome to Pupzy'), findsOneWidget);

    await tester.tap(find.text('العربية'));
    await tester.pumpAndSettle();

    expect(lang.lang, Lang.ar);
    expect(find.text('Welcome to Pupzy'), findsNothing);
  });

  testWidgets('Terms of Service opens the in-app document', (tester) async {
    await pumpLogin(tester);

    await tapLink(tester, 'Terms of Service');

    final screen = tester.widget<LegalDocumentScreen>(find.byType(LegalDocumentScreen));
    expect(screen.kind, LegalDocumentKind.terms);
  });

  testWidgets('Privacy Policy opens the in-app document', (tester) async {
    await pumpLogin(tester);

    await tapLink(tester, 'Privacy Policy');

    final screen = tester.widget<LegalDocumentScreen>(find.byType(LegalDocumentScreen));
    expect(screen.kind, LegalDocumentKind.privacy);
  });
}
