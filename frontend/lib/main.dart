import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'config/firebase_options.dart';
import 'localization/lang_provider.dart';
import 'screens/splash_screen.dart';
import 'services/auth_service.dart';
import 'services/browse_location_service.dart';
import 'services/graphql_service.dart';
import 'services/location_service.dart';
import 'theme/app_theme.dart';

/// Lets a screen detect when it's been returned to after a pushed route
/// (e.g. a post detail screen) is popped — used by Home to refresh its
/// FAVORITES row when a save happens on a screen pushed on top of it.
final RouteObserver<PageRoute> routeObserver = RouteObserver<PageRoute>();

void main() {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();

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
    runApp(const PupzyApp());
  }, (error, stack) {
    _reportError(error, stack);
  });
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
        ProxyProvider<AuthService, GraphQLService>(
          update: (_, auth, prev) => GraphQLService(auth),
        ),
      ],
      child: Consumer<LangProvider>(
        builder: (context, langProvider, _) {
          return MaterialApp(
            title: 'Pupzy',
            debugShowCheckedModeBanner: false,
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
