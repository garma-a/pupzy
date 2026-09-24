import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support.dart';

/// Run with the e2e backend stopped (connection refused) or replaced by the
/// black hole (never answers). Signs in — Firebase still works — and records
/// what the user is shown over the next minute. The app must end up on
/// something actionable (an error with a way to retry), never a spinner that
/// cannot end.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final shoot = Shooter(binding);
  const mode = String.fromEnvironment('BACKEND_MODE', defaultValue: 'down');

  testWidgets('signing in while the API is $mode', (tester) async {
    await launchApp();
    await pumpUntil(tester, find.text('Welcome to Pupzy'), timeout: const Duration(seconds: 60));
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), viewerEmail);
    await tester.enterText(fields.at(1), e2ePassword);
    await hideKeyboard(tester);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Sign In'));

    String? lastScreen;
    for (final seconds in [5, 15, 35, 60]) {
      final end = DateTime.now().add(Duration(seconds: seconds));
      while (DateTime.now().isBefore(end)) {
        await tester.pump(const Duration(milliseconds: 500));
      }
      final spinners = find.byType(CircularProgressIndicator).hitTestable().evaluate().length;
      lastScreen = visibleTexts();
      debugPrint('BACKEND_$mode t≈${seconds}s spinners=$spinners screen: $lastScreen');
      await shoot(tester, 'backend-$mode-${seconds}s');
    }
    final stuck = find.byType(CircularProgressIndicator).hitTestable().evaluate().isNotEmpty && !RegExp(r'Retry|Try again|went wrong|connection', caseSensitive: false).hasMatch(lastScreen ?? '');
    expect(stuck, isFalse, reason: 'still only a spinner after ~2 minutes with the API $mode');
  });
}
