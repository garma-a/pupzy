import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { readCityData } from './data-files';

interface SourceEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
  uncompressedSha256: string;
  uncompressedSizeBytes: number;
  retrievalDate: string;
  license: string;
  attribution: string;
  endpoint: string;
  sourceUrls?: string[];
}

describe('Pinned offline City evidence', () => {
  it('retains one checked compressed copy of every used raw source', () => {
    const manifest = readCityData<{ snapshots: SourceEntry[] }>('neighbourhoods/source-manifest.json');
    expect(manifest.snapshots.filter((s) => !s.path.includes('/research-'))).toHaveLength(14);
    expect(new Set(manifest.snapshots.map((s) => s.path)).size).toBe(manifest.snapshots.length);
    for (const entry of manifest.snapshots) {
      const compressed = fs.readFileSync(path.resolve(process.cwd(), entry.path));
      const raw = gunzipSync(compressed);
      expect(createHash('sha256').update(compressed).digest('hex')).toBe(entry.sha256);
      expect(compressed.length).toBe(entry.sizeBytes);
      expect(createHash('sha256').update(raw).digest('hex')).toBe(entry.uncompressedSha256);
      expect(raw.length).toBe(entry.uncompressedSizeBytes);
      expect(entry.retrievalDate).toBeTruthy();
      expect(entry.license).toBeTruthy();
      expect(entry.attribution).toBeTruthy();
      const urls = /^https?:\/\//.test(entry.endpoint) ? [entry.endpoint] : (entry.sourceUrls ?? []);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => /^https?:\/\//.test(url))).toBe(true);
      // Research includes original HTML, images and failed HTTP responses. The
      // source-point verifier parses every response actually used for a City.
      if (!entry.path.includes('/research-')) expect(() => JSON.parse(raw.toString('utf8')) as unknown).not.toThrow();
    }
  });
  it('rejects a reference whose pinned bytes differ, even if the current manifest accepts the file', () => {
    expect(() => readCityData('neighbourhoods/alexandria-places.json.gz', '0'.repeat(64))).toThrow(
      'artifact checksum mismatch',
    );
  });
});
