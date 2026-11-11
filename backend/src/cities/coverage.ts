import { validateCatalog, type CityCatalog, type CityCatalogRecord } from './catalog';
import { readCityData } from './data-files';
import { normalizeCitySearch } from './search';
import { reviewCityAliases } from './alias-review';

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
    osmSourceCode?: string;
  };
  geometry: { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
}
export interface Polygons {
  sourcePath?: string;
  sha256?: string;
  ochaLevel?: 1 | 2;
  replacements?: { sourcePath: string; sha256: string };
  metadata: { reviewed: boolean; notes: string; gridReview?: GridReview };
  features: PolygonFeature[];
}
export interface GridException {
  osmSourceCode: string;
  area: CoverageArea;
  centre: Position;
  uncoveredSamples: number;
  worstDistanceMeters: number;
  nearestCity: string;
  research: string;
  whyNoName: string;
  individualResearch?: string;
}
export interface GridReview {
  reviewed: boolean;
  decisionDate: string;
  floors: Record<CoverageArea, number>;
  floorDecisions?: Partial<
    Record<
      CoverageArea,
      {
        reviewed: boolean;
        approvedBy: string;
        decisionDate: string;
        previousFloor: number;
        floor: number;
        reason: string;
      }
    >
  >;
  exceptions: GridException[];
}
export interface KnownMissingNames {
  metadata: { reviewed: boolean; decisionDate: string; notes: string };
  entries: Array<{
    area: CoverageArea;
    english: string;
    arabic: string;
    variants: string[];
    reviewed: boolean;
    research: string;
    reason: string;
    sourceUrls: string[];
  }>;
}
export interface DocumentedGpsFailure {
  area: CoverageArea;
  latitude: number;
  longitude: number;
  actualSourceCode: string;
  expectedDistrictSourceCode: string;
  reviewed: boolean;
  research: string;
  reason: string;
  sourceUrls: string[];
}
export interface HeadlineNames {
  sourcePath?: string;
  sha256?: string;
  entries: Array<[string, string, string]>;
  displayRules?: string[];
}

export function verifyHeadlineNames(records: CityCatalogRecord[], headlines: HeadlineNames) {
  const failures = headlines.entries.flatMap(([english, arabic, governorate]) => {
    const matches = records.filter(
      (row) =>
        row.status === 'OFFICIAL' &&
        row.governorate === governorate &&
        row.nameEnglish === english &&
        row.nameArabic === arabic,
    );
    const bare = (name: string) => name.split(/ \(| — /)[0];
    const duplicates = records.filter(
      (row) =>
        row.status === 'OFFICIAL' &&
        row.governorate === governorate &&
        row.districtSourceCode &&
        row.sourceCode !== matches[0]?.sourceCode &&
        (normalizeCitySearch(bare(row.nameEnglish)) === normalizeCitySearch(english) ||
          normalizeCitySearch(bare(row.nameArabic)) === normalizeCitySearch(arabic)),
    );
    return matches.length === 1 && duplicates.length === 0
      ? []
      : [
          {
            english,
            arabic,
            governorate,
            matches: matches.length,
            duplicateSourceCodes: duplicates.map((row) => row.sourceCode),
          },
        ];
  });
  return {
    passed: failures.length === 0,
    total: headlines.entries.length,
    matched: headlines.entries.length - failures.length,
    failures,
  };
}

export interface IndependentNames {
  sourcePath?: string;
  sha256?: string;
  knownMissing?: KnownMissingNames;
  metadata: {
    reviewed: boolean;
    method: string;
    minimums?: Record<CoverageArea, { minimum: number; reviewed: boolean; decisionDate: string; reason: string }>;
  };
  areas: Record<CoverageArea, Array<{ english: string; arabic: string; misspellings: string[] }>>;
}
export interface GpsChecks {
  sourcePath?: string;
  sha256?: string;
  metadata: { reviewed: boolean; notes: string; decisionDate?: string; documentedFailures?: DocumentedGpsFailure[] };
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

export function isGpsFailureDocumented(
  area: CoverageArea,
  failure: { latitude: number; longitude: number; actual: string; expectedDistrictSourceCode?: string },
  metadata: GpsChecks['metadata'],
): boolean {
  return Boolean(
    metadata.decisionDate &&
    metadata.documentedFailures?.some(
      (approval) =>
        approval.area === area &&
        approval.reviewed &&
        approval.latitude === failure.latitude &&
        approval.longitude === failure.longitude &&
        approval.expectedDistrictSourceCode === failure.expectedDistrictSourceCode &&
        approval.actualSourceCode === failure.actual &&
        approval.research.trim() &&
        approval.reason.trim() &&
        approval.sourceUrls.length > 0 &&
        approval.sourceUrls.every((url) => /^https?:\/\//.test(url)),
    ),
  );
}

export function hydratePolygons(input: Polygons): Polygons {
  if (!input.sourcePath) return input;
  const source = readCityData<{
    metadata: Polygons['metadata'];
    features: Array<Omit<PolygonFeature, 'properties'> & { properties: Record<string, unknown> }>;
  }>(input.sourcePath, input.sha256);
  const replacements = input.replacements
    ? readCityData<{ features: Array<Omit<PolygonFeature, 'properties'> & { properties: Record<string, unknown> }> }>(
        input.replacements.sourcePath,
        input.replacements.sha256,
      ).features
    : [];
  const key = input.ochaLevel === 1 ? 'adm1_pcode' : 'adm2_pcode';
  const features = source.features.map(
    (f) =>
      replacements.find(
        (replacement) =>
          replacement.properties.ochaLevel === input.ochaLevel && replacement.properties[key] === f.properties[key],
      ) ?? f,
  );
  return {
    metadata: { ...source.metadata, ...input.metadata },
    features: features.map((f) => ({
      ...f,
      properties: input.ochaLevel
        ? {
            governorateCode: String(f.properties.adm1_pcode),
            ...(input.ochaLevel === 2 ? { districtSourceCode: String(f.properties.adm2_pcode) } : {}),
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
  for (let lat = south + stepY / 2; lat <= north; lat += stepY) {
    const stepX = spacingMeters / (111195 * Math.cos((lat * Math.PI) / 180));
    for (let lon = west + stepX / 2; lon <= east; lon += stepX) {
      if (containsPoint([lon, lat], feature)) points.push([lon, lat]);
    }
  }
  if (points.length === 0 && feature.properties.samplePoint && containsPoint(feature.properties.samplePoint, feature))
    points.push(feature.properties.samplePoint);
  return points;
}

/** The only built-up evidence admitted by the 2026-11-10 lead decision. */
export function residentialFeatures(input: Polygons): PolygonFeature[] {
  return input.features.filter(
    (f) =>
      /^OSM:(way|relation)\/\d+$/.test(f.properties.osmSourceCode ?? '') &&
      Boolean(f.properties.evidence?.includes('landuse=residential')),
  );
}

/** One contained OFFICIAL point credits the residential polygon's entire grid. */
export function measureResidentialFeature(feature: PolygonFeature, records: CityCatalogRecord[]) {
  const points = sampleGrid(feature);
  const vertices =
    feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
  const west = Math.min(...vertices.map((p) => p[0]));
  const east = Math.max(...vertices.map((p) => p[0]));
  const south = Math.min(...vertices.map((p) => p[1]));
  const north = Math.max(...vertices.map((p) => p[1]));
  const containedCity = records.find(
    (r) =>
      r.status === 'OFFICIAL' &&
      r.longitude >= west &&
      r.longitude <= east &&
      r.latitude >= south &&
      r.latitude <= north &&
      containsPoint([r.longitude, r.latitude], feature),
  );
  const samples = points.map((point) => {
    const nearest = nearestCatalogCity(point, records);
    return {
      longitude: point[0],
      latitude: point[1],
      evidence: feature.properties.evidence,
      meters: nearest.meters,
      nearest: nearest.city.sourceCode,
    };
  });
  const gaps = containedCity ? [] : samples.filter((s) => s.meters > 1500);
  gaps.sort((a, b) => b.meters - a.meters);
  return { samples, gaps, containedCity: containedCity?.sourceCode };
}

export function verifyCoverage(
  catalog: CityCatalog,
  residential: Polygons,
  governorates: Polygons,
  districts: Polygons,
  names: IndependentNames,
  gps: GpsChecks,
  headlines?: HeadlineNames,
) {
  if (names.sourcePath) names = readCityData<IndependentNames>(names.sourcePath, names.sha256);
  if (gps.sourcePath) gps = readCityData<GpsChecks>(gps.sourcePath, gps.sha256);
  residential = hydratePolygons(residential);
  governorates = hydratePolygons(governorates);
  districts = hydratePolygons(districts);
  if (headlines?.sourcePath) headlines = readCityData<HeadlineNames>(headlines.sourcePath, headlines.sha256);
  const records = catalog.records;
  const headlineReview = headlines ? verifyHeadlineNames(records, headlines) : undefined;
  const byCode = new Map(records.map((r) => [r.sourceCode, r]));
  const validation = validateCatalog(catalog);
  const dataErrors = [...validation.errors];
  for (const removed of reviewCityAliases(records.map((row) => ({ ...row, aliases: [...(row.aliases ?? [])] }))))
    dataErrors.push(`${removed.sourceCode}: invalid alias (${removed.reason}): ${removed.alias}`);
  for (const failure of headlineReview?.failures ?? [])
    dataErrors.push(
      `Headline missing/ambiguous: ${failure.english} / ${failure.arabic} (${failure.governorate}), exact matches=${failure.matches}`,
    );
  if (!governorates.metadata.reviewed || governorates.features.length === 0)
    dataErrors.push('Missing reviewed governorate boundaries');
  if (!districts.metadata.reviewed || districts.features.length === 0)
    dataErrors.push('Missing reviewed ADM2 boundaries');
  const seenArabic = new Set<string>();
  for (const row of records.filter((r) => r.status === 'OFFICIAL')) {
    if (!/^[\x20-\x7e]+$/.test(row.nameEnglish))
      dataErrors.push(`${row.sourceCode}: English display must be plain ASCII`);
    if (/[\u0660-\u0669\u06f0-\u06f9]/.test(row.nameArabic))
      dataErrors.push(`${row.sourceCode}: Arabic display must use Western digits; retain other digit forms as aliases`);
    if (/\bnear\b/i.test(row.nameEnglish) || /(?:^|[\s—،])قرب(?:\s|$)/.test(row.nameArabic))
      dataErrors.push(`${row.sourceCode}: near/قرب forbidden in display name`);
    if ((row.nameEnglish.match(/\(/g)?.length ?? 0) > 1 || (row.nameArabic.match(/ — /g)?.length ?? 0) > 1)
      dataErrors.push(`${row.sourceCode}: multiple display disambiguators forbidden`);
    if (/\([^)]*\(/.test(row.nameEnglish)) dataErrors.push(`${row.sourceCode}: nested display parentheses forbidden`);
    const key = row.governorateCode + ':' + row.nameArabic.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (seenArabic.has(key))
      dataErrors.push(`${row.sourceCode}: Duplicate Arabic display name in governorate: ${row.nameArabic}`);
    seenArabic.add(key);
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
    const polygons = residentialFeatures(residential).filter((f) => f.properties.area === area);
    const measured = polygons.map((feature) => ({ feature, ...measureResidentialFeature(feature, records) }));
    const rankedSamples = measured.flatMap((m) => m.samples).sort((a, b) => b.meters - a.meters);
    const gaps = measured.flatMap((m) => m.gaps).sort((a, b) => b.meters - a.meters);
    const share = rankedSamples.length ? 1 - gaps.length / rankedSamples.length : 0;
    const review = residential.metadata.gridReview;
    const floor = review?.floors?.[area];
    const floorDecision = review?.floorDecisions?.[area];
    const calibratedFloor = floorDecision
      ? floorDecision.reviewed === true &&
        floorDecision.approvedBy === 'lead' &&
        /^\d{4}-\d{2}-\d{2}$/.test(floorDecision.decisionDate) &&
        Number.isFinite(floorDecision.previousFloor) &&
        floorDecision.previousFloor >= 0 &&
        floorDecision.previousFloor <= 1 &&
        floorDecision.floor === floor &&
        typeof floorDecision.reason === 'string' &&
        floorDecision.reason.trim().length > 0
      : typeof floor === 'number' && Math.abs(floor * 200 - Math.round(floor * 200)) < 1e-8;
    const uncoveredFeatures = measured
      .filter((m) => m.gaps.length)
      .map(({ feature, gaps: featureGaps }) => ({
        osmSourceCode: feature.properties.osmSourceCode!,
        area,
        centre: feature.properties.samplePoint!,
        uncoveredSamples: featureGaps.length,
        worstDistanceMeters: featureGaps[0].meters,
        nearestCity: featureGaps[0].nearest,
      }));
    const unreviewedFeatures = uncoveredFeatures.filter((feature) => {
      const matching = review?.exceptions.filter((e) => e.area === area && e.osmSourceCode === feature.osmSourceCode);
      if (matching?.length !== 1) return true;
      const e = matching[0];
      return (
        !e.research?.trim() ||
        !e.whyNoName?.trim() ||
        !Array.isArray(e.centre) ||
        e.centre.length !== 2 ||
        !e.centre.every(Number.isFinite) ||
        !feature.centre ||
        distanceMeters(e.centre, feature.centre) > 1 ||
        feature.uncoveredSamples > e.uncoveredSamples ||
        !Number.isFinite(e.worstDistanceMeters) ||
        feature.worstDistanceMeters > e.worstDistanceMeters + 1 ||
        e.nearestCity !== feature.nearestCity ||
        (feature.worstDistanceMeters > 4000 && !e.individualResearch?.trim())
      );
    });
    const entries = names.areas[area];
    const distinctNames = new Set(entries.map((entry) => normalizeCitySearch(entry.arabic))).size;
    const searchable = new Set(
      records
        .filter((r) => r.status === 'OFFICIAL' && areaGovernorates[area].includes(r.governorateCode))
        .flatMap((r) => [r.nameEnglish, r.nameArabic, ...(r.aliases ?? [])])
        .map(normalizeCitySearch),
    );
    const missingNames = entries.flatMap((entry) =>
      [entry.english, entry.arabic, ...entry.misspellings].filter((name) => {
        const needle = normalizeCitySearch(name);
        return !needle || !searchable.has(needle);
      }),
    );
    const acceptedMissing = names.knownMissing;
    const unreviewedMissingNames = missingNames.filter(
      (variant) =>
        !acceptedMissing?.metadata.reviewed ||
        !acceptedMissing.metadata.decisionDate ||
        !acceptedMissing.entries.some(
          (e) =>
            e.area === area &&
            e.reviewed &&
            e.variants.includes(variant) &&
            e.research.trim() &&
            e.reason.trim() &&
            e.sourceUrls.length > 0 &&
            e.sourceUrls.every((url) => /^https?:\/\//.test(url)),
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
    const undocumentedGpsFailures = gpsFailures.filter(
      (failure) => !isGpsFailureDocumented(area, failure, gps.metadata),
    );
    return {
      area,
      grid: {
        passed:
          residential.metadata.reviewed &&
          polygons.length > 0 &&
          polygons.every((p) => p.properties.evidence && p.properties.samplePoint) &&
          rankedSamples.length > 0 &&
          review?.reviewed === true &&
          Boolean(review.decisionDate) &&
          typeof floor === 'number' &&
          floor >= 0 &&
          floor <= 1 &&
          calibratedFloor &&
          share + 1e-12 >= floor &&
          unreviewedFeatures.length === 0,
        samples: rankedSamples.length,
        coverageShare: share,
        floor,
        uncoveredFeatures,
        unreviewedFeatures,
        gapCount: gaps.length,
        worstGaps: gaps.slice(0, 10),
        worstSamples: rankedSamples.slice(0, 10),
        reason: polygons.length ? undefined : 'No built-up polygons fetched/reviewed; worst gaps cannot be measured',
      },
      names: {
        passed:
          names.metadata.reviewed &&
          names.metadata.minimums?.[area]?.reviewed === true &&
          Boolean(names.metadata.minimums[area].decisionDate && names.metadata.minimums[area].reason.trim()) &&
          Number.isInteger(names.metadata.minimums[area].minimum) &&
          names.metadata.minimums[area].minimum >= (area === 'port-said-region' ? 1 : 150) &&
          distinctNames >= names.metadata.minimums[area].minimum &&
          unreviewedMissingNames.length === 0,
        minimum: names.metadata.minimums?.[area]?.minimum,
        entries: entries.length,
        distinctNames,
        variants: entries.reduce((sum, e) => sum + 2 + e.misspellings.length, 0),
        missingNames,
        unreviewedMissingNames,
        knownMissingVariants: missingNames.length - unreviewedMissingNames.length,
      },
      gps: {
        passed:
          gps.metadata.reviewed &&
          checks.length >= 30 &&
          checks.length - gpsFailures.length >= 29 &&
          gpsFailures.length <= 1 &&
          undocumentedGpsFailures.length === 0,
        checks: checks.length,
        failures: gpsFailures,
        undocumentedFailures: undocumentedGpsFailures,
        passing: checks.length - gpsFailures.length,
        note: 'Offline great-circle diagnostic. Repository ST_Distance(geography) must also pass the DB integration spec.',
      },
    };
  });
  return {
    passed: dataErrors.length === 0 && areas.every((a) => a.grid.passed && a.names.passed && a.gps.passed),
    headlines: headlineReview,
    structuralValidation: validation,
    dataQuality: { passed: dataErrors.length === 0, errors: dataErrors },
    areas,
  };
}
