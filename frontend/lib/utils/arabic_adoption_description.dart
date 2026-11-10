/// The description the app writes for an adoption post in Arabic, which the
/// adoption form has no field for. It agrees with the pet's gender and uses
/// the Arabic number forms for the age, e.g.
/// "لونا قطة من سلالة شيرازي، عمرها شهران، تبحث عن منزل محب."
///
/// [species] and [gender] are the backend values (`DOG`, `FEMALE`, ...), and
/// [age] is what `parseAge` returns: (value, `DAYS`/`WEEKS`/`MONTHS`/`YEARS`).
String arabicAdoptionDescription({
  required String petName,
  required String species,
  required String gender,
  String breed = '',
  (int, String)? age,
}) {
  final female = gender == 'FEMALE';
  final sentence = StringBuffer('$petName ${_animal(species, female)}');
  if (breed.isNotEmpty) sentence.write(' من سلالة $breed');
  if (age != null) sentence.write('، ${female ? 'عمرها' : 'عمره'} ${arabicAge(age.$1, age.$2)}،');
  sentence.write(' ${female ? 'تبحث' : 'يبحث'} عن منزل محب.');
  return sentence.toString();
}

/// "قطة", "كلب ذكر", "طائر أنثى", ...
String _animal(String species, bool female) {
  switch (species) {
    case 'DOG':
      return female ? 'كلبة' : 'كلب ذكر';
    case 'CAT':
      return female ? 'قطة' : 'قط ذكر';
    case 'BIRD':
      return female ? 'طائر أنثى' : 'طائر ذكر';
    default:
      return female ? 'حيوان أنثى' : 'حيوان ذكر';
  }
}

/// An age in Arabic with the right noun form for the number: "شهر واحد",
/// "شهران", "3 أشهر", "11 شهرًا", "100 شهر".
String arabicAge(int value, String unit) {
  final forms = _ageForms[unit] ?? _ageForms['YEARS']!;
  if (value == 1) return forms.one;
  if (value == 2) return forms.two;
  final lastTwo = value % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return '$value ${forms.few}';
  if (lastTwo >= 11) return '$value ${forms.many}';
  return '$value ${forms.hundreds}';
}

typedef _AgeForms = ({String one, String two, String few, String many, String hundreds});

const Map<String, _AgeForms> _ageForms = {
  'DAYS': (one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', hundreds: 'يوم'),
  'WEEKS': (one: 'أسبوع واحد', two: 'أسبوعان', few: 'أسابيع', many: 'أسبوعًا', hundreds: 'أسبوع'),
  'MONTHS': (one: 'شهر واحد', two: 'شهران', few: 'أشهر', many: 'شهرًا', hundreds: 'شهر'),
  'YEARS': (one: 'سنة واحدة', two: 'سنتان', few: 'سنوات', many: 'سنة', hundreds: 'سنة'),
};
