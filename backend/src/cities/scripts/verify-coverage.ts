import * as fs from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { loadOfficialCatalog, loadReleaseSnapshot, type CityCatalog } from '../catalog';
import { verifyCoverage, type Polygons, type IndependentNames, type GpsChecks } from '../coverage';
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
const catalogPath = process.argv[2];
const catalog = catalogPath ? (JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CityCatalog) : loadOfficialCatalog();
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
const evidence = catalogPath
  ? {
      residential: reference(
        'builtup-evidence.geojson.gz',
        'Clipped OSM landuse=residential only; lead decision 2026-11-10.',
      ),
      governorates: reference('ocha-cod-ab/egy_admin1.geojson.gz', 'OCHA ADM1', 1),
      districts: reference('ocha-cod-ab/egy_admin2.geojson.gz', 'OCHA ADM2', 2),
      names: evidenceReference<IndependentNames>('independent-names.json'),
      gps: evidenceReference<GpsChecks>('gps-checks.json'),
      headlines: {
        sourcePath: 'neighbourhoods/headline-names.json',
        sha256: createHash('sha256')
          .update(fs.readFileSync('src/cities/data/neighbourhoods/headline-names.json'))
          .digest('hex'),
        entries: [] as Array<[string, string, string]>,
      },
    }
  : loadReleaseSnapshot().coverageEvidence;
if (!evidence) throw new Error('No release coverage evidence');
const report = verifyCoverage(
  catalog,
  evidence.residential,
  evidence.governorates,
  evidence.districts,
  evidence.names,
  evidence.gps,
  evidence.headlines,
);
const out = path.resolve(process.cwd(), 'output/neighbourhood-cities');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const lines = [
  '# Neighbourhood coverage — ' + (report.passed ? 'PASS' : 'FAIL / NOT MERGEABLE'),
  '',
  `Headlines: ${report.headlines?.matched ?? 0}/${report.headlines?.total ?? 0}.`,
  `Structural quality: ${report.structuralValidation.isValid ? 'PASS' : 'FAIL'}. Geographic quality: ${report.dataQuality.passed ? 'PASS' : 'FAIL'} (${report.dataQuality.errors.length} errors).`,
];
for (const a of report.areas) {
  const text = [
    `## ${a.area}`,
    `Grid: ${a.grid.passed ? 'PASS' : 'FAIL'} — ${a.grid.samples} samples; ${a.grid.gapCount} uncovered; ${(a.grid.coverageShare * 100).toFixed(3)}% covered; floor ${a.grid.floor === undefined ? 'unreviewed' : (a.grid.floor * 100).toFixed(1) + '%'}; ${a.grid.unreviewedFeatures.length} unreviewed features.`,
    `Names: ${a.names.passed ? 'PASS' : 'FAIL'} — ${a.names.distinctNames} distinct (reviewed minimum ${a.names.minimum ?? 'missing'}); ${a.names.missingNames.length}/${a.names.variants} unmatched variants; ${a.names.knownMissingVariants} individually reviewed; ${a.names.unreviewedMissingNames.length} unreviewed.`,
    `GPS: ${a.gps.passed ? 'PASS' : 'FAIL'} — ${a.gps.checks} checks; ${a.gps.checks - a.gps.failures.length} passed; ${a.gps.failures.length} individually reviewed failures.`,
    'Worst gaps: ' + JSON.stringify(a.grid.worstGaps),
    'Missing names: ' + a.names.missingNames.join(', '),
  ].join('\n');
  fs.writeFileSync(path.join(out, a.area + '.md'), text + '\n');
  lines.push('', text);
}
const text = lines.join('\n');
fs.writeFileSync(path.join(out, 'report.md'), text + '\n');
console.log(text);
process.exitCode = report.passed ? 0 : 1;
