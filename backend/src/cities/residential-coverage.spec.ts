import { loadRawSnapshot, transformCatalog } from './catalog';
import {
  measureResidentialFeature,
  residentialFeatures,
  verifyCoverage,
  type GridReview,
  type PolygonFeature,
  type Polygons,
} from './coverage';

const city = transformCatalog(loadRawSnapshot()).records[0];
const feature: PolygonFeature = {
  type: 'Feature',
  properties: {
    area: 'greater-cairo',
    osmSourceCode: 'OSM:way/1',
    evidence: 'OSM:way/1 landuse=residential',
    samplePoint: [city.longitude + 0.2, city.latitude],
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [city.longitude - 0.1, city.latitude - 0.01],
        [city.longitude + 0.3, city.latitude - 0.01],
        [city.longitude + 0.3, city.latitude + 0.01],
        [city.longitude - 0.1, city.latitude + 0.01],
        [city.longitude - 0.1, city.latitude - 0.01],
      ],
    ],
  },
};
const empty = { 'greater-cairo': [], alexandria: [], 'port-said-region': [] };
const polygons = (features: PolygonFeature[], gridReview?: GridReview): Polygons => ({
  metadata: { reviewed: true, notes: 'Synthetic test evidence', gridReview },
  features,
});
function report(records = [city], review?: GridReview) {
  return verifyCoverage(
    { records, metadata: { declaredOfficialCount: records.length, governorateCount: 1 } },
    polygons([feature], review),
    polygons([]),
    polygons([]),
    {
      metadata: {
        reviewed: true,
        method: 'Synthetic',
        minimums: {
          'greater-cairo': { minimum: 150, reviewed: true, decisionDate: '2026-11-10', reason: 'Lead' },
          alexandria: { minimum: 150, reviewed: true, decisionDate: '2026-11-10', reason: 'Lead' },
          'port-said-region': { minimum: 88, reviewed: true, decisionDate: '2026-11-10', reason: 'Lead' },
        },
      },
      areas: empty,
    },
    { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty },
  ).areas[0];
}
const outside = { ...city, longitude: city.longitude + 0.4 };
function reviewedException(): GridReview {
  const measured = measureResidentialFeature(feature, [outside]);
  return {
    reviewed: true,
    decisionDate: '2026-11-10',
    floors: { 'greater-cairo': 0, alexandria: 0, 'port-said-region': 0 },
    exceptions: [
      {
        osmSourceCode: 'OSM:way/1',
        area: 'greater-cairo',
        centre: feature.properties.samplePoint!,
        uncoveredSamples: measured.gaps.length,
        worstDistanceMeters: measured.gaps[0].meters,
        nearestCity: outside.sourceCode,
        research: 'Reverse and nearby names inspected in recorded responses.',
        whyNoName: 'No settlement name established.',
        individualResearch: 'Individual feature researched.',
      },
    ],
  };
}

describe('Reviewed residential coverage policy', () => {
  it('excludes populated ADM3 evidence from built-up sampling', () => {
    const adm3 = { ...feature, properties: { area: 'greater-cairo' as const, evidence: 'OCHA ADM3 populated' } };
    expect(residentialFeatures(polygons([adm3, feature]))).toEqual([feature]);
  });
  it('credits an entire polygon only for a contained OFFICIAL City', () => {
    const measured = measureResidentialFeature(feature, [city]);
    expect(measured.samples.some((s) => s.meters > 1500)).toBe(true);
    expect(measured.gaps).toEqual([]);
    expect(measureResidentialFeature(feature, [{ ...city, status: 'LEGACY' }, outside]).gaps.length).toBeGreaterThan(0);
  });
  it('requires reviewed floors even with complete coverage', () => {
    expect(report().grid.passed).toBe(false);
    expect(report([city], reviewedException()).grid.passed).toBe(true);
  });
  it('requires a dated lead decision for an amended floor and rejects a stale approval', () => {
    const review = reviewedException();
    review.floors['greater-cairo'] = 0.968;
    expect(report([city], review).grid.passed).toBe(false);
    review.floorDecisions = {
      'greater-cairo': {
        reviewed: true,
        approvedBy: 'lead',
        decisionDate: '2026-11-11',
        previousFloor: 0.97,
        floor: 0.968,
        reason: 'Lead reviewed the remaining unnamed blocks after synthetic references were removed.',
      },
    };
    expect(report([city], review).grid.passed).toBe(true);
    expect(report([outside], review).grid.passed).toBe(false);
    review.floors['greater-cairo'] = 0.965;
    expect(report([city], review).grid.passed).toBe(false);
    review.floors['greater-cairo'] = 0.968;
    review.floorDecisions['greater-cairo']!.reason = '';
    expect(report([city], review).grid.passed).toBe(false);
  });
  it('requires a complete matching exception and individual research beyond 4 km', () => {
    const review = reviewedException();
    expect(report([outside], review).grid.passed).toBe(true);
    delete review.exceptions[0].individualResearch;
    expect(report([outside], review).grid.passed).toBe(false);
    review.exceptions[0].individualResearch = 'Research';
    review.exceptions[0].uncoveredSamples--;
    expect(report([outside], review).grid.passed).toBe(false);
  });
  it('fails share regressions and unreviewed new features', () => {
    const review = reviewedException();
    review.floors['greater-cairo'] = 1;
    expect(report([outside], review).grid.passed).toBe(false);
    review.floors['greater-cairo'] = 0;
    review.exceptions[0].osmSourceCode = 'OSM:way/2';
    expect(report([outside], review).grid.passed).toBe(false);
  });
  it('uses the reviewed Port Said minimum while retaining the Cairo and Alexandria floor', () => {
    const entries = [{ english: city.nameEnglish, arabic: city.nameArabic, misspellings: [] }];
    const minimum = { minimum: 1, reviewed: true, decisionDate: '2026-11-10', reason: 'Reviewed lead decision' };
    const names = {
      metadata: {
        reviewed: true,
        method: 'Synthetic',
        minimums: {
          'greater-cairo': minimum,
          alexandria: minimum,
          'port-said-region': minimum,
        },
      },
      areas: { 'greater-cairo': entries, alexandria: entries, 'port-said-region': entries },
    };
    const row = { ...city, governorateCode: 'EG03' };
    const result = verifyCoverage(
      { records: [row], metadata: { declaredOfficialCount: 1, governorateCount: 1 } },
      polygons([]),
      polygons([]),
      polygons([]),
      names,
      { metadata: { reviewed: true, notes: 'Synthetic' }, areas: empty },
    );
    expect(result.areas[2].names.passed).toBe(true);
    expect(result.areas[0].names.passed).toBe(false);
    expect(result.areas[1].names.passed).toBe(false);
  });
  it('reads the reviewed area-specific name minimum', () => {
    expect(report().names.minimum).toBe(150);
    expect(report().names.passed).toBe(false);
  });
});
