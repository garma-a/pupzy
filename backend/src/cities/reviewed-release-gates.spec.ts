import { createHash } from 'crypto';
import { acceptsReviewOnlyCoverage } from './publish';
import { loadRawSnapshot, transformCatalog, type CityCatalogRecord } from './catalog';
import { verifyCoverage, verifyHeadlineNames, type GpsChecks, type IndependentNames } from './coverage';
const city = { ...transformCatalog(loadRawSnapshot()).records[0], governorateCode: 'EG03' };
const empty = { 'greater-cairo': [], alexandria: [], 'port-said-region': [] };
const polygons = { metadata: { reviewed: true, notes: 'Synthetic' }, features: [] };
const check = {
  latitude: city.latitude,
  longitude: city.longitude,
  acceptableSourceCodes: [],
  expectedDistrictSourceCode: city.sourceCode,
  evidence: 'Synthetic',
};
function report(names: IndependentNames, gps: GpsChecks, records: CityCatalogRecord[] = [city]) {
  return verifyCoverage(
    { records, metadata: { declaredOfficialCount: records.length, governorateCount: 1 } },
    polygons,
    polygons,
    polygons,
    names,
    gps,
  );
}
const names: IndependentNames = {
  metadata: {
    reviewed: true,
    method: 'Synthetic',
    minimums: {
      'greater-cairo': { minimum: 150, reviewed: true, decisionDate: '2026-11-10', reason: 'Lead' },
      alexandria: { minimum: 150, reviewed: true, decisionDate: '2026-11-10', reason: 'Lead' },
      'port-said-region': { minimum: 1, reviewed: true, decisionDate: '2026-11-10', reason: 'Lead' },
    },
  },
  areas: { ...empty, 'port-said-region': [{ english: 'Missing Quarter', arabic: 'حي غير مسجل', misspellings: [] }] },
};

describe('Lead-reviewed names and GPS exceptions', () => {
  it('requires exact reviewed research for every unmatched variant', () => {
    const input = structuredClone(names);
    const gps: GpsChecks = { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty };
    expect(report(input, gps).areas[2].names.passed).toBe(false);
    input.knownMissing = {
      metadata: { reviewed: true, decisionDate: '2026-11-10', notes: 'Lead policy' },
      entries: [
        {
          area: 'port-said-region',
          english: 'Missing Quarter',
          arabic: 'حي غير مسجل',
          variants: ['Missing Quarter', 'حي غير مسجل'],
          reviewed: true,
          research: 'Recorded searches inspected; no defensible point.',
          reason: 'Multiple ambiguous proxies.',
          sourceUrls: ['https://example.org/source'],
        },
      ],
    };
    expect(report(input, gps).areas[2].names.passed).toBe(true);
    input.knownMissing.entries[0].variants.pop();
    expect(report(input, gps).areas[2].names.passed).toBe(false);
  });
  it('allows one documented failure among thirty, but never a second', () => {
    const checks = Array.from({ length: 30 }, (_, i) => ({ ...check, latitude: city.latitude + i * 1e-7 }));
    checks[0].expectedDistrictSourceCode = 'EG0306';
    const gps: GpsChecks = {
      metadata: { reviewed: true, notes: 'Synthetic' },
      areas: { ...empty, 'port-said-region': checks },
    };
    expect(report(names, gps).areas[2].gps.passed).toBe(false);
    gps.metadata.decisionDate = '2026-11-10';
    gps.metadata.documentedFailures = [
      {
        area: 'port-said-region',
        latitude: checks[0].latitude,
        longitude: checks[0].longitude,
        actualSourceCode: city.sourceCode,
        expectedDistrictSourceCode: 'EG0306',
        reviewed: true,
        research: 'Individual recorded source review.',
        reason: 'Rural fish farms, no named place nearby.',
        sourceUrls: ['https://example.org/fixture'],
      },
    ];
    expect(report(names, gps).areas[2].gps.passed).toBe(true);
    checks[1].expectedDistrictSourceCode = 'EG0306';
    expect(report(names, gps).areas[2].gps.passed).toBe(false);
  });
  it('fails duplicate Arabic display names within a governorate', () => {
    const gps: GpsChecks = { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty };
    const other = { ...city, sourceCode: 'EG0302', nameEnglish: 'Different English' };
    expect(report(names, gps, [city, other]).dataQuality.errors.some((e) => e.includes('Duplicate Arabic'))).toBe(true);
  });
});

it('rejects substring-only checklist matches and never credits a parent/governorate', () => {
  const input = structuredClone(names);
  input.areas['port-said-region'] = [{ english: 'Smouha', arabic: 'سموحة', misspellings: [] }];
  const row = { ...city, nameEnglish: 'Taawoneyat Smouha', nameArabic: 'تعاونيات سموحة', aliases: [] };
  const result = report(input, { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty }, [row]);
  expect(result.areas[2].names.missingNames).toEqual(['Smouha', 'سموحة']);
});

it('requires exactly one literal bilingual headline display, regardless of aliases', () => {
  const row = { ...city, nameEnglish: 'Smouha', nameArabic: 'سموحة' };
  const headlines = { entries: [['Smouha', 'سموحة', city.governorate] as [string, string, string]] };
  expect(verifyHeadlineNames([row], headlines).passed).toBe(true);
  expect(
    verifyHeadlineNames(
      [
        row,
        {
          ...row,
          sourceCode: 'PUPZY:qualified',
          districtSourceCode: city.sourceCode,
          nameEnglish: 'Smouha (District)',
          nameArabic: 'سموحة — الحي',
        },
      ],
      headlines,
    ).passed,
  ).toBe(false);
  expect(
    verifyHeadlineNames([{ ...row, nameEnglish: 'Smouha (Alexandria)', aliases: ['Smouha'] }], headlines).passed,
  ).toBe(false);
  expect(verifyHeadlineNames([row, { ...row, sourceCode: 'PUPZY:duplicate' }], headlines).passed).toBe(false);
});

it('rejects non-ASCII English and synthetic near display labels', () => {
  const row = { ...city, nameEnglish: 'Abū Ghalib near Cairo', nameArabic: 'أبو غالب — قرب القاهرة' };
  const result = report(names, { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty }, [row]);
  expect(result.dataQuality.errors.some((e) => e.includes('ASCII'))).toBe(true);
  expect(result.dataQuality.errors.some((e) => e.includes('near/قرب'))).toBe(true);
  const qualified = report(names, { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty }, [
    { ...city, nameEnglish: 'District (Giza) (Markaz)', nameArabic: 'حي — الجيزة — مركز' },
  ]);
  expect(qualified.dataQuality.errors.some((e) => e.includes('multiple display disambiguators'))).toBe(true);
});

it('binds local review publication to the exact report and never waives display, structure or GPS failures', () => {
  const report = {
    structuralValidation: { isValid: true },
    dataQuality: { passed: true },
    areas: [{ gps: { passed: true } }],
    grid: { passed: false },
  };
  const review = {
    sha256: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    decisionDate: '2026-11-11',
    reason: 'Lead explicitly requested a conservative local unshipped regeneration with reported grid shortfalls.',
  };
  expect(acceptsReviewOnlyCoverage(report)).toBe(false);
  expect(acceptsReviewOnlyCoverage(report, review)).toBe(true);
  expect(acceptsReviewOnlyCoverage({ ...report, dataQuality: { passed: false } }, review)).toBe(false);
  const badDisplay = { ...report, dataQuality: { passed: false } };
  expect(
    acceptsReviewOnlyCoverage(badDisplay, {
      ...review,
      sha256: createHash('sha256').update(JSON.stringify(badDisplay)).digest('hex'),
    }),
  ).toBe(false);
  const badGps = { ...report, areas: [{ gps: { passed: false } }] };
  expect(
    acceptsReviewOnlyCoverage(badGps, {
      ...review,
      sha256: createHash('sha256').update(JSON.stringify(badGps)).digest('hex'),
    }),
  ).toBe(false);
});
