import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';
import 'package:provider/provider.dart';

import 'config/firebase_options.dart';
import 'localization/lang_provider.dart';
import 'screens/splash_screen.dart';
import 'services/auth_service.dart';
import 'services/browse_location_service.dart';
import 'services/graphql_service.dart';
import 'services/location_service.dart';
import 'services/notification_center.dart';
import 'services/push_service.dart';
import 'services/safety_events.dart';
import 'theme/app_theme.dart';
import 'utils/navigation.dart';

/// Lets a screen detect when it's been returned to after a pushed route
/// (e.g. a post detail screen) is popped — used by Home to refresh its
/// FAVORITES row when a save happens on a screen pushed on top of it.
final RouteObserver<PageRoute> routeObserver = RouteObserver<PageRoute>();

void main() {
  runZonedGuarded(() async {
    final widgetsBinding = WidgetsFlutterBinding.ensureInitialized();

    // Keep the OS-rendered native splash (see flutter_native_splash.yaml)
    // on screen past Flutter's first frame, instead of handing off to a
    // second, Flutter-drawn splash widget underneath it. SplashScreen below
    // renders nothing visible — it only resolves where to navigate — and
    // calls FlutterNativeSplash.remove() itself once that's known, so the
    // native splash is the only splash the user ever sees.
    FlutterNativeSplash.preserve(widgetsBinding: widgetsBinding);

    // Route framework-caught errors (widget build/layout/paint exceptions)
    // through the same reporting path as everything else, instead of just
    // printing to console with no other visibility.
    FlutterError.onError = (details) {
      FlutterError.dumpErrorToConsole(details);
      _reportError(details.exception, details.stack ?? StackTrace.empty);
    };

    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    await _useAuthEmulatorIfRequested();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    runApp(const PupzyApp());
  }, (error, stack) {
    _reportError(error, stack);
  });
}

/// End-to-end runs sign in against the Firebase Auth Emulator instead of the
/// real project: `--dart-define=AUTH_EMULATOR_HOST=10.0.2.2:9099`. Ignored in
/// profile/release builds, so it can never redirect a shipped app.
const _authEmulatorHost = String.fromEnvironment('AUTH_EMULATOR_HOST');

Future<void> _useAuthEmulatorIfRequested() async {
  if (!kDebugMode || _authEmulatorHost.isEmpty) return;
  final separator = _authEmulatorHost.lastIndexOf(':');
  await FirebaseAuth.instance.useAuthEmulator(
    _authEmulatorHost.substring(0, separator),
    int.parse(_authEmulatorHost.substring(separator + 1)),
  );
}

/// Single choke point for uncaught errors. No crash-reporting SDK is wired
/// up yet, so this just logs — swapping one in later only touches this one
/// function, not the two call sites above.
void _reportError(Object error, StackTrace stack) {
  debugPrint('Uncaught error: $error\n$stack');
}

class PupzyApp extends StatelessWidget {
  const PupzyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthService()),
        ChangeNotifierProvider(create: (_) => LangProvider()),
        ChangeNotifierProvider(create: (_) => LocationService()),
        ChangeNotifierProvider(create: (_) => BrowseLocationService()),
        ChangeNotifierProvider(create: (_) => SafetyEvents()),
        ChangeNotifierProvider(create: (_) => NotificationCenter()),
        Provider(create: (_) => PushService()),
        ProxyProvider<AuthService, GraphQLService>(
          update: (_, auth, prev) => GraphQLService(auth),
        ),
      ],
      child: Consumer<LangProvider>(
        builder: (context, langProvider, _) {
          return MaterialApp(
            title: 'Pupzy',
            debugShowCheckedModeBanner: false,
            navigatorKey: rootNavigatorKey,
            navigatorObservers: [routeObserver],
            theme: AppTheme.light(langProvider.lang),
            locale: langProvider.locale,
            supportedLocales: const [Locale('en'), Locale('ar')],
            localizationsDelegates: const [
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: const SplashScreen(),
          );
        },
      ),
    );
  }
}
