import 'package:flutter/foundation.dart';

class ApiConfig {
  ApiConfig._();

  // Override at build/run time with --dart-define, e.g.:
  //   flutter build apk --release --dart-define=GRAPHQL_ENDPOINT=https://api.pupzy.app/graphql
  //   flutter build web --release --dart-define=GRAPHQL_ENDPOINT_WEB=https://api.pupzy.app/graphql
  // No override is needed for local development — `flutter run` with no
  // flags keeps using the dev defaults below exactly as before.
  static const String _endpointOverride = String.fromEnvironment('GRAPHQL_ENDPOINT');
  static const String _endpointWebOverride = String.fromEnvironment('GRAPHQL_ENDPOINT_WEB');

  // For Android emulator use 10.0.2.2, for iOS simulator use localhost
  // For physical device use your machine's local IP address
  static const String _devGraphqlEndpoint = 'http://10.0.2.2:8080/graphql';

  // Use this for web or when running on the same machine
  static const String _devGraphqlEndpointWeb = 'http://localhost:8080/graphql';

  static String get graphqlEndpoint {
    if (_endpointOverride.isNotEmpty) return _endpointOverride;
    // assert() is stripped from release/profile builds, so a real check is
    // needed here to actually fail a production build fast instead of
    // silently shipping traffic to a dev-only address.
    if (!kDebugMode) {
      throw StateError('Missing --dart-define=GRAPHQL_ENDPOINT=<url> for a non-debug build.');
    }
    return _devGraphqlEndpoint;
  }

  static String get graphqlEndpointWeb {
    if (_endpointWebOverride.isNotEmpty) return _endpointWebOverride;
    if (!kDebugMode) {
      throw StateError('Missing --dart-define=GRAPHQL_ENDPOINT_WEB=<url> for a non-debug build.');
    }
    return _devGraphqlEndpointWeb;
  }
}
