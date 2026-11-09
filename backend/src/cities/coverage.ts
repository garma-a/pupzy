import { validateCatalog, type CityCatalog, type CityCatalogRecord } from './catalog';
import { matchesCitySearch, normalizeCitySearch } from './search';

export const COVERAGE_AREAS = ['greater-cairo', 'alexandria', 'port-said-region'] as const;
export type CoverageArea = (typeof COVERAGE_AREAS)[number];
type Position = [number, number];
export interface PolygonFeature {
  type: 'Feature';
  properties: { area?: CoverageArea; governorateCode?: string; districtSourceCode?: string; evidence?: string };
  geometry: { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
}
export interface Polygons {
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
    Array<{ latitude: number; longitude: number; acceptableSourceCodes: string[]; evidence: string }>
  >;
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
  const ranked = records
    .filter((r) => r.status === 'OFFICIAL')
    .map((city) => ({ city, meters: distanceMeters(point, [city.longitude, city.latitude]) }));
  ranked.sort((a, b) => a.meters - b.meters || a.city.sourceCode.localeCompare(b.city.sourceCode));
  if (!ranked[0]) throw new Error('Cannot verify an empty official catalog');
  return ranked[0];
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
      if (!parent || distanceMeters([row.longitude, row.latitude], [parent.longitude, parent.latitude]) > 75000)
        dataErrors.push(`${row.sourceCode}: parent point more than 75 km away or missing`);
      if (
        !districts.features.some(
          (f) =>
            f.properties.districtSourceCode === row.districtSourceCode &&
            containsPoint([row.longitude, row.latitude], f),
        )
      )
        dataErrors.push(`${row.sourceCode}: containing district unverified`);
    }
  }
  const areaGovernorates: Record<CoverageArea, string[]> = {
    'greater-cairo': ['EG01', 'EG21', 'EG14', 'EG13'],
    alexandria: ['EG02', 'EG18', 'EG33'],
    'port-said-region': ['EG03', 'EG19', 'EG11'],
  };
  const areas = COVERAGE_AREAS.map((area) => {
    const polygons = residential.features.filter((f) => f.properties.area === area);
    const points = polygons.flatMap((f) => sampleGrid(f));
    const gaps = points
      .map((point) => ({ longitude: point[0], latitude: point[1], ...nearestCatalogCity(point, records) }))
      .map(({ city, ...gap }) => ({ ...gap, nearest: city.sourceCode }))
      .filter((gap) => gap.meters > 1500)
      .sort((a, b) => b.meters - a.meters);
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
      return check.evidence && check.acceptableSourceCodes.includes(result.city.sourceCode)
        ? []
        : [{ ...check, actual: result.city.sourceCode }];
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
