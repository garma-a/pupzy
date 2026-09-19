import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';

/// Regression coverage for a real, app-wide bug: switching language (via
/// LanguageToggle inside ProfileSheet) did not immediately update text on
/// screens reached through Navigator.push or showModalBottomSheet.
///
/// Root cause: main.dart wraps the whole MaterialApp in a
/// `Consumer<LangProvider>`, and the doc comment on `t()` (lang_provider.dart)
/// assumed that was sufficient — that rebuilding MaterialApp "already
/// rebuilds every screen from the root." It doesn't: Navigator/Overlay
/// caches each route's built content independently of ancestor rebuilds;
/// only a widget that itself establishes a dependency via
/// `context.watch()` gets notified when a Provider changes. `t()` deliberately
/// uses `context.read` (it's called from non-build callbacks like toasts, so
/// it can't use watch), so no screen picked up a language change unless it
/// separately called `context.watch<LangProvider>()` somewhere in its own
/// `build()` — which most screens didn't.
///
/// The fix applied across the app: every screen/sheet that is its own
/// route (pushed via Navigator.push or shown via showModalBottomSheet) now
/// calls `context.watch<LangProvider>()` once at the top of its `build()`. The
/// two tests below prove both halves of that story: the bug is real
/// without a local watch, and a local watch actually fixes it.
void main() {
  Widget buildApp({required LangProvider lang}) {
    return ChangeNotifierProvider<LangProvider>.value(
      value: lang,
      child: Consumer<LangProvider>(
        builder: (context, langProvider, _) {
          return MaterialApp(
            locale: langProvider.locale,
            supportedLocales: const [Locale('en'), Locale('ar')],
            localizationsDelegates: const [
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: const Scaffold(body: SizedBox()),
          );
        },
      ),
    );
  }

  testWidgets('BUG: a pushed route with no local watch stays stale after a language switch', (tester) async {
    final lang = LangProvider();
    await tester.pumpWidget(buildApp(lang: lang));

    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.push(MaterialPageRoute(builder: (_) => const _NoWatchScreen()));
    await tester.pumpAndSettle();

    expect(find.text('English'), findsOneWidget);

    lang.setLang(Lang.ar);
    await tester.pump();
    await tester.pump();

    // This is the bug: the pushed screen never picked it up.
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Arabic'), findsNothing);
  });

  testWidgets('FIX: a pushed route that calls context.watch<LangProvider>() updates immediately', (tester) async {
    final lang = LangProvider();
    await tester.pumpWidget(buildApp(lang: lang));

    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.push(MaterialPageRoute(builder: (_) => const _WatchingScreen()));
    await tester.pumpAndSettle();

    expect(find.text('English'), findsOneWidget);

    lang.setLang(Lang.ar);
    await tester.pump();
    await tester.pump();

    expect(find.text('Arabic'), findsOneWidget, reason: 'the fix pattern (context.watch<LangProvider>() in build()) must actually work');
    expect(find.text('English'), findsNothing);
  });
}

class _NoWatchScreen extends StatelessWidget {
  const _NoWatchScreen();
  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Text(t(context, 'English', 'Arabic')));
  }
}

class _WatchingScreen extends StatelessWidget {
  const _WatchingScreen();
  @override
  Widget build(BuildContext context) {
    context.watch<LangProvider>();
    return Scaffold(body: Text(t(context, 'English', 'Arabic')));
  }
}
