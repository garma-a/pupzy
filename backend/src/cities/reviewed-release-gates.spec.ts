import { loadRawSnapshot, transformCatalog, type CityCatalogRecord } from './catalog';
import { verifyCoverage, type GpsChecks, type IndependentNames } from './coverage';
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
