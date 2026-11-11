/** Per-feature diagnostics using exactly the release gate's grid and nearest calculation. */
import * as fs from 'fs';
import * as path from 'path';
import {
  containsPoint,
  hydratePolygons,
  nearestCatalogCity,
  sampleGrid,
  residentialFeatures,
  measureResidentialFeature,
  type PolygonFeature,
} from '../coverage';
import { readCityData } from '../data-files';
import type { CityCatalog } from '../catalog';

const output = path.resolve('output/neighbourhood-cities');
const catalog = JSON.parse(fs.readFileSync(path.join(output, 'candidate-catalog.json'), 'utf8')) as CityCatalog;
const evidence = readCityData<{ features: PolygonFeature[] }>('neighbourhoods/builtup-evidence.geojson.gz');
const rawDistricts = readCityData<{
  features: Array<PolygonFeature & { properties: { adm2_pcode: string; adm2_name: string } }>;
}>('neighbourhoods/ocha-cod-ab/egy_admin2.geojson.gz');
const districts = hydratePolygons({
  metadata: { reviewed: true, notes: 'Authoritative OCHA P-code geometry' },
  sourcePath: 'neighbourhoods/ocha-cod-ab/egy_admin2.geojson.gz',
  ochaLevel: 2,
  features: [],
}).features;
const sourceTags = new Map<string, Record<string, string>>();
for (const region of ['greater-cairo', 'alexandria', 'port-said-region']) {
  const source = readCityData<{ elements: Array<{ type: string; id: number; tags?: Record<string, string> }> }>(
    `neighbourhoods/${region}-residential.json.gz`,
  );
  for (const feature of source.elements) sourceTags.set(`OSM:${feature.type}/${feature.id}`, feature.tags ?? {});
}
const research = readCityData<Record<string, { research: string; whyNoName: string }>>(
  'neighbourhoods/research-blocks/feature-notes.json.gz',
);
const byCode = new Map(catalog.records.map((row) => [row.sourceCode, row]));
const decisions = new Map(
  readCityData<Array<{ sourceCode: string; decision: string; rule: string }>>(
    'neighbourhoods/reviewed-decisions.json.gz',
  ).map((row) => [row.sourceCode, row]),
);
const bounds = (feature: PolygonFeature) => {
  const vertices =
    feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
  return [
    Math.min(...vertices.map((p) => p[0])),
    Math.min(...vertices.map((p) => p[1])),
    Math.max(...vertices.map((p) => p[0])),
    Math.max(...vertices.map((p) => p[1])),
  ];
};
const indexedDistricts = districts.map((feature) => ({ feature, bounds: bounds(feature) }));
const containing = (point: [number, number]) =>
  indexedDistricts.find(
    ({ feature, bounds: [west, south, east, north] }) =>
      point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north && containsPoint(point, feature),
  )?.feature.properties.districtSourceCode ?? 'NO_ADM2_POLYGON';
const areaKm2 = (feature: PolygonFeature) => {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const rad = Math.PI / 180;
  const ringArea = (ring: [number, number][]) => {
    let sum = 0;
    for (let i = 1; i < ring.length; i++)
      sum += (ring[i][0] - ring[i - 1][0]) * rad * (Math.sin(ring[i][1] * rad) + Math.sin(ring[i - 1][1] * rad));
    return (Math.abs(sum) * 6371008.8 ** 2) / 2e6;
  };
  return polygons.reduce(
    (total, rings) => total + ringArea(rings[0]) - rings.slice(1).reduce((n, r) => n + ringArea(r), 0),
    0,
  );
};
const totals = new Map<string, { samples: number; gaps: number }>();
const grouped = new Map<string, { area: string; district: string; samples: number; features: Set<string> }>();
const features: Array<{
  id: string;
  area: string;
  centre: [number, number];
  areaKm2: number;
  samples: number;
  gapSamples: number;
  worstGapKm: number;
  nearestAtWorst: string;
  nearestAtCentre: string;
  centreDistanceKm: number;
  tags: Record<string, string>;
  identification: string;
  missingNameReason: string;
  evidence: string;
}> = [];
let index = 0;
for (const feature of residentialFeatures({ ...evidence, metadata: { reviewed: true, notes: 'Residential only' } })) {
  const area = feature.properties.area!;
  const identity =
    feature.properties.evidence?.match(/OSM:(?:node|way|relation)\/\d+|OCHA ADM3 \w+/)?.[0] ?? `feature-${index}`;
  const uniqueKey = `${index++}:${identity}`;
  const total = totals.get(area) ?? { samples: 0, gaps: 0 };
  const points = sampleGrid(feature);
  total.samples += points.length;
  let gapSamples = 0;
  let worstGapKm = 0;
  let nearestAtWorst = '';
  const credited = measureResidentialFeature(feature, catalog.records).containedCity;
  for (const point of credited ? [] : points) {
    const nearest = nearestCatalogCity(point, catalog.records);
    if (nearest.meters <= 1500) continue;
    gapSamples++;
    total.gaps++;
    if (nearest.meters / 1000 > worstGapKm) {
      worstGapKm = nearest.meters / 1000;
      nearestAtWorst = nearest.city.sourceCode;
    }
    const district = containing(point);
    const key = `${area}:${district}`;
    const summary = grouped.get(key) ?? { area, district, samples: 0, features: new Set<string>() };
    summary.samples++;
    summary.features.add(uniqueKey);
    grouped.set(key, summary);
  }
  totals.set(area, total);
  if (!gapSamples) continue;
  const [west, south, east, north] = bounds(feature);
  const centre: [number, number] = [(west + east) / 2, (south + north) / 2];
  const nearest = nearestCatalogCity(centre, catalog.records);
  const tags = sourceTags.get(identity) ?? {};
  const name = tags['name:en'] || tags['name:ar'] || tags.name;
  const containedNames = catalog.records
    .filter((city) => containsPoint([city.longitude, city.latitude], feature))
    .map((city) => `${city.nameEnglish} (${city.sourceCode})`)
    .slice(0, 6);
  const identification = name
    ? `Source-named residential feature: ${name}`
    : identity.startsWith('OCHA')
      ? 'Populated ADM3 administrative extent; includes land beyond individual settlements.'
      : containedNames.length
        ? `Unnamed residential extent containing: ${containedNames.join('; ')}. These do not establish the whole development's name.`
        : 'Unnamed residential extent; no named official City point inside this footprint.';
  features.push({
    id: identity,
    area,
    centre,
    areaKm2: areaKm2(feature),
    samples: points.length,
    gapSamples,
    worstGapKm,
    nearestAtWorst,
    nearestAtCentre: nearest.city.sourceCode,
    centreDistanceKm: nearest.meters / 1000,
    tags,
    identification,
    missingNameReason:
      research[identity]?.whyNoName ??
      (name
        ? decisions.get(identity)?.decision === 'exclude'
          ? `Source record was excluded by ${decisions.get(identity)!.rule}; see the reviewed decision for duplicate/noise classification. No corroborated additional settlement name is available for the uncovered extent. Evidence geometry is retained.`
          : 'A source name exists; the remaining gap is spatial extent beyond the available representative points. Do not manufacture extra place names.'
        : identity.startsWith('OCHA')
          ? 'Administrative label is available, but the snapshot supplies no names for every farm/water/desert portion of the unit.'
          : 'Raw residential feature has no name. No corroborated development name in the committed evidence; see the recorded research notes. No speculative name assigned.'),
    evidence: feature.properties.evidence ?? '',
  });
}
const gate = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8')) as {
  areas: Array<{ area: string; grid: { samples: number; gapCount: number } }>;
};
for (const area of gate.areas) {
  const actual = totals.get(area.area);
  if (!actual || actual.samples !== area.grid.samples || actual.gaps !== area.grid.gapCount)
    throw new Error(
      `Diagnostic grid differs from release gate for ${area.area}; regenerate the candidate and report first.`,
    );
}
const summaries = [...grouped.values()].map((row) => ({ ...row, features: row.features.size }));
const top40 = features
  .filter((f) => f.id.startsWith('OSM:'))
  .sort((a, b) => b.areaKm2 - a.areaKm2)
  .slice(0, 40);
const lines = [
  '# Remaining grid gaps — offline source review',
  '',
  'Residential-only evidence, within 1.5 km OR a contained OFFICIAL City; lead correction 2026-11-10. Live research and failed Overpass attempts are cached in the manifest. See residential-grid-review.json for exceptions and research-blocks/feature-notes.json.gz for individual notes.',
  '',
  'Uses the release gate’s exact 500 m sampleGrid, great-circle nearest calculation and current OFFICIAL candidate. Counts must agree with report.json. District allocation is point-in-polygon against all 365 OCHA ADM2 units, including Zemam Out. A straddling feature counts once in each district with a gap sample; sample counts are additive. Centres are derived bounding-box centres of the clipped evidence, not claimed settlement coordinates. Areas are spherical polygon estimates with holes subtracted.',
  '',
  '| Coverage area | All samples | Uncovered samples | Uncovered features |',
  '| --- | ---: | ---: | ---: |',
];
for (const [area, row] of totals)
  lines.push(`| ${area} | ${row.samples} | ${row.gaps} | ${features.filter((f) => f.area === area).length} |`);
lines.push(
  '',
  '| Coverage area | ADM2 / district | Uncovered features | Uncovered samples |',
  '| --- | --- | ---: | ---: |',
);
for (const row of summaries.sort((a, b) => a.area.localeCompare(b.area) || b.samples - a.samples)) {
  const name =
    byCode.get(row.district)?.nameEnglish ??
    rawDistricts.features.find((f) => f.properties.adm2_pcode === row.district)?.properties.adm2_name ??
    '';
  lines.push(`| ${row.area} | ${row.district} / ${name} | ${row.features} | ${row.samples} |`);
}
lines.push('', '## Forty largest remaining OSM residential extents', '');
for (const [n, feature] of top40.entries())
  lines.push(
    `### ${n + 1}. ${feature.id} — ${feature.area}`,
    '',
    `Centre (lat, lon): ${feature.centre[1]}, ${feature.centre[0]}; area ${feature.areaKm2.toFixed(3)} km²; ${feature.gapSamples}/${feature.samples} samples uncovered.`,
    `Nearest to centre: ${byCode.get(feature.nearestAtCentre)?.nameEnglish} (${feature.nearestAtCentre}), ${feature.centreDistanceKm.toFixed(3)} km. Worst gap: ${feature.worstGapKm.toFixed(3)} km, nearest ${byCode.get(feature.nearestAtWorst)?.nameEnglish} (${feature.nearestAtWorst}).`,
    `Original tags: ${JSON.stringify(feature.tags)}`,
    `Identification: ${feature.identification}`,
    `Why unresolved: ${feature.missingNameReason}`,
    `Source: ${feature.evidence}; original tags/geometry in the checked residential snapshot.`,
    '',
  );
fs.writeFileSync(path.join(output, 'grid-gap-review.md'), lines.join('\n') + '\n');
fs.writeFileSync(
  path.join(output, 'grid-gap-review.json'),
  JSON.stringify({ totals: Object.fromEntries(totals), districts: summaries, top40, features }, null, 2) + '\n',
);
console.log(
  `${features.length} uncovered features reviewed; top 40 OSM extents and ADM2 sample totals written to ${output}/grid-gap-review.md`,
);
