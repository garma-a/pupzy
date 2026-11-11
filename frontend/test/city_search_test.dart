import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/utils/city_search.dart';

Map<String, dynamic> _city(
  String en,
  String ar,
  String governorate, {
  List<String> aliases = const [],
  Map<String, dynamic>? district,
  String? governorateArabic,
}) => {
  'id': '$en · $governorate',
  'nameEnglish': en,
  'nameArabic': ar,
  'governorate': governorate,
  'governorateArabic': ?governorateArabic,
  'aliases': aliases,
  'district': district,
};

/// A Neighbourhood's district, as the API nests it.
Map<String, dynamic> _in(String en, String ar) => {'id': en, 'nameEnglish': en, 'nameArabic': ar};

final _sidiGaber = _city('Sidi Gaber', 'قسم سيدي جابر', 'Alexandria', aliases: ['Sidi Gabir']);

/// A slice of the catalog shaped like the backend's Neighbourhood release.
/// The aliases on Mohandessin and Port Fuad are what the handoff's test
/// table needs from the backend: without them those two rows can't match.
final _catalog = [
  _sidiGaber,
  _city('Smouha', 'سموحة', 'Alexandria', district: {'id': 'sg', 'nameEnglish': 'Sidi Gaber', 'nameArabic': 'قسم سيدي جابر'}),
  _city('Labban', 'قسم اللبان', 'Alexandria', aliases: ['A L Labban']),
  _city('Mohandessin', 'المهندسين', 'Giza', aliases: ['Mohandiseen', 'Mohandeseen']),
  _city('Al Maadi', 'المعادي', 'Cairo'),
  _city('Nasr City', 'مدينة نصر', 'Cairo'),
  _city('6th of October First', 'أول 6 أكتوبر', 'Giza', aliases: ['6th of October', '6 October', 'السادس من أكتوبر']),
  _city('Sheikh Zayed', 'الشيخ زايد', 'Giza', aliases: ['Shaykh Zayid']),
  _city('Port Fuad Second', 'بورفؤاد ثان', 'Port Said', aliases: ['Port Fouad']),
];

List<String> _search(String query, {bool arabic = false, List<Map<String, dynamic>>? cities}) =>
    CitySearchIndex.of(cities ?? _catalog).search(query, arabic: arabic).map((c) => c['nameEnglish'] as String).toList();

void main() {
  group('normalizeCitySearch', () {
    test('matches the backend rules', () {
      expect(normalizeCitySearch('  Sidi   GABER '), 'sidi gaber');
      expect(normalizeCitySearch('الإسكندرية'), 'اسكندريه');
      expect(normalizeCitySearch('اسكندرية'), 'اسكندريه');
      expect(normalizeCitySearch('المعادى'), 'معادي');
      expect(normalizeCitySearch('مُعَادِي'), 'معادي');
      expect(normalizeCitySearch('مدينــة نصر'), 'مدينه نصر');
      expect(normalizeCitySearch('مؤسسة'), 'موسسه');
      expect(normalizeCitySearch('El-Maadi'), 'maadi');
      expect(normalizeCitySearch('Al Maadi'), 'maadi');
      expect(normalizeCitySearch("Ra's El-Bar"), 'ras elbar');
      expect(normalizeCitySearch('Port Fuad’s'), 'port fuads');
    });
  });

  group('the handoff test table', () {
    final cases = <String, String>{
      'sidi gaber': 'Sidi Gaber',
      'sidi gabir': 'Sidi Gaber',
      'mohandiseen': 'Mohandessin',
      'maadi': 'Al Maadi',
      'المعادى': 'Al Maadi',
      'مدينه نصر': 'Nasr City',
      '6 october': '6th of October First',
      '6th of october': '6th of October First',
      'zayed': 'Sheikh Zayed',
      'smouha': 'Smouha',
      'سموحه': 'Smouha',
      'port fouad': 'Port Fuad Second',
    };
    cases.forEach((query, expected) {
      test('"$query" finds $expected', () => expect(_search(query), contains(expected)));
    });

    test('"اسكندرية" finds every City in Alexandria', () {
      expect(_search('اسكندرية'), unorderedEquals(['Sidi Gaber', 'Smouha', 'Labban']));
    });

    test('a Neighbourhood is found through its district', () {
      expect(_search('gaber'), ['Sidi Gaber', 'Smouha']);
    });
  });

  group('result order', () {
    final cities = [
      _city('Old Nasr', 'نصر القديمة', 'Cairo'),
      _city('Tagamoa', 'التجمع', 'Cairo', aliases: ['Nasr Extension']),
      _city('Nasr Gardens', 'حدائق نصر', 'Cairo'),
      _city('Abbas Nasr', 'عباس نصر', 'Cairo'),
      _city('Nasr City', 'مدينة نصر', 'Cairo'),
    ];

    test('starts-with, then contains, then other fields; alphabetical in each', () {
      expect(_search('nasr', cities: cities), ['Nasr City', 'Nasr Gardens', 'Abbas Nasr', 'Old Nasr', 'Tagamoa']);
    });

    test('in Arabic, names are ranked and sorted by their Arabic form', () {
      // "نصر" starts "نصر القديمة"; it is inside the other three names.
      expect(_search('نصر', arabic: true, cities: cities), ['Old Nasr', 'Nasr Gardens', 'Abbas Nasr', 'Nasr City']);
    });

    test('an empty query keeps the list as the server sorted it', () {
      expect(_search('  ', cities: cities), cities.map((c) => c['nameEnglish']).toList());
    });
  });

  // Cases from the backend's test run on the real 3,140-City list, where the
  // right place matched but ranked below smaller places with similar names.
  group('ranking on the real list', () {
    List<String> places(String query, List<Map<String, dynamic>> cities, {bool arabic = false}) => CitySearchIndex.of(
      cities,
    ).search(query, arabic: arabic).map((c) => '${c['nameEnglish']} · ${c['governorate']}').toList();

    test('"Maadi" lists the Maadi district before Neighbourhoods of the same name', () {
      final cities = [
        _city('Al Maadi', 'المعادي', 'Matrouh', district: _in('Marsa Matrouh', 'مرسى مطروح')),
        _city('El Maadi', 'المعادي', 'Giza', district: _in('Imbaba', 'إمبابة')),
        _city('Maadi', 'المعادي', 'Cairo'),
        _city('Maadi Degla', 'دجلة المعادي', 'Cairo', district: _in('Maadi', 'المعادي')),
      ];
      expect(places('Maadi', cities).first, 'Maadi · Cairo');
      expect(places('المعادي', cities, arabic: true).first, 'Maadi · Cairo');
    });

    test('"المنتزه" lists the Montaza district first', () {
      final cities = [
        _city('El Montaza', 'المنتزه', 'Giza', district: _in('Haram', 'الهرم')),
        _city('Al Montazah', 'المنتزه', 'Cairo', district: _in('Zeitoun', 'الزيتون')),
        _city('Montaza', 'المنتزه', 'Alexandria'),
      ];
      expect(places('المنتزه', cities, arabic: true).first, 'Montaza · Alexandria');
    });

    test('an exact alias beats names that merely contain the query', () {
      final cities = [
        _city('Hadayek El Mohandiseen', 'حدائق المهندسين', 'Giza', district: _in('Sheikh Zayed', 'الشيخ زايد')),
        _city('El Mohandesin Gardens', 'حدائق المهندسين', 'Giza', district: _in('Haram', 'الهرم')),
        _city('Mohandessin', 'المهندسين', 'Giza', aliases: ['Mohandiseen', 'Mohandseen']),
      ];
      expect(places('mohandiseen', cities).first, 'Mohandessin · Giza');
    });

    test('"6 اكتوبر" lists the 6th of October district before small places named "6 أكتوبر"', () {
      final cities = [
        _city('6 October', '6 أكتوبر', 'Sharkia', district: _in('Zagazig', 'الزقازيق')),
        _city('6 October', '6 أكتوبر', 'Menoufia', district: _in('Shebin', 'شبين الكوم')),
        _city('6th of October First', 'أول 6 أكتوبر', 'Giza', aliases: ['6th of October', '6 أكتوبر']),
      ];
      expect(places('6 اكتوبر', cities, arabic: true).first, '6th of October First · Giza');
    });

    test("a governorate's name lists that governorate's Cities first", () {
      final cities = [
        _city('Alexandria 1000 — Salam', 'الإسكندرية 1000 - السلام', 'Cairo', district: _in('Salam', 'السلام')),
        _city('Smouha', 'سموحة', 'Alexandria', district: _in('Sidi Gaber', 'سيدي جابر'), governorateArabic: 'الإسكندرية'),
        _city('Sidi Gaber', 'سيدي جابر', 'Alexandria', governorateArabic: 'الإسكندرية'),
      ];
      expect(places('alexandria', cities), ['Sidi Gaber · Alexandria', 'Smouha · Alexandria', 'Alexandria 1000 — Salam · Cairo']);
      expect(places('اسكندرية', cities, arabic: true).take(2), ['Sidi Gaber · Alexandria', 'Smouha · Alexandria']);
    });
  });

  test('the Arabic governorate comes from the server when it sends one', () {
    final city = _city('Luxor', 'الأقصر', 'Luxor', governorateArabic: 'محافظة الأقصر');
    expect(cityGovernorateName(city, arabic: true), 'محافظة الأقصر');
    expect(citySubtitle(city, arabic: true), 'محافظة الأقصر');
    expect(cityGovernorateName(city, arabic: false), 'Luxor');
    expect(_search('محافظه الاقصر', cities: [city]), ['Luxor']);
  });

  test('a list is indexed once and reused', () {
    expect(identical(CitySearchIndex.of(_catalog), CitySearchIndex.of(_catalog)), isTrue);
  });

  test('works on a server that sends no aliases or district', () {
    final legacy = [
      {'id': '1', 'nameEnglish': 'Al Maadi', 'nameArabic': 'المعادي', 'governorate': 'Cairo'},
    ];
    expect(_search('maadi', cities: legacy), ['Al Maadi']);
    expect(_search('القاهره', cities: legacy), ['Al Maadi']);
    expect(citySubtitle(legacy.first, arabic: false), 'Cairo');
  });

  group('subtitle', () {
    test("shows a Neighbourhood's district, then the governorate", () {
      expect(citySubtitle(_catalog[1], arabic: false), 'Sidi Gaber · Alexandria');
      expect(citySubtitle(_catalog[1], arabic: true), 'قسم سيدي جابر · الإسكندرية');
    });

    test('shows only the governorate for an official district', () {
      expect(citySubtitle(_sidiGaber, arabic: false), 'Alexandria');
      expect(citySubtitle(_sidiGaber, arabic: true), 'الإسكندرية');
    });

    test('falls back to the English governorate when the Arabic name is unknown', () {
      expect(governorateName('Atlantis', arabic: true), 'Atlantis');
    });
  });

  test('every governorate the server uses has an Arabic name', () {
    expect(governorateArabicNames.length, 27);
  });
}
