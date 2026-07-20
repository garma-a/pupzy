import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'config/firebase_options.dart';
import 'localization/lang_provider.dart';
import 'screens/splash_screen.dart';
import 'services/auth_service.dart';
import 'services/graphql_service.dart';
import 'theme/app_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const PupzyApp());
}

class PupzyApp extends StatelessWidget {
  const PupzyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthService()),
        ChangeNotifierProvider(create: (_) => LangProvider()),
        ProxyProvider<AuthService, GraphQLService>(
          update: (_, auth, prev) => GraphQLService(auth),
        ),
      ],
      child: Consumer<LangProvider>(
        builder: (context, langProvider, _) {
          return MaterialApp(
            title: 'Pupzy',
            debugShowCheckedModeBanner: false,
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
