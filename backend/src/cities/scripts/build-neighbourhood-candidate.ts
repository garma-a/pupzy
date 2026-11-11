import * as fs from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import type { Polygons, IndependentNames, GpsChecks } from '../coverage';
import { loadRawSnapshot, transformCatalog, validateCatalog } from '../catalog';
import type { NeighbourhoodSources, PlaceDecision } from '../neighbourhoods';
import { readCityData } from '../data-files';

const evidenceReference = <T extends IndependentNames | GpsChecks>(file: string): T => {
  const sourcePath = 'neighbourhoods/' + file;
  const input = readCityData<T>(sourcePath);
  return {
    ...input,
    sourcePath,
    sha256: createHash('sha256')
      .update(fs.readFileSync(path.resolve('src/cities/data', sourcePath)))
      .digest('hex'),
    metadata: input.metadata,
    areas: { 'greater-cairo': [], alexandria: [], 'port-said-region': [] },
  };
};
const sources = readCityData<NeighbourhoodSources>('neighbourhoods/reviewed-overrides.json');
const reference = (file: string, notes: string, level?: 1 | 2): Polygons => ({
  metadata: {
    reviewed: level
      ? true
      : readCityData<{ metadata: Polygons['metadata'] }>('neighbourhoods/' + file).metadata.reviewed,
    notes,
  },
  sourcePath: 'neighbourhoods/' + file,
  sha256: createHash('sha256')
    .update(fs.readFileSync(path.resolve(process.cwd(), 'src/cities/data/neighbourhoods', file)))
    .digest('hex'),
  ochaLevel: level,
  ...(level
    ? {
        replacements: {
          sourcePath: 'neighbourhoods/reviewed-boundary-replacements.geojson.gz',
          sha256: createHash('sha256')
            .update(
              fs.readFileSync(path.resolve('src/cities/data/neighbourhoods/reviewed-boundary-replacements.geojson.gz')),
            )
            .digest('hex'),
        },
      }
    : {}),
  features: [],
});
const districtSnapshot = loadRawSnapshot();
const snapshot = {
  ...districtSnapshot,
  metadata: {
    ...districtSnapshot.metadata,
    source: districtSnapshot.metadata.source + '; OpenStreetMap; Wikidata',
    license: 'CC BY-IGO; ODbL 1.0; CC0',
    attribution: districtSnapshot.metadata.attribution + '; © OpenStreetMap contributors; Wikidata contributors',
  },
  neighbourhoods: sources,
  coverageEvidence: {
    residential: reference(
      'builtup-evidence.geojson.gz',
      'Clipped OSM landuse=residential only; lead decision 2026-11-10.',
    ),
    governorates: reference('ocha-cod-ab/egy_admin1.geojson.gz', 'Authoritative OCHA ADM1 exact P-code polygons.', 1),
    districts: reference(
      'ocha-cod-ab/egy_admin2.geojson.gz',
      'Authoritative OCHA ADM2 exact P-code polygons, including Zemam Out for explicit exception validation.',
      2,
    ),
    names: evidenceReference<IndependentNames>('independent-names.json'),
    gps: evidenceReference<GpsChecks>('gps-checks.json'),
    headlines: {
      sourcePath: 'neighbourhoods/headline-names.json',
      sha256: createHash('sha256')
        .update(fs.readFileSync('src/cities/data/neighbourhoods/headline-names.json'))
        .digest('hex'),
      entries: [] as Array<[string, string, string]>,
    },
  },
};
const catalog = transformCatalog(snapshot);
const validation = validateCatalog(catalog);
if (!validation.isValid) throw new Error(validation.errors.join('\n'));
const output = path.resolve(process.cwd(), 'output/neighbourhood-cities');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'candidate-snapshot.json'), JSON.stringify(snapshot) + '\n');
fs.writeFileSync(path.join(output, 'candidate-catalog.json'), JSON.stringify(catalog) + '\n');
const decisions = sources.decisionsFile
  ? readCityData<PlaceDecision[]>(sources.decisionsFile, sources.sourceDigests?.[sources.decisionsFile])
  : sources.decisions;
console.log(
  `${catalog.records.length} official Cities; ${decisions.filter((d) => !d.reviewed).length} decisions awaiting review. Candidate only; publication requires every gate.`,
);
