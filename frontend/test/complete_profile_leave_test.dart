import 'package:firebase_auth/firebase_auth.dart' show User;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/screens/complete_profile_screen.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Signed in but without a profile yet; records sign-outs.
class _FakeAuth extends ChangeNotifier implements AuthService {
  int signOuts = 0;

  @override
  User? get currentUser => null;

  @override
  Future<void> signOut() async => signOuts++;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeGraphQL implements GraphQLService {
  @override
  Future<List<Map<String, dynamic>>> fetchCities() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _FakeAuth auth;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    auth = _FakeAuth();
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1600, 2400);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<LangProvider>.value(value: LangProvider()),
        Provider<GraphQLService>.value(value: _FakeGraphQL()),
        ChangeNotifierProvider<AuthService>.value(value: auth),
      ],
      child: const MaterialApp(home: CompleteProfileScreen()),
    ));
    await tester.pumpAndSettle();
  }

  Future<void> tapLeave(WidgetTester tester) async {
    await tester.ensureVisible(find.byKey(const Key('completeProfileLeave')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('completeProfileLeave')));
    await tester.pumpAndSettle();
  }

  testWidgets('offers a way out: "Use a different account" signs out after asking', (tester) async {
    await pumpScreen(tester);

    await tapLeave(tester);
    expect(find.text('Leave sign-up?'), findsOneWidget);

    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();

    expect(auth.signOuts, 1);
    expect(find.byType(CompleteProfileScreen), findsNothing);
    expect(find.text('Welcome to Pupzy'), findsOneWidget, reason: 'back on the sign-in screen');
  });

  testWidgets('"Stay" keeps the user on the form, signed in', (tester) async {
    await pumpScreen(tester);

    await tapLeave(tester);
    await tester.tap(find.text('Stay'));
    await tester.pumpAndSettle();

    expect(auth.signOuts, 0);
    expect(find.byType(CompleteProfileScreen), findsOneWidget);
  });

  testWidgets("the phone's Back button asks instead of closing the app", (tester) async {
    await pumpScreen(tester);

    final handled = await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(handled, isTrue, reason: 'the app keeps the Back press instead of exiting');
    expect(find.text('Leave sign-up?'), findsOneWidget);
    expect(auth.signOuts, 0);
  });

  testWidgets('shows a person icon, not a "?", before the name is typed', (tester) async {
    await pumpScreen(tester);

    expect(find.text('?'), findsNothing);
    expect(find.descendant(of: find.byType(CircleAvatar), matching: find.byIcon(Icons.person_outline)), findsOneWidget);
  });
}
