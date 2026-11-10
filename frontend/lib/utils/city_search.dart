/// City search for the picker: spelling-tolerant matching over names,
/// governorates, alternative spellings (aliases) and the official district a
/// Neighbourhood belongs to.
library;

/// Puts a search query or a stored name into the form both are compared in.
///
/// Mirrors the backend's `normalizeCitySearch` (backend/src/cities/search.ts)
/// step for step, including the order the leading articles are removed in, so
/// the app and the server agree on what matches.
String normalizeCitySearch(String value) {
  return value
      .trim()
      .toLowerCase()
      .replaceAll(_arabicMarks, '')
      .replaceAll(_alefForms, 'ا')
      .replaceAll('ة', 'ه')
      .replaceAll(_yehForms, 'ي')
      .replaceAll('ؤ', 'و')
      .replaceFirst(_latinArticle, '')
      .replaceAll(_joiners, '')
      .replaceAll(_spaces, ' ')
      .replaceFirst(_arabicArticle, '')
      .trim();
}

// Diacritics, Quranic marks and tatweel.
final _arabicMarks = RegExp('[ؐ-ًؚ-ٰٟۖ-ۭـ]');
final _alefForms = RegExp('[أإآٱ]');
final _yehForms = RegExp('[ىئ]');
final _latinArticle = RegExp(r'^(?:el|al)[ -]+');
final _joiners = RegExp('[-\'’]');
final _spaces = RegExp(r'\s+');
final _arabicArticle = RegExp('^ال');

/// Arabic names of the governorates, keyed by the English name the server
/// sends in `City.governorate`. The API has no Arabic governorate field, so
/// the app keeps its own copy of these 27 names.
const Map<String, String> governorateArabicNames = {
  'Alexandria': 'الإسكندرية',
  'Assiut': 'أسيوط',
  'Aswan': 'أسوان',
  'Behera': 'البحيرة',
  'Beni Suef': 'بني سويف',
  'Cairo': 'القاهرة',
  'Dakahlia': 'الدقهلية',
  'Damietta': 'دمياط',
  'Fayoum': 'الفيوم',
  'Gharbia': 'الغربية',
  'Giza': 'الجيزة',
  'Ismailia': 'الإسماعيلية',
  'Kafr El-Shikh': 'كفر الشيخ',
  'Kalyoubia': 'القليوبية',
  'Luxor': 'الأقصر',
  'Matrouh': 'مطروح',
  'Menia': 'المنيا',
  'Menoufia': 'المنوفية',
  'New Valley': 'الوادي الجديد',
  'North Sinai': 'شمال سيناء',
  'Port Said': 'بورسعيد',
  'Qena': 'قنا',
  'Red Sea': 'البحر الأحمر',
  'Sharkia': 'الشرقية',
  'South Sinai': 'جنوب سيناء',
  'Suez': 'السويس',
  'Suhag': 'سوهاج',
};

/// The governorate's name to show: Arabic when [arabic] and the name is known,
/// otherwise the English name the server sent.
String governorateName(String governorate, {required bool arabic}) =>
    arabic ? governorateArabicNames[governorate] ?? governorate : governorate;

/// The picker's second line for a City: "Sidi Gaber · Alexandria" for a
/// Neighbourhood (its district, then the governorate), or just the
/// governorate for an official district.
String citySubtitle(Map<String, dynamic> city, {required bool arabic}) {
  final governorate = governorateName(city['governorate'] as String? ?? '', arabic: arabic);
  final district = city['district'] as Map<String, dynamic>?;
  if (district == null) return governorate;
  final districtName = (arabic ? district['nameArabic'] : district['nameEnglish']) as String? ?? '';
  return districtName.isEmpty ? governorate : '$districtName · $governorate';
}

/// A City list prepared for searching. Every City's searchable text is
/// normalized once, when the index is first built for a list; searches only
/// compare strings.
class CitySearchIndex {
  CitySearchIndex._(this._cities, this._entries);

  final List<Map<String, dynamic>> _cities;
  final List<_SearchableCity> _entries;

  static final _indexes = Expando<CitySearchIndex>();

  /// The index for [cities], built on first use and kept for as long as the
  /// list itself, so a list shared across pickers is normalized only once.
  factory CitySearchIndex.of(List<Map<String, dynamic>> cities) =>
      _indexes[cities] ??= CitySearchIndex._(cities, [for (final city in cities) _SearchableCity(city)]);

  /// Cities matching [query], best first: names that start with it, then
  /// names that contain it, then Cities found only through another field
  /// (an alias, the governorate or the district). Alphabetical within each
  /// group, by the name shown in the current language. An empty query
  /// returns the whole list in its original order.
  List<Map<String, dynamic>> search(String query, {required bool arabic}) {
    final needle = normalizeCitySearch(query);
    if (needle.isEmpty) return _cities;

    final groups = [<_SearchableCity>[], <_SearchableCity>[], <_SearchableCity>[]];
    for (final entry in _entries) {
      final rank = entry.rank(needle);
      if (rank != null) groups[rank].add(entry);
    }
    return [for (final group in groups) ...(group..sort((a, b) => a.sortKey(arabic).compareTo(b.sortKey(arabic)))).map((e) => e.city)];
  }
}

class _SearchableCity {
  _SearchableCity(this.city)
    : englishName = normalizeCitySearch(city['nameEnglish'] as String? ?? ''),
      arabicName = normalizeCitySearch(city['nameArabic'] as String? ?? ''),
      others = [
        for (final value in _otherSearchText(city))
          if (value.isNotEmpty) normalizeCitySearch(value),
      ];

  final Map<String, dynamic> city;
  final String englishName;
  final String arabicName;

  /// Normalized governorate (both languages), aliases and district names.
  final List<String> others;

  static Iterable<String> _otherSearchText(Map<String, dynamic> city) sync* {
    final governorate = city['governorate'] as String? ?? '';
    yield governorate;
    yield governorateArabicNames[governorate] ?? '';
    final aliases = city['aliases'] as List<dynamic>?;
    if (aliases != null) yield* aliases.whereType<String>();
    final district = city['district'] as Map<String, dynamic>?;
    if (district != null) {
      yield district['nameEnglish'] as String? ?? '';
      yield district['nameArabic'] as String? ?? '';
    }
  }

  String sortKey(bool arabic) => arabic ? arabicName : englishName;

  /// 0 when a name starts with [needle], 1 when a name contains it, 2 when
  /// only another field does, null when nothing matches.
  int? rank(String needle) {
    if (englishName.startsWith(needle) || arabicName.startsWith(needle)) return 0;
    if (englishName.contains(needle) || arabicName.contains(needle)) return 1;
    if (others.any((value) => value.contains(needle))) return 2;
    return null;
  }
}
