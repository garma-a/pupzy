import { shouldFlagContent } from './moderation.util';

describe('shouldFlagContent (Moderation Utility)', () => {
  it('returns false for legitimate animal rescue / adoption posts', () => {
    expect(shouldFlagContent('Injured stray puppy in Maadi', 'Found near street 9, needs vet care.')).toBe(false);
    expect(shouldFlagContent('قطة تحتاج تبني', 'قطة شيرازي عمرها سنة متطعمة')).toBe(false);
  });

  it('returns true for posts mentioning vehicles', () => {
    expect(shouldFlagContent('سيارة للبيع', 'موديل 2022 بحالة ممتازة')).toBe(true);
    expect(shouldFlagContent('موتوسيكل دايون', 'مستعمل')).toBe(true);
  });

  it('returns true for posts mentioning real estate', () => {
    expect(shouldFlagContent('شقة للايجار', 'في التجمع الخامس')).toBe(true);
    expect(shouldFlagContent('Apartment for rent', '3 bedrooms furnished')).toBe(true);
    expect(shouldFlagContent('Land for sale in Cairo', 'Prime location')).toBe(true);
  });

  it('returns true for posts mentioning electronics', () => {
    expect(shouldFlagContent('iPhone 15 Pro Max', 'Brand new in box')).toBe(true);
    expect(shouldFlagContent('موبايل سامسونج', 'للبيع بسعر مغري')).toBe(true);
    expect(shouldFlagContent('Playstation 5', 'With 2 controllers')).toBe(true);
  });

  it('returns true for spam, casino, cryptocurrency', () => {
    expect(shouldFlagContent('Online Casino Free Bonus', 'Win big today')).toBe(true);
    expect(shouldFlagContent('Cryptocurrency trading bot', 'Earn money fast')).toBe(true);
    expect(shouldFlagContent('اربح فلوس من البيت', 'سجل الآن')).toBe(true);
  });
});
