import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { findForbiddenGlossaryTerms } = require('../../../scripts/glossary-conformance.cjs');
const adminServiceSrcDir = path.resolve(__dirname, '..');
const adminServiceTestDir = path.resolve(__dirname, '../../test');

function getSourceFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        getSourceFiles(fullPath, fileList);
      }
    } else if (/\.(js|jsx|json|css|md)$/.test(entry.name) && !entry.name.endsWith('.png')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Domain Glossary & Mapped Location Conformance', () => {
  it('ensures no forbidden domain terms exist in admin-service source and test files', () => {
    const files = [...getSourceFiles(adminServiceSrcDir), ...getSourceFiles(adminServiceTestDir)];
    const violations = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      for (const violation of findForbiddenGlossaryTerms(lines)) {
        violations.push({
          file: path.relative(path.resolve(__dirname, '../../..'), file),
          ...violation,
        });
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found forbidden glossary terms in admin-service:\n${violations
        .map((v) => `  ${v.file}:${v.line} -> forbidden "${v.term}": ${v.content}`)
        .join('\n')}`,
    );
  });

  it('detects glossary-forbidden City synonyms in identifier forms with actionable diagnostics', () => {
    const forbiddenTerm = ['City', 'record'].join(' ');
    const variants = [
      'City' + ' record',
      ['city', 'Record'].join(''),
      ['City', 'Record'].join(''),
      ['city', 'record'].join('_'),
      ['city', 'record'].join('-'),
    ];

    for (const variant of variants) {
      assert.deepEqual(findForbiddenGlossaryTerms([`const ${variant} = true;`]), [
        { line: 1, term: forbiddenTerm, content: `const ${variant} = true;` },
      ]);
    }
  });

  it('ensures Mapped Location UI components and resources use canonical domain vocabulary', () => {
    const editComponentPath = path.join(__dirname, 'components/mapped-location-edit-component.jsx');
    const showComponentPath = path.join(__dirname, 'components/mapped-location-show-component.jsx');
    const vetClinicsResourcePath = path.join(__dirname, 'resources/vet-clinics.resource.js');

    const editContent = fs.readFileSync(editComponentPath, 'utf8');
    const showContent = fs.readFileSync(showComponentPath, 'utf8');
    const vetClinicsContent = fs.readFileSync(vetClinicsResourcePath, 'utf8');

    // Mapped Location titles
    assert.match(editContent, /Mapped Location & Addresses/);
    assert.match(showContent, /Mapped Location/);

    // Canonical confirmation checkbox
    assert.match(editContent, /I confirm this mapped location and bilingual address are accurate for this clinic\./);

    // Canonical override section & centroid explanation
    assert.match(editContent, /City Disagreement Override/);
    assert.match(editContent, /City representative points are approximate\s+centroids/);

    // WGS84 coordinate labels
    assert.match(editContent, /Latitude \(WGS84\)/);
    assert.match(editContent, /Longitude \(WGS84\)/);

    // Vet clinics resource coordinates components binding
    assert.match(vetClinicsContent, /MappedLocationEdit/);
    assert.match(vetClinicsContent, /MappedLocationShow/);
  });
});
