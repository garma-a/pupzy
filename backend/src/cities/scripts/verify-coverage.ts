import * as fs from 'fs';
import * as path from 'path';
import { loadOfficialCatalog, type CityCatalog } from '../catalog';
import { verifyCoverage, type Polygons, type IndependentNames, type GpsChecks } from '../coverage';

const data = path.resolve(__dirname, '../data/neighbourhoods');
function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(data, file), 'utf8')) as T;
}
const catalogPath = process.argv[2];
const catalog = catalogPath ? (JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CityCatalog) : loadOfficialCatalog();
const report = verifyCoverage(
  catalog,
  read<Polygons>('coverage-polygons.geojson'),
  read<Polygons>('governorate-boundaries.geojson'),
  read<Polygons>('district-boundaries.geojson'),
  read<IndependentNames>('independent-names.json'),
  read<GpsChecks>('gps-checks.json'),
);
const out = path.resolve(process.cwd(), 'output/neighbourhood-cities');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const text = [
  '# Neighbourhood coverage — ' + (report.passed ? 'PASS' : 'FAIL / NOT MERGEABLE'),
  '',
  `Structural quality: ${report.structuralValidation.isValid ? 'PASS' : 'FAIL'}. Geographic data quality: ${report.dataQuality.passed ? 'PASS' : 'FAIL'} (${report.dataQuality.errors.length} errors).`,
  ...report.areas.flatMap((a) => [
    '',
    `## ${a.area}`,
    `Grid: ${a.grid.passed ? 'PASS' : 'FAIL'} — ${a.grid.samples} samples, ${a.grid.gapCount} measured gaps. ${a.grid.reason ?? ''}`,
    `Names: ${a.names.passed ? 'PASS' : 'FAIL'} — ${a.names.entries} entries / ${a.names.distinctNames} distinct Arabic names; ${a.names.missingNames.length}/${a.names.variants} unmatched variants.`,
    `GPS: ${a.gps.passed ? 'PASS' : 'FAIL'} — ${a.gps.checks}/30 independent coordinates.`,
    'Missing: ' + a.names.missingNames.join(', '),
    'Worst measured gaps: ' + JSON.stringify(a.grid.worstGaps),
  ]),
].join('\n');
fs.writeFileSync(path.join(out, 'report.md'), text + '\n');
console.log(text);
process.exitCode = report.passed ? 0 : 1;
