import * as fs from 'fs';
import { readCityData } from '../data-files';
import { measureResidentialFeature, residentialFeatures, Polygons, COVERAGE_AREAS } from '../coverage';
import { CityCatalog } from '../catalog';
const catalog = JSON.parse(
  fs.readFileSync(process.argv[2] ?? 'output/neighbourhood-cities/candidate-catalog.json', 'utf8'),
) as CityCatalog;
const raw = readCityData<Polygons>('neighbourhoods/builtup-evidence.geojson.gz');
const data = residentialFeatures(raw);
const rows = data.map((f) => ({ f, ...measureResidentialFeature(f, catalog.records) }));
const gaps = rows
  .filter((r) => r.gaps.length)
  .map(({ f, gaps }) => ({
    osmSourceCode: f.properties.osmSourceCode,
    area: f.properties.area,
    centre: f.properties.samplePoint,
    uncoveredSamples: gaps.length,
    worstDistanceMeters: gaps[0].meters,
    nearestCity: gaps[0].nearest,
  }));
fs.writeFileSync(
  'output/neighbourhood-cities/residential-baseline.json',
  JSON.stringify(
    {
      areas: COVERAGE_AREAS.map((area) => {
        const items = rows.filter((r) => r.f.properties.area === area);
        const samples = items.reduce((s, r) => s + r.samples.length, 0);
        const uncovered = items.reduce((s, r) => s + r.gaps.length, 0);
        return { area, samples, uncovered, share: 1 - uncovered / samples };
      }),
      gaps,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      areas: COVERAGE_AREAS.map((area) => {
        const items = rows.filter((r) => r.f.properties.area === area);
        const samples = items.reduce((s, r) => s + r.samples.length, 0);
        const uncovered = items.reduce((s, r) => s + r.gaps.length, 0);
        return { area, samples, uncovered, share: 1 - uncovered / samples };
      }),
      features: gaps.length,
      far: gaps.filter((g) => g.worstDistanceMeters > 4000).length,
    },
    null,
    2,
  ),
);
