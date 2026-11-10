/** Offline draft only. Reviewing/copying this output is a deliberate maintainer action. */
import * as fs from 'fs';
import * as path from 'path';
import type { CityCatalog } from '../catalog';
import {
  COVERAGE_AREAS,
  measureResidentialFeature,
  residentialFeatures,
  type Polygons,
  type GridException,
} from '../coverage';
import { readCityData } from '../data-files';

const catalog = JSON.parse(
  fs.readFileSync(process.argv[2] ?? 'output/neighbourhood-cities/candidate-catalog.json', 'utf8'),
) as CityCatalog;
const evidence = residentialFeatures(readCityData<Polygons>('neighbourhoods/builtup-evidence.geojson.gz'));
const notesPath = path.resolve('src/cities/data/neighbourhoods/research-blocks/feature-notes.json');
const notes = fs.existsSync(notesPath)
  ? (JSON.parse(fs.readFileSync(notesPath, 'utf8')) as Record<
      string,
      {
        research: string;
        whyNoName: string;
        individualResearch?: string;
      }
    >)
  : {};
const measured = evidence.map((feature) => ({ feature, ...measureResidentialFeature(feature, catalog.records) }));
const exceptions: GridException[] = measured
  .filter((m) => m.gaps.length)
  .map(({ feature, gaps }) => {
    const id = feature.properties.osmSourceCode!;
    const note = notes[id];
    return {
      osmSourceCode: id,
      area: feature.properties.area!,
      centre: feature.properties.samplePoint!,
      uncoveredSamples: gaps.length,
      worstDistanceMeters: gaps[0].meters,
      nearestCity: gaps[0].nearest,
      research: note?.research ?? 'PENDING individual source review',
      whyNoName: note?.whyNoName ?? 'PENDING; do not approve this draft',
      individualResearch: note?.individualResearch,
    };
  });
const areas = COVERAGE_AREAS.map((area) => {
  const rows = measured.filter((m) => m.feature.properties.area === area);
  const samples = rows.reduce((n, m) => n + m.samples.length, 0);
  const uncovered = rows.reduce((n, m) => n + m.gaps.length, 0);
  const share = 1 - uncovered / samples;
  return { area, samples, uncovered, share, floor: Math.floor((share + 1e-12) * 200) / 200 };
});
const draft = {
  reviewed: false,
  decisionDate: '2026-11-10',
  method:
    'OSM residential only. 500 m centred cells, interior point fallback for tiny footprints. Within 1.5 km OR contained OFFICIAL City. Floors rounded down to 0.5%.',
  measurements: areas,
  floors: Object.fromEntries(areas.map((a) => [a.area, a.floor])),
  exceptions,
};
fs.writeFileSync(
  'output/neighbourhood-cities/proposed-residential-grid-review.json',
  JSON.stringify(draft, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    areas,
    features: exceptions.length,
    far: exceptions.filter((e) => e.worstDistanceMeters > 4000).length,
    missingNotes: exceptions.filter((e) => !notes[e.osmSourceCode]).length,
  }),
);
