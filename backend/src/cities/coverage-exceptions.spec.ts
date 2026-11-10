import { loadRawSnapshot, transformCatalog, type CityCatalogRecord } from './catalog';
import {
  distanceMeters,
  polygonDistanceMeters,
  sampleGrid,
  verifyCoverage,
  type PolygonFeature,
  type Polygons,
} from './coverage';

const root = transformCatalog(loadRawSnapshot()).records.find((r) => r.sourceCode === 'EG0202')!;
const x = root.longitude,
  y = root.latitude;
function box(code: string, west: number, east: number): PolygonFeature {
  return {
    type: 'Feature',
    properties: { governorateCode: 'EG02', districtSourceCode: code, evidence: 'Synthetic' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, y - 0.01],
          [east, y - 0.01],
          [east, y + 0.01],
          [west, y + 0.01],
          [west, y - 0.01],
        ],
      ],
    },
  };
}
const polygon = box(root.sourceCode, x - 0.01, x + 0.01);
const reviewed = (features: PolygonFeature[]): Polygons => ({
  metadata: { reviewed: true, notes: 'Synthetic' },
  features,
});
function errors(child: CityCatalogRecord, additional: CityCatalogRecord[] = [], boundaries: PolygonFeature[] = []) {
  const empty = { 'greater-cairo': [], alexandria: [], 'port-said-region': [] };
  const records = [root, child, ...additional];
  return verifyCoverage(
    { metadata: { declaredOfficialCount: records.length, governorateCount: 1 }, records },
    reviewed([]),
    reviewed([box('governorate', x - 1, x + 2)]),
    reviewed([polygon, box('EG0200', x + 0.01, x + 2), ...boundaries]),
    { metadata: { reviewed: true, method: 'Synthetic' }, areas: empty },
    { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty },
  ).dataQuality.errors;
}
const child = (): CityCatalogRecord & { provenance: NonNullable<CityCatalogRecord['provenance']> } => ({
  ...root,
  sourceCode: 'PUPZY:exception',
  nameEnglish: 'Exception Quarter',
  nameArabic: 'حي استثناء',
  districtSourceCode: root.sourceCode,
  longitude: x + 0.03,
  aliases: [],
  provenance: {
    source: 'Synthetic',
    notes: 'Synthetic',
    parentEvidence: 'Synthetic parent',
    pointEvidence: 'Synthetic point',
  },
});
function excepted(): CityCatalogRecord & { provenance: NonNullable<CityCatalogRecord['provenance']> } {
  const row = child();
  row.provenance = {
    ...row.provenance,
    parentRule: 'zemam-out-nearest-polygon',
    zemamOutSourceCode: 'EG0200',
    parentPolygonDistanceKm: polygonDistanceMeters([row.longitude, row.latitude], polygon) / 1000,
  };
  return row;
}

describe('Documented Zemam Out parent exceptions', () => {
  it('uses polygon edges rather than the district centroid', () => {
    expect(polygonDistanceMeters([x + 0.03, y], polygon)).toBeLessThan(distanceMeters([x + 0.03, y], [x, y]));
  });
  it('requires containment unless a complete exception is recorded', () => {
    expect(errors(child()).join(' ')).toContain('invalid Zemam Out exception');
    expect(errors(excepted())).toEqual([]);
    const bad = excepted();
    bad.provenance.parentPolygonDistanceKm = 0;
    expect(errors(bad).join(' ')).toContain('invalid Zemam Out exception');
  });
  it('rejects an arbitrary farther polygon but accepts an explicitly named-city candidate set', () => {
    const other = {
      ...root,
      sourceCode: 'EG0203',
      nameEnglish: 'Other District',
      nameArabic: 'قسم آخر',
      longitude: x + 0.04,
    };
    const boundary = box(other.sourceCode, x + 0.035, x + 0.045);
    expect(errors(excepted(), [other], [boundary]).join(' ')).toContain('invalid Zemam Out exception');
    const named = excepted();
    named.provenance.parentRule = 'zemam-out-named-city';
    named.provenance.parentCandidateSourceCodes = [root.sourceCode];
    expect(errors(named, [other], [boundary])).toEqual([]);
  });
  it('rejects distances over the lead-approved 40 km ceiling', () => {
    const far = excepted();
    far.longitude = x + 1;
    far.provenance.parentPolygonDistanceKm = polygonDistanceMeters([far.longitude, far.latitude], polygon) / 1000;
    expect(errors(far).join(' ')).toContain('invalid Zemam Out exception');
  });
  it('samples small built-up polygons through an evidenced interior point', () => {
    const tiny = box('tiny', x, x + 0.00001);
    tiny.geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [x + 0.000005, y],
          [x + 0.00001, y + 0.00001],
          [x, y + 0.00001],
          [x + 0.000005, y],
        ],
      ],
    };
    tiny.properties.samplePoint = [x + 0.000005, y + 0.000005];
    expect(sampleGrid(tiny)).toContainEqual(tiny.properties.samplePoint);
  });
});
