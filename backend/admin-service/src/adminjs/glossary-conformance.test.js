import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const adminServiceSrcDir = path.resolve(__dirname, '..');
const adminServiceTestDir = path.resolve(__dirname, '../../test');

const FORBIDDEN_PATTERNS = [
  { term: 'City record', pattern: /\bcity\s+record\b/i },
  { term: 'location entry', pattern: /\blocation\s+entry\b/i },
  { term: 'custom city creation', pattern: /\bcustom\s+city\s+creation\b/i },
  { term: 'operator-created city', pattern: /\boperator-created\s+city\b/i },
  { term: 'Google GPS', pattern: /\bgoogle\s+gps\b/i },
  { term: 'Verified Location', pattern: /\bverified\s+location\b/i },
  { term: 'provider-validated address', pattern: /\bprovider-validated\b/i },
  { term: 'raw coordinates', pattern: /\braw\s+coordinates?\b/i },
  { term: 'Legacy clinic', pattern: /\blegacy\s+clinic\b/i },
  { term: 'unverified clinic', pattern: /\bunverified\s+clinic\b/i },
  { term: 'Hidden Post', pattern: /\bhidden\s+post\b/i },
  { term: 'deleted Post', pattern: /\bdeleted\s+post\b/i },
  { term: 'permanently removed Post', pattern: /\bpermanently\s+removed\s+post\b/i },
];

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

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip self test pattern definitions
        if (file.endsWith('glossary-conformance.test.js') && line.includes('pattern:')) {
          continue;
        }

        for (const { term, pattern } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(path.resolve(__dirname, '../../..'), file),
              line: i + 1,
              term,
              content: line.trim(),
            });
          }
        }
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
