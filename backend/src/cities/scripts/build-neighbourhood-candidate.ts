import * as fs from 'fs';
import * as path from 'path';
import type { Polygons, IndependentNames, GpsChecks } from '../coverage';
import { loadRawSnapshot, transformCatalog, validateCatalog } from '../catalog';
import type { NeighbourhoodSources, OsmElement, SourceSnapshot } from '../neighbourhoods';

// Offline only. Fetching is an explicit maintainer operation documented in the runbook.
const directory = path.resolve(__dirname, '../data/neighbourhoods');
const sources = JSON.parse(
  fs.readFileSync(path.join(directory, 'reviewed-overrides.json'), 'utf8'),
) as NeighbourhoodSources;
const elements: OsmElement[] = [];
for (const area of ['greater-cairo', 'alexandria', 'port-said-region']) {
  const file = path.join(directory, `${area}-places.json`);
  if (fs.existsSync(file)) {
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as SourceSnapshot<{ elements: OsmElement[] }>;
    if (
      !snapshot.metadata?.retrievalDate ||
      !snapshot.metadata.license ||
      !snapshot.metadata.attribution ||
      !snapshot.response?.elements
    )
      throw new Error(`Missing provenance/response: ${file}`);
    elements.push(...snapshot.response.elements);
  }
}
// Preserve complete per-source envelopes as well as the combined view in the release snapshot.
const rawSnapshots = ['greater-cairo', 'alexandria', 'port-said-region'].flatMap((a) => {
  const file = path.join(directory, `${a}-places.json`);
  return fs.existsSync(file)
    ? [JSON.parse(fs.readFileSync(file, 'utf8')) as SourceSnapshot<{ elements: OsmElement[] }>]
    : [];
});
if (rawSnapshots.length)
  sources.overpass = {
    metadata: rawSnapshots[0].metadata,
    response: { elements: [...new Map(elements.map((e) => [`${e.type}/${e.id}`, e])).values()] },
  };
const wd = path.join(directory, 'wikidata.json');
if (fs.existsSync(wd)) sources.wikidata = JSON.parse(fs.readFileSync(wd, 'utf8')) as NeighbourhoodSources['wikidata'];
function evidence<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as T;
}
const snapshot = {
  ...loadRawSnapshot(),
  neighbourhoods: sources,
  rawPlaceSnapshots: rawSnapshots,
  coverageEvidence: {
    residential: evidence<Polygons>('coverage-polygons.geojson'),
    governorates: evidence<Polygons>('governorate-boundaries.geojson'),
    districts: evidence<Polygons>('district-boundaries.geojson'),
    names: evidence<IndependentNames>('independent-names.json'),
    gps: evidence<GpsChecks>('gps-checks.json'),
  },
};
const catalog = transformCatalog(snapshot);
const validation = validateCatalog(catalog);
if (!validation.isValid) throw new Error(validation.errors.join('\n'));
const output = path.resolve(process.cwd(), 'output/neighbourhood-cities');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'candidate-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'candidate-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
const reviewed = new Set(sources.decisions.filter((d) => d.reviewed).map((d) => d.sourceCode));
fs.writeFileSync(
  path.join(output, 'unreviewed-osm.json'),
  JSON.stringify(
    elements.filter((e) => !reviewed.has(`OSM:${e.type}/${e.id}`)),
    null,
    2,
  ),
);
console.log(
  `${catalog.records.length} official Cities; ${sources.decisions.filter((d) => !d.reviewed).length} pending curated decisions; ${elements.filter((e) => !reviewed.has(`OSM:${e.type}/${e.id}`)).length} unreviewed OSM elements. Candidate only; run cities:verify-coverage before publishing.`,
);
