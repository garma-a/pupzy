# pupzy

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Lab: Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook: Useful Flutter samples](https://docs.flutter.dev/cookbook)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Release builds for the stores

A release build needs the production API address:

```bash
flutter build appbundle --release --dart-define=GRAPHQL_ENDPOINT=https://pupzy-production.up.railway.app/graphql
flutter build ipa --release --dart-define=GRAPHQL_ENDPOINT=https://pupzy-production.up.railway.app/graphql
```

Raise `version:` in `pubspec.yaml` (for example `1.0.1+2`) before each upload.
The number after `+` must go up every time.

### Android signing

Google Play only accepts bundles signed with your upload key. Create it once,
outside the repository, then copy `android/key.properties.example` to
`android/key.properties` and fill it in. Git ignores `key.properties`,
`*.jks` and `*.keystore`.

Without `android/key.properties`, a release build is signed with the debug key
so `flutter run --release` still works, and the build prints a warning. Google
Play rejects such a bundle. Back up the keystore and its passwords: every
future update must be signed with the same upload key.
