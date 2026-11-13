/** Explicit network operation only; build, tests and migration generation are offline. */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { DATA_DIR } from '../catalog';
const endpoint = process.argv[2] ?? 'https://overpass-api.de/api/interpreter';
const queryPath = path.join(__dirname, 'egypt-vets.overpass');
const response = execFileSync(
  'curl',
  ['-sS', '-f', '-m', '220', '-A', 'PupzyDataReview/1.0', '--get', '--data-urlencode', `data@${queryPath}`, endpoint],
  { maxBuffer: 32 * 1024 * 1024 },
);
const parsed = JSON.parse(response.toString()) as { elements?: unknown[]; remark?: string };
if (!parsed.elements || parsed.remark) throw new Error('Incomplete Overpass response: ' + parsed.remark);
const bytes = gzipSync(response, { mtime: 0 } as Parameters<typeof gzipSync>[1]);
fs.writeFileSync(path.join(DATA_DIR, 'osm-egypt.json.gz'), bytes);
fs.writeFileSync(
  path.join(DATA_DIR, 'osm-manifest.json'),
  JSON.stringify(
    {
      endpoint,
      fetchedAt: new Date().toISOString(),
      query: fs.readFileSync(queryPath, 'utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      elements: parsed.elements.length,
      license: 'ODbL 1.0',
      attribution: '© OpenStreetMap contributors',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    },
    null,
    2,
  ) + '\n',
);
