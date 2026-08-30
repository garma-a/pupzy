import * as fs from 'fs';
import * as path from 'path';
import { findForbiddenGlossaryTerms } from '../../scripts/glossary-conformance.cjs';

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

      for (const violation of findForbiddenGlossaryTerms(lines)) {
        violations.push({
          file: path.relative(path.resolve(__dirname, '../..'), file),
          ...violation,
        });
      }
    }

    expect(violations).toEqual([]);
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
      expect(findForbiddenGlossaryTerms([`const ${variant} = true;`])).toEqual([
        { line: 1, term: forbiddenTerm, content: `const ${variant} = true;` },
      ]);
    }
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
