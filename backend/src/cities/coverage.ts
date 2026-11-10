import { validateCatalog, type CityCatalog, type CityCatalogRecord } from './catalog';
import { readCityData } from './data-files';
import { matchesCitySearch, normalizeCitySearch } from './search';

export const COVERAGE_AREAS = ['greater-cairo', 'alexandria', 'port-said-region'] as const;
export type CoverageArea = (typeof COVERAGE_AREAS)[number];
type Position = [number, number];
export interface PolygonFeature {
  type: 'Feature';
  properties: {
    area?: CoverageArea;
    governorateCode?: string;
    districtSourceCode?: string;
    evidence?: string;
    samplePoint?: Position;
  };
  geometry: { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
}
export interface Polygons {
  sourcePath?: string;
  sha256?: string;
  ochaLevel?: 1 | 2;
  metadata: { reviewed: boolean; notes: string };
  features: PolygonFeature[];
}
export interface IndependentNames {
  metadata: { reviewed: boolean; method: string };
  areas: Record<CoverageArea, Array<{ english: string; arabic: string; misspellings: string[] }>>;
}
export interface GpsChecks {
  metadata: { reviewed: boolean; notes: string };
  areas: Record<
    CoverageArea,
    Array<{
      latitude: number;
      longitude: number;
      acceptableSourceCodes: string[];
      expectedDistrictSourceCode?: string;
      acceptableAdjacentDistricts?: Array<{ sourceCode: string; reason: string }>;
      evidence: string;
    }>
  >;
}

export function hydratePolygons(input: Polygons): Polygons {
  if (!input.sourcePath) return input;
  const source = readCityData<Polygons & { features: Array<PolygonFeature & { properties: Record<string, unknown> }> }>(
    input.sourcePath,
    input.sha256,
  );
  return {
    metadata: input.metadata,
    features: source.features.map((f) => ({
      ...f,
      properties: input.ochaLevel
        ? {
            governorateCode: String((f.properties as Record<string, unknown>).adm1_pcode),
            ...(input.ochaLevel === 2
              ? { districtSourceCode: String((f.properties as Record<string, unknown>).adm2_pcode) }
              : {}),
            evidence: 'OCHA COD-AB exact P-code geometry',
          }
        : f.properties,
    })),
  };
}

/** Distance to polygon edges, not to its representative centroid. */
export function polygonDistanceMeters(point: Position, feature: PolygonFeature): number {
  if (containsPoint(point, feature)) return 0;
  const rings =
    feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
  let best = Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const scale = Math.cos((point[1] * Math.PI) / 180) ** 2;
      const t = Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx * scale + (point[1] - a[1]) * dy) / (dx * dx * scale + dy * dy || 1)),
      );
      best = Math.min(best, distanceMeters(point, [a[0] + t * dx, a[1] + t * dy]));
    }
  return best;
}

function ringContains([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function containsPoint(point: Position, feature: PolygonFeature): boolean {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.some(
    ([outer, ...holes]) => ringContains(point, outer) && !holes.some((ring) => ringContains(point, ring)),
  );
}
export function distanceMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function nearestCatalogCity(
  point: Position,
  records: CityCatalogRecord[],
): { city: CityCatalogRecord; meters: number } {
  let nearest: CityCatalogRecord | undefined;
  let meters = Infinity;
  for (const city of records) {
    if (city.status !== 'OFFICIAL') continue;
    const candidate = distanceMeters(point, [city.longitude, city.latitude]);
    if (candidate < meters || (candidate === meters && city.sourceCode < (nearest?.sourceCode ?? ''))) {
      nearest = city;
      meters = candidate;
    }
  }
  if (!nearest) throw new Error('Cannot verify an empty official catalog');
  return { city: nearest, meters };
}
export function sampleGrid(feature: PolygonFeature, spacingMeters = 500): Position[] {
  if (!Number.isFinite(spacingMeters) || spacingMeters < 100) throw new Error('Grid spacing must be at least 100 m');
  const rings =
    feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
  const vertices = rings.flat();
  const west = Math.min(...vertices.map((p) => p[0]));
  const east = Math.max(...vertices.map((p) => p[0]));
  const south = Math.min(...vertices.map((p) => p[1]));
  const north = Math.max(...vertices.map((p) => p[1]));
  const stepY = spacingMeters / 111195;
  const points: Position[] = [];
  for (let lat = south; lat <= north; lat += stepY) {
    const stepX = spacingMeters / (111195 * Math.cos((lat * Math.PI) / 180));
    for (let lon = west; lon <= east; lon += stepX) {
      if (containsPoint([lon, lat], feature)) points.push([lon, lat]);
    }
  }
  if (points.length === 0 && feature.properties.samplePoint && containsPoint(feature.properties.samplePoint, feature))
    points.push(feature.properties.samplePoint);
  return points;
}

export function verifyCoverage(
  catalog: CityCatalog,
  residential: Polygons,
  governorates: Polygons,
  districts: Polygons,
  names: IndependentNames,
  gps: GpsChecks,
) {
  residential = hydratePolygons(residential);
  governorates = hydratePolygons(governorates);
  districts = hydratePolygons(districts);
  const records = catalog.records;
  const byCode = new Map(records.map((r) => [r.sourceCode, r]));
  const validation = validateCatalog(catalog);
  const dataErrors = [...validation.errors];
  if (!governorates.metadata.reviewed || governorates.features.length === 0)
    dataErrors.push('Missing reviewed governorate boundaries');
  if (!districts.metadata.reviewed || districts.features.length === 0)
    dataErrors.push('Missing reviewed ADM2 boundaries');
  for (const row of records.filter((r) => r.status === 'OFFICIAL')) {
    const bounds = governorates.features.filter((f) => f.properties.governorateCode === row.governorateCode);
    if (!bounds.some((f) => containsPoint([row.longitude, row.latitude], f)))
      dataErrors.push(`${row.sourceCode}: governorate containment unverified or outside bounds`);
    if (row.districtSourceCode) {
      const parent = byCode.get(row.districtSourceCode);
      if (!parent) dataErrors.push(`${row.sourceCode}: missing district parent`);
      const containing = districts.features.find((f) => f.properties.districtSourceCode === row.districtSourceCode);
      if (!containing) dataErrors.push(`${row.sourceCode}: parent polygon missing`);
      else if (!containsPoint([row.longitude, row.latitude], containing)) {
        const rule = row.provenance?.parentRule;
        const zemam = row.provenance?.zemamOutSourceCode;
        const recorded = row.provenance?.parentPolygonDistanceKm;
        const actual = polygonDistanceMeters([row.longitude, row.latitude], containing) / 1000;
        const original =
          typeof zemam === 'string'
            ? districts.features.find((f) => f.properties.districtSourceCode === zemam)
            : undefined;
        const inZemam = original
          ? zemam?.toString().endsWith('00') && containsPoint([row.longitude, row.latitude], original)
          : !districts.features.some(
              (f) =>
                !f.properties.districtSourceCode?.endsWith('00') && containsPoint([row.longitude, row.latitude], f),
            );
        const parentCandidates = row.provenance?.parentCandidateSourceCodes;
        const candidates = districts.features.filter((f) => {
          const district = byCode.get(f.properties.districtSourceCode ?? '');
          if (
            !district ||
            district.districtSourceCode ||
            district.status !== 'OFFICIAL' ||
            district.governorateCode !== row.governorateCode
          )
            return false;
          return (
            rule === 'zemam-out-nearest-polygon' ||
            (Array.isArray(parentCandidates) && parentCandidates.includes(district.sourceCode))
          );
        });
        const minimum = Math.min(
          ...candidates.map((f) => polygonDistanceMeters([row.longitude, row.latitude], f) / 1000),
        );
        if (
          !['zemam-out-named-city', 'zemam-out-nearest-polygon'].includes(String(rule)) ||
          !inZemam ||
          typeof recorded !== 'number' ||
          actual > 40 ||
          Math.abs(actual - recorded) > 0.1 ||
          !Number.isFinite(minimum) ||
          actual - minimum > 0.1
        )
          dataErrors.push(`${row.sourceCode}: containing district unverified (invalid Zemam Out exception)`);
      }
    }
  }
  const areaGovernorates: Record<CoverageArea, string[]> = {
    'greater-cairo': ['EG01', 'EG21', 'EG14', 'EG13'],
    alexandria: ['EG02', 'EG18', 'EG33'],
    'port-said-region': ['EG03', 'EG19', 'EG11'],
  };
  const areas = COVERAGE_AREAS.map((area) => {
    const polygons = residential.features.filter((f) => f.properties.area === area);
    const points = polygons.flatMap((f) => sampleGrid(f).map((point) => ({ point, evidence: f.properties.evidence })));
    const rankedSamples = points
      .map(({ point, evidence }) => ({
        longitude: point[0],
        latitude: point[1],
        evidence,
        ...nearestCatalogCity(point, records),
      }))
      .map(({ city, ...gap }) => ({ ...gap, nearest: city.sourceCode }))
      .sort((a, b) => b.meters - a.meters);
    const gaps = rankedSamples.filter((gap) => gap.meters > 1500);
    const entries = names.areas[area];
    const distinctNames = new Set(entries.map((entry) => normalizeCitySearch(entry.arabic))).size;
    const missingNames = entries.flatMap((entry) =>
      [entry.english, entry.arabic, ...entry.misspellings].filter(
        (name) =>
          !records.some(
            (r) =>
              r.status === 'OFFICIAL' &&
              areaGovernorates[area].includes(r.governorateCode) &&
              matchesCitySearch(name, r, byCode.get(r.districtSourceCode ?? '')),
          ),
      ),
    );
    const checks = gps.areas[area];
    const gpsFailures = checks.flatMap((check) => {
      const result = nearestCatalogCity([check.longitude, check.latitude], records);
      const actualDistrict = result.city.districtSourceCode ?? result.city.sourceCode;
      const acceptable = check.expectedDistrictSourceCode
        ? [
            check.expectedDistrictSourceCode,
            ...(check.acceptableAdjacentDistricts ?? []).filter((a) => a.reason.trim()).map((a) => a.sourceCode),
          ].includes(actualDistrict)
        : check.acceptableSourceCodes.includes(result.city.sourceCode);
      return check.evidence && acceptable ? [] : [{ ...check, actual: result.city.sourceCode }];
    });
    return {
      area,
      grid: {
        passed:
          residential.metadata.reviewed &&
          polygons.length > 0 &&
          polygons.every((p) => p.properties.evidence) &&
          points.length > 0 &&
          gaps.length === 0,
        samples: points.length,
        gapCount: gaps.length,
        worstGaps: gaps.slice(0, 10),
        worstSamples: rankedSamples.slice(0, 10),
        reason: polygons.length ? undefined : 'No built-up polygons fetched/reviewed; worst gaps cannot be measured',
      },
      names: {
        passed: names.metadata.reviewed && distinctNames >= 150 && missingNames.length === 0,
        entries: entries.length,
        distinctNames,
        variants: entries.reduce((sum, e) => sum + 2 + e.misspellings.length, 0),
        missingNames,
      },
      gps: {
        passed: gps.metadata.reviewed && checks.length >= 30 && gpsFailures.length === 0,
        checks: checks.length,
        failures: gpsFailures,
        note: 'Offline great-circle diagnostic. Repository ST_Distance(geography) must also pass the DB integration spec.',
      },
    };
  });
  return {
    passed: dataErrors.length === 0 && areas.every((a) => a.grid.passed && a.names.passed && a.gps.passed),
    structuralValidation: validation,
    dataQuality: { passed: dataErrors.length === 0, errors: dataErrors },
    areas,
  };
}
