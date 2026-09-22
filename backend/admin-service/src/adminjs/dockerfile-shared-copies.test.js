import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The AdminJS image is built from the repository root and copies the service
 * into `/app`, so shared backend files it imports must be copied to the same
 * `/src/...` path explicitly. This guard catches a new cross-package import
 * before production hits `ERR_MODULE_NOT_FOUND` at boot.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const DOCKERFILE = path.join(PACKAGE_ROOT, 'Dockerfile');

const RELATIVE_IMPORT = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(fullPath));
    else if (/\.jsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

/** Every file under `src/` imported from outside the admin-service package. */
function externalImports() {
  const imports = new Map();
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const resolved = path.resolve(path.dirname(file), match[1]);
      if (resolved.startsWith(PACKAGE_ROOT + path.sep)) continue;
      const repoRelative = path.relative(REPO_ROOT, resolved).split(path.sep).join('/');
      if (!imports.has(repoRelative)) imports.set(repoRelative, new Set());
      imports.get(repoRelative).add(path.relative(PACKAGE_ROOT, file).split(path.sep).join('/'));
    }
  }
  return imports;
}

/** `COPY` sources and destinations declared in the image recipe. */
function copiedIntoImage() {
  return readFileSync(DOCKERFILE, 'utf8')
    .split('\n')
    .map((line) => /^COPY\s+(?:--\S+\s+)*(\S+)\s+(\S+)\s*$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => ({ source: match[1], destination: match[2] }));
}

describe('AdminJS Dockerfile shared-file copies', () => {
  it('copies every file imported from outside the admin-service package', () => {
    const imports = externalImports();
    assert.ok(imports.size > 0, 'expected the service to import shared backend files');

    const copies = copiedIntoImage();
    const missing = [];
    for (const [repoRelative, importers] of imports) {
      assert.ok(existsSync(path.join(REPO_ROOT, repoRelative)), `${repoRelative} is imported but does not exist`);
      const copied = copies.some(
        ({ source, destination }) => source === repoRelative && destination === `/${repoRelative}`,
      );
      if (!copied) {
        missing.push(`${repoRelative} (imported by ${[...importers].sort().join(', ')})`);
      }
    }

    assert.deepEqual(missing, [], `admin-service/Dockerfile must copy:\n${missing.join('\n')}`);
  });
});
