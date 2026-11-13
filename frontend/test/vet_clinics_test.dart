import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:graphql_flutter/graphql_flutter.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/vet_clinic.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/widgets/nearby_vets_section.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _UnusedAuth extends Fake implements AuthService {}

Map<String, dynamic> _clinicJson({
  String id = 'v1',
  double distanceKm = 4.2,
  bool release = true,
  bool approximate = false,
  bool is24Hours = false,
  String? facebookUrl,
}) => {
  '__typename': 'VetClinic',
  'id': id,
  'nameEnglish': 'Pet Care Clinic (Damanhour)',
  'nameArabic': 'عيادة رعاية الحيوان (دمنهور)',
  'phoneNumber': null,
  'address': '12 Nile St',
  'website': null,
  'latitude': 31.03,
  'longitude': 30.47,
  'distanceKm': distanceKm,
  'googleMapsUrl': 'https://maps.google.com/?q=pet+care',
  'whatsappPhoneUrl': null,
  if (release) ...{
    'addressEnglish': '12 Nile St',
    'addressArabic': '١٢ شارع النيل',
    'is24Hours': is24Hours,
    'facebookUrl': facebookUrl,
    'isApproximateLocation': approximate,
  },
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('queries', () {
    test('the release query asks for the new fields; the legacy one does not', () {
      for (final (query, legacy) in [
        (GraphQLService.nearbyVetClinicsQuery, GraphQLService.legacyNearbyVetClinicsQuery),
        (GraphQLService.postDetailQuery, GraphQLService.legacyPostDetailQuery),
      ]) {
        for (final field in ['addressEnglish', 'addressArabic', 'is24Hours', 'facebookUrl', 'isApproximateLocation']) {
          expect(query, contains(field));
          expect(legacy, isNot(contains(field)));
        }
        expect(legacy, contains('whatsappPhoneUrl'));
        expect(query, isNot(contains('__VET_CLINIC_FIELDS__')));
        expect(() => gql(query), returnsNormally);
        expect(() => gql(legacy), returnsNormally);
      }
    });

    GraphQLService serviceWith(List<Request> requests, Response Function(Request) respond) {
      final service = GraphQLService(_UnusedAuth());
      service.client.value = GraphQLClient(
        link: Link.function((request, [forward]) async* {
          requests.add(request);
          yield respond(request);
        }),
        cache: GraphQLCache(),
      );
      addTearDown(service.client.dispose);
      return service;
    }

    bool isRelease(Request r) =>
        r.operation.document == gql(GraphQLService.nearbyVetClinicsQuery) || r.operation.document == gql(GraphQLService.postDetailQuery);

    test('a server without the new fields gets the old query, for the rest of the session', () async {
      final requests = <Request>[];
      final service = serviceWith(
        requests,
        (r) => isRelease(r)
            ? const Response(
                response: {},
                errors: [GraphQLError(message: 'Cannot query field "is24Hours" on type "VetClinic".')],
              )
            : Response(
                response: const {},
                data: {
                  '__typename': 'Query',
                  'nearbyVetClinics': [_clinicJson(release: false)],
                },
              ),
      );

      final (clinics, error) = await service.fetchNearbyVetClinics(cityId: 'c1');
      expect(error, isNull);
      expect(clinics.single.is24Hours, isFalse);
      expect(clinics.single.addressFor(true), '12 Nile St', reason: 'falls back to the single address');

      await service.fetchNearbyVetClinics(cityId: 'c1');
      expect(requests.map(isRelease), [true, false, false]);
    });

    test('other errors are not mistaken for a missing field', () async {
      final requests = <Request>[];
      final service = serviceWith(
        requests,
        (_) => const Response(
          response: {},
          errors: [GraphQLError(message: 'City not found')],
        ),
      );

      final (clinics, error) = await service.fetchNearbyVetClinics(cityId: 'c1');
      expect(clinics, isEmpty);
      expect(error, 'City not found');
      expect(requests, hasLength(1), reason: 'no retry');
    });

    test('the post detail page also falls back, so it still loads', () async {
      final requests = <Request>[];
      final service = serviceWith(
        requests,
        (r) => isRelease(r)
            ? const Response(
                response: {},
                errors: [GraphQLError(message: 'Cannot query field "is24Hours" on type "VetClinic".')],
              )
            : const Response(
                response: {},
                errors: [GraphQLError(message: 'stop here')],
              ),
      );

      await service.fetchPostDetail('p1');
      expect(requests.map(isRelease), [true, false]);
      expect(requests.last.operation.document, gql(GraphQLService.legacyPostDetailQuery));
    });
  });

  group('model', () {
    test('reads the new fields, and defaults them when absent', () {
      final full = VetClinic.fromJson(_clinicJson(approximate: true, is24Hours: true, facebookUrl: 'https://facebook.com/x'));
      expect((full.is24Hours, full.isApproximateLocation, full.facebookUrl), (true, true, 'https://facebook.com/x'));
      expect(full.addressFor(true), '١٢ شارع النيل');
      expect(full.addressFor(false), '12 Nile St');

      final old = VetClinic.fromJson(_clinicJson(release: false));
      expect((old.is24Hours, old.isApproximateLocation, old.facebookUrl), (false, false, null));
    });
  });

  group('clinic rows', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    Future<void> pumpSection(WidgetTester tester, List<VetClinic> clinics, {bool arabic = false}) async {
      final lang = LangProvider();
      if (arabic) await tester.runAsync(() => lang.setLang(Lang.ar));
      await tester.pumpWidget(
        ChangeNotifierProvider<LangProvider>.value(
          value: lang,
          child: MaterialApp(
            locale: Locale(arabic ? 'ar' : 'en'),
            supportedLocales: const [Locale('en'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            home: Scaffold(
              body: SingleChildScrollView(child: NearbyVetsSection(clinics: clinics)),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    VetClinic clinic({double km = 4.2, bool approximate = false, bool is24Hours = false, String? facebookUrl}) =>
        VetClinic.fromJson(_clinicJson(distanceKm: km, approximate: approximate, is24Hours: is24Hours, facebookUrl: facebookUrl));

    testWidgets('an approximate clinic nearby says "In your area", not "0.0 km"', (tester) async {
      await pumpSection(tester, [clinic(km: 0.0, approximate: true)]);
      expect(find.textContaining('In your area'), findsOneWidget);
      expect(find.textContaining('0.0'), findsNothing);
      expect(find.text('Approximate location'), findsOneWidget);
    });

    testWidgets('approximate distances are marked ≈, exact ones are not', (tester) async {
      await pumpSection(tester, [clinic(approximate: true), clinic(km: 12.6)]);
      expect(find.textContaining('≈ 4.2 km away'), findsOneWidget);
      expect(find.textContaining('13 km away · 12 Nile St'), findsOneWidget);
    });

    testWidgets('24h badge and Facebook button only when the clinic has them', (tester) async {
      await pumpSection(tester, [clinic(is24Hours: true, facebookUrl: 'https://facebook.com/x'), clinic()]);
      expect(find.text('24h'), findsOneWidget);
      expect(find.byIcon(Icons.facebook), findsOneWidget);
      expect(find.byIcon(Icons.directions_outlined), findsNWidgets(2));
    });

    testWidgets('names may wrap to two lines', (tester) async {
      await pumpSection(tester, [clinic()]);
      expect(tester.widget<Text>(find.text('Pet Care Clinic (Damanhour)')).maxLines, 2);
    });

    testWidgets('Arabic shows the Arabic name, address and units', (tester) async {
      await pumpSection(tester, [clinic(approximate: true, is24Hours: true)], arabic: true);
      expect(find.text('عيادة رعاية الحيوان (دمنهور)'), findsOneWidget);
      expect(find.textContaining('≈ 4.2 كم · ١٢ شارع النيل'), findsOneWidget);
      expect(find.text('٢٤ ساعة'), findsOneWidget);
      expect(find.text('موقع تقريبي'), findsOneWidget);
    });
  });
}
