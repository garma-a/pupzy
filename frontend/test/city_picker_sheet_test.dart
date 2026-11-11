import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/widgets/city_picker_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _city(String en, String ar, String governorate, {Map<String, dynamic>? district, List<String> aliases = const []}) => {
  'id': en,
  'nameEnglish': en,
  'nameArabic': ar,
  'governorate': governorate,
  'aliases': aliases,
  'district': district,
};

final _cities = [
  _city('Sidi Gaber', 'قسم سيدي جابر', 'Alexandria'),
  _city('Smouha', 'سموحة', 'Alexandria', district: {'id': 'sg', 'nameEnglish': 'Sidi Gaber', 'nameArabic': 'قسم سيدي جابر'}),
  _city('Al Maadi', 'المعادي', 'Cairo'),
];

void main() {
  late TextEditingController search;
  late LangProvider lang;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    search = TextEditingController();
    lang = LangProvider();
  });

  Future<void> pumpPicker(
    WidgetTester tester, {
    List<Map<String, dynamic>>? cities,
    ValueChanged<Map<String, dynamic>>? onSelected,
    VoidCallback? onUseCurrentLocation,
  }) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<LangProvider>.value(
        value: lang,
        child: MaterialApp(
          home: Scaffold(
            body: CityPickerSheet(
              cities: cities ?? _cities,
              searchController: search,
              onSelected: onSelected ?? (_) {},
              onUseCurrentLocation: onUseCurrentLocation,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('search waits for typing to pause, then filters', (tester) async {
    await pumpPicker(tester);
    expect(find.byType(ListTile), findsNWidgets(3));

    await tester.enterText(find.byType(TextField), 'maadi');
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byType(ListTile), findsNWidgets(3), reason: 'still typing');

    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byType(ListTile), findsOneWidget);
    expect(find.text('Al Maadi'), findsOneWidget);
  });

  testWidgets('a Neighbourhood shows its district under the name', (tester) async {
    await pumpPicker(tester);
    expect(find.text('Sidi Gaber · Alexandria'), findsOneWidget);
    expect(find.text('Cairo'), findsOneWidget);
  });

  testWidgets('Arabic shows Arabic names, district and governorate', (tester) async {
    await lang.setLang(Lang.ar);
    await pumpPicker(tester);
    expect(find.text('سموحة'), findsOneWidget);
    expect(find.text('قسم سيدي جابر · الإسكندرية'), findsOneWidget);
    expect(find.text('القاهرة'), findsOneWidget);
  });

  testWidgets('no match says so, and the current-location row stays', (tester) async {
    var usedLocation = false;
    await pumpPicker(tester, onUseCurrentLocation: () => usedLocation = true);

    await tester.enterText(find.byType(TextField), 'zzzz');
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('No cities found'), findsOneWidget);

    await tester.tap(find.text('Use my current location'));
    expect(usedLocation, isTrue);
  });

  testWidgets('tapping a row picks that City', (tester) async {
    Map<String, dynamic>? picked;
    await pumpPicker(tester, onSelected: (city) => picked = city);
    await tester.tap(find.text('Smouha'));
    expect(picked?['id'], 'Smouha');
  });

  testWidgets('a long list builds only the rows on screen', (tester) async {
    final many = [for (var i = 0; i < 3200; i++) _city('Area $i', 'منطقة $i', 'Cairo')];
    await pumpPicker(tester, cities: many);
    expect(find.byType(ListTile).evaluate().length, lessThan(60));

    await tester.enterText(find.byType(TextField), 'area 3199');
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Area 3199'), findsOneWidget);
  });

  testWidgets('a closed picker stops listening to the shared search field', (tester) async {
    await pumpPicker(tester);
    await tester.pumpWidget(const SizedBox());
    // The next picker clears the same controller before it opens.
    search.clear();
    search.text = 'x';
    await tester.pump(const Duration(milliseconds: 200));
    expect(tester.takeException(), isNull);
  });
}
