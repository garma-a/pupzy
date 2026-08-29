import * as fs from 'fs';
import * as path from 'path';

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

function getSourceFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        getSourceFiles(fullPath, fileList);
      }
    } else if (/\.(ts|js|json|graphql)$/.test(entry.name) && !entry.name.endsWith('.snapshot.json')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Domain Glossary & Vocabulary Conformance', () => {
  it('ensures no forbidden domain terms exist in NestJS backend source and test files', () => {
    const srcDir = path.resolve(__dirname, '..');
    const testDir = path.resolve(__dirname, '../../test');
    const files = [...getSourceFiles(srcDir), ...getSourceFiles(testDir)];
    const violations: { file: string; line: number; term: string; content: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (file.endsWith('glossary-conformance.spec.ts') && line.includes('pattern:')) {
          continue;
        }

        for (const { term, pattern } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(path.resolve(__dirname, '../..'), file),
              line: i + 1,
              term,
              content: line.trim(),
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('validates CONTEXT.md definitions exist for core domain concepts', () => {
    const contextPath = path.resolve(__dirname, '../../CONTEXT.md');
    const contextContent = fs.readFileSync(contextPath, 'utf8');

    expect(contextContent).toContain('**City**:');
    expect(contextContent).toContain('**Mapped Location**:');
    expect(contextContent).toContain('**Imported Vet Clinic**:');
    expect(contextContent).toContain('**Post**:');
    expect(contextContent).toContain('**Home Feed**:');
    expect(contextContent).toContain('**Removed Post**:');
    expect(contextContent).toContain('**Staged Upload**:');
  });
});
