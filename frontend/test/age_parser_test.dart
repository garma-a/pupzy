import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/utils/age_parser.dart';

void main() {
  group('English', () {
    test('number with a unit', () {
      expect(parseAge('2 years'), (2, 'YEARS'));
      expect(parseAge('1 year'), (1, 'YEARS'));
      expect(parseAge('6 months'), (6, 'MONTHS'));
      expect(parseAge('3 weeks'), (3, 'WEEKS'));
      expect(parseAge('10 days'), (10, 'DAYS'));
    });

    test('abbreviations', () {
      expect(parseAge('18mo'), (18, 'MONTHS'));
      expect(parseAge('3 yrs'), (3, 'YEARS'));
      expect(parseAge('2 wks'), (2, 'WEEKS'));
    });

    test('a bare number means years', () {
      expect(parseAge('4'), (4, 'YEARS'));
    });

    test('the unit after the number wins in a compound age', () {
      expect(parseAge('1 year 6 months'), (1, 'YEARS'));
    });

    test('"a year" without a number is one year', () {
      expect(parseAge('a year'), (1, 'YEARS'));
    });
  });

  group('Arabic', () {
    // Regression: the forms' own Arabic placeholder is "مثال: سنتان" and used
    // to be unparseable, leaving the Find-a-Mate submit button disabled.
    test('dual forms carry the number in the word', () {
      expect(parseAge('سنتان'), (2, 'YEARS'));
      expect(parseAge('سنتين'), (2, 'YEARS'));
      expect(parseAge('شهرين'), (2, 'MONTHS'));
      expect(parseAge('أسبوعين'), (2, 'WEEKS'));
    });

    // Regression: Arabic keyboards default to Arabic-Indic digits, which `\d`
    // never matched.
    test('Arabic-Indic digits', () {
      expect(parseAge('٣ سنوات'), (3, 'YEARS'));
      expect(parseAge('١٨ شهر'), (18, 'MONTHS'));
      expect(parseAge('۴ سال'), (4, 'YEARS'));
    });

    // Regression: "6 شهور" used to fall through to the default and publish
    // a six-month-old puppy as six years old.
    test('Arabic unit words with Western digits', () {
      expect(parseAge('6 شهور'), (6, 'MONTHS'));
      expect(parseAge('3 أسابيع'), (3, 'WEEKS'));
      expect(parseAge('5 ايام'), (5, 'DAYS'));
      expect(parseAge('2 سنة'), (2, 'YEARS'));
    });

    test('a bare unit word is one', () {
      expect(parseAge('سنة'), (1, 'YEARS'));
      expect(parseAge('شهر'), (1, 'MONTHS'));
    });
  });

  group('rejects', () {
    test('empty, zero and unreadable input', () {
      expect(parseAge(''), isNull);
      expect(parseAge('   '), isNull);
      expect(parseAge('0 years'), isNull);
      expect(parseAge('puppy'), isNull);
    });
  });
}
