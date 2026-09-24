import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:integration_test/integration_test.dart';

import 'support.dart';

/// Exploratory pass: sign in as the seeded owner and capture every tab.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final shoot = Shooter(binding);

  testWidgets('owner signs in and visits every tab', (tester) async {
    ImagePickerPlatform.instance = FakeImagePicker();
    await launchApp();
    await signIn(tester, ownerEmail);
    await shoot(tester, 'explore-01-home');
    for (final (i, tab) in ['Help', 'Adopt', 'Market'].indexed) {
      await tester.tap(find.text(tab).last);
      await tester.pump(const Duration(seconds: 8));
      await shoot(tester, 'explore-0${i + 2}-${tab.toLowerCase()}');
    }
  });
}
