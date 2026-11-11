import { loadRawSnapshot, transformCatalog, validateCatalog, type CityCatalogRecord } from './catalog';
import { extendDistrictCatalog, type NeighbourhoodSources } from './neighbourhoods';
import { normalizeCitySearch, matchesCitySearch } from './search';
import { generateCitiesUpsertSql } from './release-sql';
import { compareSnapshots } from './diff';
import {
  containsPoint,
  sampleGrid,
  nearestCatalogCity,
  verifyCoverage,
  type PolygonFeature,
  type Polygons,
  type IndependentNames,
  type GpsChecks,
} from './coverage';
import { publishReviewedRelease } from './publish';

const district = transformCatalog(loadRawSnapshot()).records.find((r) => r.sourceCode === 'EG0202')!;
function sources(): NeighbourhoodSources {
  return {
    districtEdits: [],
    overpass: {
      metadata: {
        retrievalDate: '2026-11-09',
        license: 'ODbL',
        attribution: '© OpenStreetMap contributors',
        queryFile: 'synthetic test fixture',
      },
      response: {
        elements: [
          {
            type: 'node',
            id: 123,
            lat: district.latitude,
            lon: district.longitude,
            tags: { 'name:en': 'Test Quarter', 'name:ar': 'حي الاختبار', wikidata: 'Q123' },
          },
        ],
      },
    },
    decisions: [
      {
        sourceCode: 'OSM:node/123',
        decision: 'include',
        reviewed: true,
        notes: 'Synthetic fixture',
        governorateCode: 'EG02',
        districtSourceCode: 'EG0202',
        parentEvidence: 'Synthetic polygon',
      },
    ],
  };
}
describe('Neighbourhood release pipeline', () => {
  it('does not restore a separately named neighbourhood alias on its parent through a merge', () => {
    const input = sources();
    input.decisions.push({
      sourceCode: 'PUPZY:old-adm3-merge',
      decision: 'merge',
      reviewed: true,
      notes: 'Historical composite administrative name',
      mergeInto: district.sourceCode,
      aliases: ['Test Quarter', 'حي الاختبار', 'Former district spelling'],
    });
    const rows = extendDistrictCatalog([district], input);
    expect(rows.find((r) => r.sourceCode === district.sourceCode)?.aliases).not.toContain('Test Quarter');
    expect(rows.find((r) => r.sourceCode === district.sourceCode)?.aliases).not.toContain('حي الاختبار');
    expect(rows.find((r) => r.sourceCode === district.sourceCode)?.aliases).toContain('Former district spelling');
    expect(rows.find((r) => r.sourceCode === 'OSM:node/123')?.nameEnglish).toBe('Test Quarter');
  });
  it('uses source points, bilingual labels and a reviewed parent deterministically', () => {
    const rows = extendDistrictCatalog([district], sources());
    expect(extendDistrictCatalog([district], sources())).toEqual(rows);
    const child = rows.find((r) => r.districtSourceCode)!;
    expect(child.nameArabic).toBe('حي الاختبار');
    expect(child.latitude).toBe(district.latitude);
    expect(
      validateCatalog({ metadata: { declaredOfficialCount: 2, governorateCount: 1 }, records: rows }).errors,
    ).toEqual([]);
  });
  it('quarantines unreviewed names and rejects missing parent evidence', () => {
    const input = sources();
    input.decisions[0].reviewed = false;
    expect(extendDistrictCatalog([district], input)).toHaveLength(1);
    input.decisions[0].reviewed = true;
    input.decisions[0].parentEvidence = '';
    expect(() => extendDistrictCatalog([district], input)).toThrow('Incomplete reviewed');
  });
  it('fills missing source labels and aliases from committed Wikidata results', () => {
    const input = sources();
    input.overpass!.response.elements[0].tags = { wikidata: 'Q123' };
    input.wikidata = {
      metadata: { retrievalDate: '2026-11-09', license: 'CC0', attribution: 'Wikidata', queryFile: 'synthetic' },
      response: {
        results: {
          bindings: [
            {
              item: { value: 'http://www.wikidata.org/entity/Q123' },
              en: { value: 'Test Quarter' },
              ar: { value: 'حي الاختبار' },
              enAlias: { value: 'Quarter Test' },
            },
          ],
        },
      },
    };
    const child = extendDistrictCatalog([district], input).find((r) => r.districtSourceCode)!;
    expect(child.nameEnglish).toBe('Test Quarter');
    expect(child.aliases).toContain('Quarter Test');
  });
  it('merges coincident places and keeps district identity and old spelling', () => {
    const input = sources();
    input.districtEdits = [
      {
        sourceCode: district.sourceCode,
        nameEnglish: 'Raml First',
        aliases: ['Raml 1'],
        notes: 'Editorial correction',
      },
    ];
    input.decisions[0] = {
      ...input.decisions[0],
      decision: 'merge',
      mergeInto: district.sourceCode,
      aliases: ['Alternative Raml'],
    };
    const rows = extendDistrictCatalog([district], input);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceCode).toBe(district.sourceCode);
    expect(rows[0].aliases).toEqual(expect.arrayContaining([district.nameEnglish, 'Raml 1', 'Alternative Raml']));
  });
  it('rejects nonofficial parents and aliases duplicating canonical names', () => {
    const rows = extendDistrictCatalog([district], sources());
    rows[0].status = 'RETIRED';
    const child = rows.find((r) => r.districtSourceCode)!;
    child.aliases = [child.nameEnglish];
    const result = validateCatalog({ metadata: { declaredOfficialCount: 1, governorateCount: 1 }, records: rows });
    expect(result.errors.join(' ')).toContain('OFFICIAL district');
    expect(result.errors.join(' ')).toContain('Duplicate or blank alias');
  });
  it('emits roots before children and updates fields while preserving UUIDs', () => {
    const sql = generateCitiesUpsertSql(extendDistrictCatalog([district], sources()).reverse()).join('\n');
    expect(sql.indexOf("'EG0202'")).toBeLessThan(sql.indexOf("'OSM:node/123'"));
    expect(sql).toContain("(SELECT id FROM cities WHERE source_code = 'EG0202')");
    expect(sql).toContain('aliases = EXCLUDED.aliases, district_id = EXCLUDED.district_id');
    expect(sql).not.toContain('id = EXCLUDED.id');
  });
  it('detects alias-only changes and refuses publication without coverage evidence', () => {
    const raw = loadRawSnapshot();
    const diff = compareSnapshots(transformCatalog(raw).records, {
      ...raw,
      neighbourhoods: {
        districtEdits: [
          { sourceCode: district.sourceCode, nameEnglish: district.nameEnglish, aliases: ['Raml Test'], notes: 'Test' },
        ],
        decisions: [],
      },
    });
    expect(diff.metadataChanged).toContain(district.sourceCode);
    expect(() =>
      publishReviewedRelease(
        transformCatalog(raw).records,
        { ...raw, neighbourhoods: sources() },
        { reviewedMetadata: { declaredOfficialCount: 352, governorateCount: 27 } },
      ),
    ).toThrow('coverage evidence');
  });
});
describe('Picker normalization and coverage gate', () => {
  it.each([
    [' EL-Sídi  Gaber ', 'sídi gaber'],
    ['الـرَّحَاب', 'رحاب'],
    ['أإآٱ ة ى ؤ ئ', 'اااا ه ي و ي'],
    ['Al-Mohand’es’sin', 'mohandessin'],
  ])('normalizes %s', (input, expected) => expect(normalizeCitySearch(input)).toBe(expected));
  it('matches aliases and district names', () => {
    expect(matchesCitySearch('رم', { ...district, aliases: ['الرمل'] })).toBe(true);
    expect(matchesCitySearch('Alex', district)).toBe(true);
    expect(matchesCitySearch('Raml', { ...district, nameEnglish: 'Test', nameArabic: 'اختبار' }, district)).toBe(true);
  });
  const polygon: PolygonFeature = {
    type: 'Feature',
    properties: { area: 'alexandria', evidence: 'Synthetic' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [29.9, 31.2],
          [29.92, 31.2],
          [29.92, 31.22],
          [29.9, 31.22],
          [29.9, 31.2],
        ],
        [
          [29.905, 31.205],
          [29.915, 31.205],
          [29.915, 31.215],
          [29.905, 31.215],
          [29.905, 31.205],
        ],
      ],
    },
  };
  it('samples a 500 m grid inside polygons excluding holes', () => {
    expect(containsPoint([29.91, 31.21], polygon)).toBe(false);
    expect(containsPoint([29.901, 31.201], polygon)).toBe(true);
    const samples = sampleGrid(polygon);
    expect(samples.length).toBeGreaterThan(4);
    expect(samples.every((p) => containsPoint(p, polygon))).toBe(true);
  });
  it('nearest diagnostics include official neighbourhoods and exclude legacy places', () => {
    const child: CityCatalogRecord = {
      ...district,
      sourceCode: 'PUPZY:test',
      longitude: 29.91,
      latitude: 31.21,
      districtSourceCode: district.sourceCode,
    };
    expect(
      nearestCatalogCity([29.91, 31.21], [district, child, { ...child, sourceCode: 'PUPZY:legacy', status: 'LEGACY' }])
        .city.sourceCode,
    ).toBe(child.sourceCode);
  });
  it('fails missing evidence instead of passing empty grids/lists', () => {
    const polygons: Polygons = { metadata: { reviewed: false, notes: 'Unavailable' }, features: [] };
    const areas = { 'greater-cairo': [], alexandria: [], 'port-said-region': [] };
    const names: IndependentNames = { metadata: { reviewed: false, method: 'Unavailable' }, areas };
    const gps: GpsChecks = { metadata: { reviewed: false, notes: 'Unavailable' }, areas };
    const report = verifyCoverage(
      { records: [district], metadata: { declaredOfficialCount: 1, governorateCount: 1 } },
      polygons,
      polygons,
      polygons,
      names,
      gps,
    );
    expect(report.passed).toBe(false);
    expect(report.areas.every((a) => !a.grid.passed && !a.gps.passed && !a.names.passed)).toBe(true);
  });
});
