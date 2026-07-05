import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const PupzyApp());
    expect(find.byType(PupzyApp), findsOneWidget);
    // Pump to let splash screen's navigation timer complete
    await tester.pump(const Duration(seconds: 3));
  });
}
