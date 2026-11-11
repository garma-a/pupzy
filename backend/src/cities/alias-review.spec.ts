import { reviewCityAliases } from './alias-review';
import { loadRawSnapshot, transformCatalog } from './catalog';

it('removes joined administrative labels, accented/comma aliases and another City on a district', () => {
  const seed = transformCatalog(loadRawSnapshot()).records[0];
  const district = {
    ...seed,
    sourceCode: 'EG0203',
    nameEnglish: 'Sidi Gaber',
    nameArabic: 'سيدي جابر',
    sourceNameEnglish: 'Sidi Gabir',
    sourceNameArabic: 'قسم سيدى جابر',
    aliases: [
      'قسم سيدى جابر',
      'Sidi Gabir',
      'Al Ibrahimeya Bahary',
      'الإبراهيمية بحري',
      'Ibrahimia Bahary and Sidi Gabir',
      'شياخة الابراهيميةبحريوسيديجابر',
      'Port Fouâd, Port Fouad',
      'Foua\u0302d',
    ],
  };
  const area = {
    ...seed,
    sourceCode: 'PUPZY:ibrahimia',
    nameEnglish: 'Ibrahimia',
    nameArabic: 'الإبراهيمية',
    aliases: [],
  };
  const removed = reviewCityAliases([district, area]);
  expect(district.aliases).toEqual(['قسم سيدى جابر', 'Sidi Gabir']);
  expect(removed).toHaveLength(6);
});
