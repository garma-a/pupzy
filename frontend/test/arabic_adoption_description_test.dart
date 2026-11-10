import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/utils/arabic_adoption_description.dart';

void main() {
  group('arabicAdoptionDescription', () {
    test('a female cat with breed and age', () {
      expect(
        arabicAdoptionDescription(petName: 'لونا', species: 'CAT', gender: 'FEMALE', breed: 'شيرازي', age: (2, 'MONTHS')),
        'لونا قطة من سلالة شيرازي، عمرها شهران، تبحث عن منزل محب.',
      );
    });

    test('a male dog with breed and age', () {
      expect(
        arabicAdoptionDescription(petName: 'ماكس', species: 'DOG', gender: 'MALE', breed: 'جيرمن شيبرد', age: (3, 'YEARS')),
        'ماكس كلب ذكر من سلالة جيرمن شيبرد، عمره 3 سنوات، يبحث عن منزل محب.',
      );
    });

    test('no breed and no age', () {
      expect(arabicAdoptionDescription(petName: 'لونا', species: 'CAT', gender: 'FEMALE'), 'لونا قطة تبحث عن منزل محب.');
      expect(arabicAdoptionDescription(petName: 'Rex', species: 'DOG', gender: 'MALE'), 'Rex كلب ذكر يبحث عن منزل محب.');
    });

    test('birds and other animals say their gender', () {
      expect(arabicAdoptionDescription(petName: 'كوكو', species: 'BIRD', gender: 'FEMALE'), 'كوكو طائر أنثى تبحث عن منزل محب.');
      expect(arabicAdoptionDescription(petName: 'بندق', species: 'OTHER', gender: 'MALE'), 'بندق حيوان ذكر يبحث عن منزل محب.');
    });

    test('age without breed', () {
      expect(
        arabicAdoptionDescription(petName: 'ميشو', species: 'CAT', gender: 'MALE', age: (1, 'YEARS')),
        'ميشو قط ذكر، عمره سنة واحدة، يبحث عن منزل محب.',
      );
    });

    test('is long enough for the backend (at least 10 characters)', () {
      expect(arabicAdoptionDescription(petName: 'ا', species: 'CAT', gender: 'FEMALE').trim().length, greaterThanOrEqualTo(10));
    });
  });

  group('arabicAge', () {
    test('uses the right noun form for the number', () {
      expect(arabicAge(1, 'DAYS'), 'يوم واحد');
      expect(arabicAge(2, 'DAYS'), 'يومان');
      expect(arabicAge(5, 'DAYS'), '5 أيام');
      expect(arabicAge(15, 'DAYS'), '15 يومًا');
      expect(arabicAge(1, 'WEEKS'), 'أسبوع واحد');
      expect(arabicAge(2, 'WEEKS'), 'أسبوعان');
      expect(arabicAge(6, 'WEEKS'), '6 أسابيع');
      expect(arabicAge(1, 'MONTHS'), 'شهر واحد');
      expect(arabicAge(2, 'MONTHS'), 'شهران');
      expect(arabicAge(10, 'MONTHS'), '10 أشهر');
      expect(arabicAge(11, 'MONTHS'), '11 شهرًا');
      expect(arabicAge(1, 'YEARS'), 'سنة واحدة');
      expect(arabicAge(2, 'YEARS'), 'سنتان');
      expect(arabicAge(7, 'YEARS'), '7 سنوات');
      expect(arabicAge(12, 'YEARS'), '12 سنة');
      expect(arabicAge(100, 'MONTHS'), '100 شهر');
      expect(arabicAge(103, 'DAYS'), '103 أيام');
    });
  });
}
