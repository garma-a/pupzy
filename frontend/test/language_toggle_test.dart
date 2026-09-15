import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/widgets/language_toggle.dart';

/// Regression coverage for the language-toggle slide animation.
///
/// The bug this guards against: in the real app (`main.dart`), switching
/// language rebuilds `MaterialApp` with a new `locale`, which flips the
/// ambient `Directionality` for the whole tree at the exact same instant
/// the toggle's own `lang` prop changes. If the toggle expressed the pill's
/// position relative to that same ambient direction (`AlignmentDirectional`
/// with no internal override), the direction flip and the alignment-target
/// flip cancel out: `centerEnd` under the new RTL ambient resolves to the
/// same physical side `centerStart` resolved to under the old LTR ambient.
/// The pill lands in the (correct) end state with zero visible frames of
/// motion in between — the reported "animation can't be seen" bug.
///
/// This harness reproduces that exact coupling: the same [setState] call
/// that changes the toggle's `lang` also changes the hosting `MaterialApp`'s
/// `locale`, mirroring `main.dart`'s `Consumer<LangProvider>` wrapping the
/// whole app. It then asserts the pill is visibly mid-flight at an
/// intermediate frame, not just correctly placed once settled — a test that
/// only checked the final position would pass against the buggy
/// implementation too, since the bug never gets the *end* state wrong.
void main() {
  Rect pillRect(WidgetTester tester) => tester.getRect(find.byKey(const Key('languageTogglePill')));

  Widget harness() {
    var lang = Lang.en;
    return StatefulBuilder(
      builder: (context, setState) {
        return MaterialApp(
          locale: lang == Lang.ar ? const Locale('ar') : const Locale('en'),
          supportedLocales: const [Locale('en'), Locale('ar')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(
            body: LanguageToggle(
              lang: lang,
              // Changes `lang` AND the hosting MaterialApp's `locale` (and
              // therefore ambient Directionality) in the same rebuild —
              // exactly what happens in the real app.
              onChanged: (l) => setState(() => lang = l),
            ),
          ),
        );
      },
    );
  }

  testWidgets('starts with the pill under the active (English) language', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    final pill = pillRect(tester);
    final englishLabel = tester.getRect(find.text('English'));
    expect((pill.center.dx - englishLabel.center.dx).abs(), lessThan(pill.width / 2));
  });

  testWidgets('switching to Arabic (and flipping the host to RTL at the same time) still visibly animates the pill', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();
    final startX = pillRect(tester).center.dx;

    await tester.tap(find.text('العربية'));
    await tester.pump(); // start the animation + the simultaneous locale/Directionality flip

    // Sample partway through the 260ms transition.
    await tester.pump(const Duration(milliseconds: 100));
    final midX = pillRect(tester).center.dx;

    await tester.pumpAndSettle();
    final endX = pillRect(tester).center.dx;

    // This is the actual regression check: with the bug, midX == startX ==
    // endX (the ambient-direction flip and the alignment-target flip cancel
    // out, so the pill never visibly moves even though it ends up correct).
    expect(midX, isNot(equals(startX)), reason: 'pill should have started moving by the 100ms mark');
    expect(midX, isNot(equals(endX)), reason: 'pill should still be mid-flight at the 100ms mark, not already arrived');

    final arabicLabel = tester.getRect(find.text('العربية'));
    expect((endX - arabicLabel.center.dx).abs(), lessThan(pillRect(tester).width / 2), reason: 'pill should settle under "العربية"');
  });

  testWidgets('switching back to English (host flips back to LTR) also visibly animates', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();
    await tester.tap(find.text('العربية'));
    await tester.pumpAndSettle();
    final startX = pillRect(tester).center.dx;

    await tester.tap(find.text('English'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    final midX = pillRect(tester).center.dx;
    await tester.pumpAndSettle();
    final endX = pillRect(tester).center.dx;

    expect(midX, isNot(equals(startX)));
    expect(midX, isNot(equals(endX)));
    expect(endX, lessThan(startX), reason: 'pill should move back left, under "English"');
  });
}
