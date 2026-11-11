import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';

/** Offline, checked source reader. Source paths are relative to cities/data. */
export function readCityData<T>(filename: string, expectedSha256?: string): T {
  if (path.isAbsolute(filename) || filename.split(/[\\/]/).includes('..')) throw new Error('Invalid City data path');
  const directories = [path.resolve(__dirname, 'data'), path.resolve(process.cwd(), 'src/cities/data')];
  const directory = directories.find((root) => fs.existsSync(path.join(root, filename)));
  if (!directory) throw new Error(`Missing offline City artifact: ${filename}`);
  const file = path.join(directory, filename);
  const bytes = fs.readFileSync(file);
  if (expectedSha256 && createHash('sha256').update(bytes).digest('hex') !== expectedSha256)
    throw new Error(`City artifact checksum mismatch: ${filename}`);
  const manifestPath = path.join(directory, 'neighbourhoods/source-manifest.json');
  if (filename.endsWith('.gz') && fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      snapshots: Array<{ path: string; sha256?: string }>;
    };
    const entry = manifest.snapshots.find((s) => s.path === 'src/cities/data/' + filename);
    if (entry?.sha256 && createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error(`City source checksum mismatch: ${filename}`);
  }
  return JSON.parse((filename.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
}
