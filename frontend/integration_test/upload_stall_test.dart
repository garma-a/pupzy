import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:integration_test/integration_test.dart';
import 'package:pupzy/screens/post_form_screen.dart';

import 'mating_form.dart';
import 'support.dart';

/// A stalled upload must not freeze the form. Run with the storage port served
/// by AUDIT/e2e-rig/blackhole.js (accepts connections, never replies — what a
/// dead mobile connection looks like) instead of s3rver.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final shoot = Shooter(binding);

  testWidgets('a stalled photo upload gives control back to the user', (tester) async {
    final picker = FakeImagePicker();
    ImagePickerPlatform.instance = picker;
    picker.queue.add(await writeTestJpeg('stall'));

    await launchApp();
    await signIn(tester, ownerEmail);
    final submit = await openAndFillMatingForm(tester, picker: picker, breed: 'Stall Terrier');
    await tester.tap(submit);
    await tester.pump(const Duration(seconds: 2));
    await shoot(tester, 'stall-01-submitting');

    // Recovered = back on an enabled form (so the user can retry) or off the
    // form entirely. Anything else after 90 s is an infinite spinner.
    bool recovered() {
      if (find.byType(PostFormScreen).evaluate().isEmpty) return true;
      final button = find.widgetWithText(ElevatedButton, 'Post Mating Listing');
      return button.evaluate().isNotEmpty && tester.widget<ElevatedButton>(button).onPressed != null;
    }

    final started = DateTime.now();
    while (!recovered() && DateTime.now().difference(started) < const Duration(seconds: 90)) {
      await tester.pump(const Duration(seconds: 1));
    }
    final waited = DateTime.now().difference(started).inSeconds;
    await shoot(tester, 'stall-02-after-${waited}s');
    debugPrint('STALL_RECOVERED=${recovered()} after ${waited}s');
    expect(recovered(), isTrue, reason: 'the form was still spinning $waited s after the upload stalled');
  });
}
