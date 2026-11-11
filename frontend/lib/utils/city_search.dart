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
/// sends in `City.governorate`. Servers from the Neighbourhood release send
/// `City.governorateArabic`, which wins; this copy covers older servers.
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

/// A City's governorate in the shown language: the server's
/// `governorateArabic` when it sends one, else the built-in name.
String cityGovernorateName(Map<String, dynamic> city, {required bool arabic}) {
  final governorate = city['governorate'] as String? ?? '';
  if (!arabic) return governorate;
  final fromServer = city['governorateArabic'] as String?;
  return fromServer != null && fromServer.isNotEmpty ? fromServer : governorateName(governorate, arabic: true);
}

/// The picker's second line for a City: "Sidi Gaber · Alexandria" for a
/// Neighbourhood (its district, then the governorate), or just the
/// governorate for an official district.
String citySubtitle(Map<String, dynamic> city, {required bool arabic}) {
  final governorate = cityGovernorateName(city, arabic: arabic);
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
      _indexes[cities] ??= CitySearchIndex._(cities, [for (var i = 0; i < cities.length; i++) _SearchableCity(cities[i], i)]);

  /// Cities matching [query], best first. An empty query returns the whole
  /// list in its original order.
  ///
  /// When the query is a governorate's name ("alexandria", "اسكندرية"), that
  /// governorate's Cities come first. Then, by how the City matched:
  ///  0. the query is its name or one of its aliases;
  ///  1. its name starts with the query;
  ///  2. its name contains the query;
  ///  3. an alias contains the query;
  ///  4. its governorate or district does.
  /// Within each group official districts come before Neighbourhoods, so
  /// "Maadi" lists the Maadi district before small places of the same name,
  /// then alphabetical by the name shown in the current language.
  List<Map<String, dynamic>> search(String query, {required bool arabic}) {
    final needle = normalizeCitySearch(query);
    if (needle.isEmpty) return _cities;

    final matches = <({_SearchableCity entry, bool inGovernorate, int rank})>[];
    for (final entry in _entries) {
      final rank = entry.rank(needle);
      if (rank != null) matches.add((entry: entry, inGovernorate: entry.governorates.contains(needle), rank: rank));
    }
    matches.sort((a, b) {
      if (a.inGovernorate != b.inGovernorate) return a.inGovernorate ? -1 : 1;
      if (a.rank != b.rank) return a.rank - b.rank;
      if (a.entry.isNeighbourhood != b.entry.isNeighbourhood) return a.entry.isNeighbourhood ? 1 : -1;
      final byName = a.entry.sortKey(arabic).compareTo(b.entry.sortKey(arabic));
      return byName != 0 ? byName : a.entry.index - b.entry.index;
    });
    return [for (final match in matches) match.entry.city];
  }
}

class _SearchableCity {
  _SearchableCity(this.city, this.index)
    : englishName = normalizeCitySearch(city['nameEnglish'] as String? ?? ''),
      arabicName = normalizeCitySearch(city['nameArabic'] as String? ?? ''),
      aliases = _normalized((city['aliases'] as List<dynamic>?)?.whereType<String>() ?? const []),
      governorates = _normalized([
        city['governorate'] as String? ?? '',
        city['governorateArabic'] as String? ?? '',
        governorateArabicNames[city['governorate']] ?? '',
      ]),
      districtNames = _normalized([
        (city['district'] as Map<String, dynamic>?)?['nameEnglish'] as String? ?? '',
        (city['district'] as Map<String, dynamic>?)?['nameArabic'] as String? ?? '',
      ]),
      isNeighbourhood = city['district'] != null;

  final Map<String, dynamic> city;

  /// Position in the server's list, the last tie-breaker (sorting isn't stable).
  final int index;
  final String englishName;
  final String arabicName;
  final List<String> aliases;
  final List<String> governorates;
  final List<String> districtNames;

  /// A Neighbourhood belongs to a district; an official district does not.
  final bool isNeighbourhood;

  static List<String> _normalized(Iterable<String> values) => [
    for (final value in values)
      if (value.isNotEmpty) normalizeCitySearch(value),
  ];

  String sortKey(bool arabic) => arabic ? arabicName : englishName;

  /// The match group for [needle] (see [CitySearchIndex.search]), or null
  /// when nothing matches.
  int? rank(String needle) {
    if (englishName == needle || arabicName == needle || aliases.contains(needle)) return 0;
    if (englishName.startsWith(needle) || arabicName.startsWith(needle)) return 1;
    if (englishName.contains(needle) || arabicName.contains(needle)) return 2;
    if (aliases.any((alias) => alias.contains(needle))) return 3;
    if (governorates.any((name) => name.contains(needle)) || districtNames.any((name) => name.contains(needle))) return 4;
    return null;
  }
}
