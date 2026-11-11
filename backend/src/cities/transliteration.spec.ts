import { englishAliasCandidates, addReviewedTransliterations } from './transliteration';
import { loadRawSnapshot, transformCatalog } from './catalog';
const root = transformCatalog(loadRawSnapshot()).records[0];

describe('Reviewed Egyptian transliteration alternatives', () => {
  it('covers fixed Egyptian word and spelling families', () => {
    expect(englishAliasCandidates('El Sheikh Sidi Abu Ezbet Kafr')).toEqual(
      expect.arrayContaining([
        'Sheikh Sidi Abu Ezbet Kafr',
        'Al Sheikh Sidi Abu Ezbet Kafr',
        'El Shaikh Sidi Abu Ezbet Kafr',
        'El Shikh Sidi Abu Ezbet Kafr',
        'El Sheikh Seedy Abu Ezbet Kafr',
        'El Sheikh Sidi Abo Ezbet Kafr',
        'El Sheikh Sidi Abu Ezbit Kafr',
      ]),
    );
    for (const [source, alternate] of [
      ['Qalyub', 'Qalyoub'],
      ['Mansoureya', 'Mansouria'],
      ['Mohandessin', 'Mohandesin'],
    ])
      expect(englishAliasCandidates(source)).toContain(alternate);
    expect(englishAliasCandidates('New Alamein')).not.toContain('New Allamein');
    expect(englishAliasCandidates('New Alamein').every((alias) => !/([a-z])\1\1/i.test(alias))).toBe(true);
  });
  it('caps generated aliases, deduplicates, and excludes another City canonical name', () => {
    const city = {
      ...root,
      sourceCode: 'PUPZY:test',
      nameEnglish: 'Maadi',
      sourceNameEnglish: 'Maadi',
      nameArabic: 'المعادي',
      districtSourceCode: root.sourceCode,
      aliases: [],
    };
    const other = { ...city, sourceCode: 'PUPZY:other', nameEnglish: 'Al Maadi', nameArabic: 'كليوب' };
    const review = {
      reviewed: true,
      ruleVersion: 'egyptian-transliteration-v1' as const,
      maxPerRow: 3,
      districtSourceCodes: [root.sourceCode],
    };
    const stats = addReviewedTransliterations([city, other], review);
    expect(city.aliases).not.toContain('Al Maadi');
    expect(city.aliases.length).toBeLessThanOrEqual(3);
    expect(new Set(city.aliases).size).toBe(city.aliases.length);
    expect(stats.collisionsExcluded).toBeGreaterThan(0);
  });
  it('keeps English descriptor words intact', () => {
    expect(englishAliasCandidates('District Housing Compound')).toEqual([]);
  });
  it('does not generate Arabic variants or modify uncovered districts', () => {
    expect(englishAliasCandidates('الشيخ زايد')).toEqual([]);
    const row = { ...root, aliases: [] };
    addReviewedTransliterations([row], {
      reviewed: true,
      ruleVersion: 'egyptian-transliteration-v1',
      maxPerRow: 12,
      districtSourceCodes: [],
    });
    expect(row.aliases).toEqual([]);
  });
});

it('adds omitted articles only with Arabic article evidence and handles Izbat spellings', () => {
  expect(englishAliasCandidates('Maadi', true)).toEqual(expect.arrayContaining(['El Maadi', 'Al Maadi']));
  expect(englishAliasCandidates('Maadi')).not.toContain('El Maadi');
  expect(englishAliasCandidates('New Cairo', true)).not.toContain('Al New Cairo');
  expect(englishAliasCandidates('Izbat al Nakhl')).toContain('Ezbet al Nakhl');
});
