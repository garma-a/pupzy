import 'package:firebase_auth/firebase_auth.dart' show User;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/screens/complete_profile_screen.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/utils/egypt_phone.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

class _FakeAuth extends ChangeNotifier implements AuthService {
  @override
  User? get currentUser => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Records the profile the form sends; answers with an error so the screen
/// stays put instead of opening the app.
class _FakeGraphQL implements GraphQLService {
  String? sentPhone;

  @override
  Future<List<Map<String, dynamic>>> fetchCities() async => [
    {'id': 'c1', 'nameEnglish': 'Smouha', 'nameArabic': 'سموحة', 'governorate': 'Alexandria', 'aliases': <String>[], 'district': null},
  ];

  @override
  Future<(Map<String, dynamic>?, String?)> completeProfile({
    required String fullName,
    required String phoneNumber,
    String? cityId,
    double? latitude,
    double? longitude,
    String? languagePreference,
  }) async {
    sentPhone = phoneNumber;
    return (null, 'stop here');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('egyptMobileE164', () {
    final valid = {
      '01012345678': '+201012345678', // with the leading 0
      '1012345678': '+201012345678', // without it
      '01123456789': '+201123456789',
      '1223456781': '+201223456781',
      '01523456789': '+201523456789',
      '201012345678': '+201012345678', // with the country code
      '+20 101 234 5678': '+201012345678',
      '010-1234-5678': '+201012345678',
    };
    valid.forEach((input, e164) => test('"$input" → $e164', () => expect(egyptMobileE164(input), e164)));

    for (final input in ['', '0101234567', '101234567', '010123456789', '10123456789', '01312345678', '1312345678', '0201012345678', '2010123456']) {
      test('"$input" is rejected', () => expect(egyptMobileE164(input), isNull));
    }
  });

  test('a stored number is shown with its leading 0', () {
    expect(egyptMobileForField('+201012345678'), '01012345678');
    expect(egyptMobileForField(''), '');
  });

  group('sign-up form', () {
    late _FakeGraphQL graphql;
    late ToastRecorder toasts;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      graphql = _FakeGraphQL();
      toasts = ToastRecorder()..install();
    });

    tearDown(() => toasts.uninstall());

    Future<void> fillAndSubmit(WidgetTester tester, String phone) async {
      tester.view.physicalSize = const Size(1600, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<LangProvider>.value(value: LangProvider()),
          Provider<GraphQLService>.value(value: graphql),
          ChangeNotifierProvider<AuthService>.value(value: _FakeAuth()),
        ],
        child: const MaterialApp(home: CompleteProfileScreen()),
      ));
      await tester.pumpAndSettle();

      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Aya Nasser');
      await tester.enterText(fields.at(1), phone);
      await tester.tap(find.text('Search and select your city'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Smouha'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Get Started'));
      await tester.pumpAndSettle();
    }

    testWidgets('accepts the number without the leading 0 and sends +20…', (tester) async {
      await fillAndSubmit(tester, '1012345678');

      expect(graphql.sentPhone, '+201012345678');
    });

    testWidgets('accepts the number with the leading 0 and sends the same', (tester) async {
      await fillAndSubmit(tester, '01012345678');

      expect(graphql.sentPhone, '+201012345678');
    });

    testWidgets('rejects a wrong prefix without sending anything', (tester) async {
      await fillAndSubmit(tester, '1312345678');

      expect(graphql.sentPhone, isNull);
      expect(find.text('Must start with 010, 011, 012 or 015 (the 0 is optional)'), findsOneWidget);
    });
  });
}
