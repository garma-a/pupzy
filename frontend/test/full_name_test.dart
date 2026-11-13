import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/utils/full_name.dart';

void main() {
  group('checkFullName accepts', () {
    for (final name in [
      'Aya Abdelnasser',
      'Mohamed Al-Sayed',
      "Shane O'Neil",
      'آية عبد الناصر',
      'محمد السيد',
      'عبد الله',
      'مُحَمَّد علي', // diacritics
      'Mary Ann Smith',
      '  Aya   Nasser  ', // extra spaces are collapsed
    ]) {
      test(name, () => expect(checkFullName(name), isNull));
    }
  });

  group('checkFullName rejects', () {
    final cases = {
      '': FullNameProblem.empty,
      '   ': FullNameProblem.empty,
      'Aya': FullNameProblem.needsTwoParts,
      'آية': FullNameProblem.needsTwoParts,
      'Ay-a  A': FullNameProblem.partTooShort, // the tester's SIGNUP-003 example
      'Aya N': FullNameProblem.partTooShort,
      'أ محمد': FullNameProblem.partTooShort,
      'Aya 2nd': FullNameProblem.hasDigits,
      'آية ٢': FullNameProblem.hasDigits, // Arabic-Indic digit
      'Aya @Nasser': FullNameProblem.hasSymbols,
      'Aya_Nasser Ali': FullNameProblem.hasSymbols,
      'Aya. Nasser': FullNameProblem.hasSymbols,
      '-Aya Nasser': FullNameProblem.hasSymbols,
      'Aya- Nasser': FullNameProblem.hasSymbols,
      'Al--Sayed Aya': FullNameProblem.hasSymbols,
      'Aya - Nasser': FullNameProblem.hasSymbols,
    };
    cases.forEach((name, problem) {
      test('"$name" → ${problem.name}', () => expect(checkFullName(name), problem));
    });

    test('over 120 characters', () {
      expect(checkFullName('${'a' * 60} ${'b' * 60}'), FullNameProblem.tooLong);
    });
  });

  test('normalizeFullName trims and collapses spaces', () {
    expect(normalizeFullName('  Aya   Abdel  Nasser '), 'Aya Abdel Nasser');
  });
}
