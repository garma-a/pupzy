import { reviewCityAliases } from './alias-review';
import { loadOfficialCatalog, loadRawSnapshot, transformCatalog } from './catalog';
import { normalizeCitySearch } from './search';

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

it('rejects another City shorthand on qualified places across governorates after alias generation', () => {
  const seed = transformCatalog(loadRawSnapshot()).records[0];
  const mohandessin = {
    ...seed,
    sourceCode: 'main',
    nameEnglish: 'Mohandessin',
    nameArabic: 'المهندسين',
    aliases: ['Mohandiseen', 'Mohandeseen', 'مهندسين'],
  };
  const qualified = {
    ...seed,
    sourceCode: 'estate',
    governorateCode: 'EG13',
    nameEnglish: 'Hadaek Al Mouhandesin',
    nameArabic: 'حدائق المهندسين',
    sourceNameEnglish: 'Hadaek Al Mouhandesin Housing',
    aliases: ['Mohandiseen', 'Mohandeseen', 'مهندسين', 'Hadayek El Mohandessin'],
  };
  const removed = reviewCityAliases([mohandessin, qualified]);
  expect(qualified.aliases).toEqual(['Hadayek El Mohandessin']);
  expect(removed.map((r) => r.reason)).toEqual(Array(3).fill('other City sub-phrase'));
  expect(reviewCityAliases([mohandessin, qualified])).toEqual([]);
});

it('uses whole phrases and retains shorthand without a competing City', () => {
  const seed = transformCatalog(loadRawSnapshot()).records[0];
  const row = {
    ...seed,
    sourceCode: 'estate',
    nameEnglish: 'Spring Gardens',
    nameArabic: 'حدائق الربيع',
    aliases: ['Spring', 'Gardens', 'Ring'],
  };
  expect(reviewCityAliases([row])).toEqual([]);
  expect(row.aliases).toHaveLength(3);
});

it('keeps the published Flutter picker regressions resolved', () => {
  const rows = loadOfficialCatalog().records;
  const borrowed = new Set(['Mohandiseen', 'Mohandeseen', 'Mohandessin', 'مهندسين'].map(normalizeCitySearch));
  for (const code of ['OSM:node/2736303861', 'OSM:way/64503891', 'OSM:way/699460066', 'OSM:way/776025685']) {
    const row = rows.find((r) => r.sourceCode === code)!;
    expect(row.aliases?.filter((a) => borrowed.has(normalizeCitySearch(a)))).toEqual([]);
  }
  expect(rows.find((r) => r.nameEnglish === 'Bolkly')?.aliases).not.toContain('Mostafa Kamel');
  expect(rows.find((r) => r.sourceCode === 'OSM:way/701134774')?.nameArabic).toBe('الطوب الرملي');
  expect(rows.find((r) => r.sourceCode === 'OSM:way/699691941')?.nameArabic).toBe('التعاونيات');
  expect(rows.find((r) => r.nameEnglish === 'Mokattam')?.aliases).toEqual(
    expect.arrayContaining(['Moqattam', 'Mokatam', 'Moqatam']),
  );
  expect(
    rows
      .flatMap((r) => r.aliases ?? [])
      .filter((a) =>
        /Offeecers|Caeero|Nateeonal|Paradeese|Alexandreea|Neele|Spreeng|\bStil\b|\bEeron\b|Maadee/i.test(a),
      ),
  ).toEqual([]);
});
