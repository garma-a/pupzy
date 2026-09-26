import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// Runtime permissions the app asks for on first use. `flutter drive`
/// reinstalls the app, which drops earlier grants, so the host grants them
/// again here before the on-device test launches the app (it waits for the
/// grant — see `launchApp` in integration_test/support.dart). Without this,
/// Android's native location dialog covers every screen of the run.
const _permissions = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
];

Future<void> _grantPermissions() async {
  final sdk = Platform.environment['ANDROID_HOME'] ??
      Platform.environment['ANDROID_SDK_ROOT'] ??
      '${Platform.environment['LOCALAPPDATA']}\\Android\\sdk';
  final candidate = File('$sdk${Platform.pathSeparator}platform-tools${Platform.pathSeparator}adb${Platform.isWindows ? '.exe' : ''}');
  final adb = candidate.existsSync() ? candidate.path : 'adb';
  final device = Platform.environment['E2E_DEVICE'] ?? 'emulator-5554';
  for (final permission in _permissions) {
    final result = await Process.run(adb, ['-s', device, 'shell', 'pm', 'grant', 'com.pupzy.app', permission]);
    if (result.exitCode != 0) stderr.writeln('pm grant $permission failed: ${result.stderr}');
  }
}

/// `flutter drive` entry point: grants permissions, then saves every
/// `binding.takeScreenshot(name)` to `AUDIT/screenshots/<name>.png` on the host.
Future<void> main() async {
  await _grantPermissions();
  await integrationDriver(
    onScreenshot: (String name, List<int> bytes, [Map<String, Object?>? args]) async {
      final file = File('../AUDIT/screenshots/$name.png');
      await file.create(recursive: true);
      await file.writeAsBytes(bytes);
      return true;
    },
  );
}
