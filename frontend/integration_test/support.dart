import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:integration_test/integration_test.dart';
import 'package:pupzy/main.dart' as app;

/// Seeded Auth Emulator accounts (AUDIT/e2e-rig/seed-e2e.js).
const ownerEmail = 'owner@pupzy.test';
const viewerEmail = 'viewer@pupzy.test';
const blockedEmail = 'blocked@pupzy.test';
const e2ePassword = 'E2e-only-Passw0rd!';

/// Replaces the native gallery so a test can "pick" a file it generated.
class FakeImagePicker extends ImagePickerPlatform {
  final List<String> queue = [];
  int picks = 0;

  @override
  Future<XFile?> getImageFromSource({required ImageSource source, ImagePickerOptions options = const ImagePickerOptions()}) async {
    picks++;
    return queue.isEmpty ? null : XFile(queue.removeAt(0), mimeType: 'image/jpeg');
  }
}

/// Writes a JPEG to the device's temp dir. With [gps], embeds GPS EXIF (a
/// phone photo taken at that spot) so tests can check it never goes public.
Future<String> writeTestJpeg(String name, {(double lat, double lng)? gps}) async {
  final image = img.Image(width: 320, height: 240);
  img.fill(image, color: img.ColorRgb8(196, 98, 45));
  img.drawCircle(image, x: 160, y: 120, radius: 60, color: img.ColorRgb8(255, 255, 255));
  if (gps != null) {
    image.exif.gpsIfd.gpsLatitude = gps.$1;
    image.exif.gpsIfd.gpsLongitude = gps.$2;
    image.exif.gpsIfd.gpsLatitudeRef = gps.$1 >= 0 ? 'N' : 'S';
    image.exif.gpsIfd.gpsLongitudeRef = gps.$2 >= 0 ? 'E' : 'W';
  }
  final file = File('${Directory.systemTemp.path}/$name.jpg');
  await file.writeAsBytes(img.encodeJpg(image, quality: 85));
  return file.path;
}

/// Starts the real app once the host driver has granted runtime permissions
/// (test_driver/integration_test.dart), so Android's native location dialog
/// never covers the run.
///
/// main.dart swaps in its own FlutterError.onError (synchronously, before its
/// first await); hand it straight back to the test binding, otherwise a
/// failing expectation is swallowed as an "uncaught error" and the run hangs
/// instead of failing.
Future<void> launchApp() async {
  final deadline = DateTime.now().add(const Duration(seconds: 60));
  var permission = await Geolocator.checkPermission();
  while (permission != LocationPermission.whileInUse && permission != LocationPermission.always && DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    permission = await Geolocator.checkPermission();
  }
  if (permission != LocationPermission.whileInUse && permission != LocationPermission.always) {
    debugPrint('launchApp: location still not granted ($permission); the native dialog will appear');
  }
  final testHandler = FlutterError.onError;
  app.main();
  FlutterError.onError = testHandler;
}

/// Dismisses the soft keyboard and lets the layout settle, so a following
/// tap lands where the widget actually is (adjustResize moves sheets up).
Future<void> hideKeyboard(WidgetTester tester) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pump(const Duration(milliseconds: 800));
}

/// Pumps until [finder] matches or [timeout] passes; fails with [reason].
Future<void> pumpUntil(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30), String? reason}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('${reason ?? 'Timed out waiting for $finder'} — on screen: ${visibleTexts()}');
}

/// Short visible strings, for diagnosing a timeout from the log alone.
String visibleTexts() => find
    .byType(Text)
    .hitTestable()
    .evaluate()
    .map((e) => (e.widget as Text).data)
    .whereType<String>()
    .where((t) => t.trim().isNotEmpty && t.length < 80)
    .take(30)
    .join(' | ');

/// Pumps until [finder] disappears (e.g. a spinner) or [timeout] passes.
Future<void> pumpUntilGone(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (finder.evaluate().isEmpty) return;
  }
  fail('Still showing $finder after $timeout');
}

class Shooter {
  Shooter(this.binding);
  final IntegrationTestWidgetsFlutterBinding binding;
  bool _ready = false;

  Future<void> call(WidgetTester tester, String name) async {
    if (!_ready && Platform.isAndroid) {
      await binding.convertFlutterSurfaceToImage();
      _ready = true;
    }
    await tester.pump(const Duration(milliseconds: 400));
    await binding.takeScreenshot(name);
  }
}

Future<void> signIn(WidgetTester tester, String email) async {
  await pumpUntil(tester, find.text('Welcome to Pupzy'), timeout: const Duration(seconds: 60), reason: 'login screen never appeared');
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), email);
  await tester.enterText(fields.at(1), e2ePassword);
  await tester.tap(find.widgetWithText(OutlinedButton, 'Sign In'));
  await pumpUntil(tester, find.text('Market'), timeout: const Duration(seconds: 60), reason: 'app shell never appeared after sign-in');
}
