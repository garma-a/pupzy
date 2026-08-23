import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'graphql';
import type { EnumTypeDefinitionNode } from 'graphql';

/**
 * `PostType` is declared in two separate SDL files in this codebase
 * (a pre-existing duplication — see src/common/graphql/enums.graphql and
 * src/posts/posts-enums.graphql). NestJS merges them at boot, but nothing
 * enforces that they stay in sync. If they ever drift, a post of the
 * type missing from one copy will fail non-null enum serialization the
 * moment it appears in ANY feed that doesn't filter by post type
 * (e.g. homeFeed) — nulling out that entire response for every viewer,
 * not just the offending post. This test catches that drift directly,
 * with no database or running app required.
 */
function extractEnumValues(filePath: string, enumName: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const doc = parse(source);
  const enumNode = doc.definitions.find(
    (d): d is EnumTypeDefinitionNode => d.kind === 'EnumTypeDefinition' && d.name.value === enumName,
  );
  if (!enumNode) {
    throw new Error(`enum ${enumName} not found in ${filePath}`);
  }
  return (enumNode.values ?? []).map((v) => v.name.value).sort();
}

describe('PostType GraphQL enum consistency (regression guard)', () => {
  const POSTS_ENUMS_FILE = path.join(__dirname, '../../posts/posts-enums.graphql');
  const COMMON_ENUMS_FILE = path.join(__dirname, 'enums.graphql');

  const KNOWN_POST_TYPES = ['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT', 'MATING'];

  it('is defined with the exact same values in both SDL files that declare it', () => {
    const valuesInPostsFile = extractEnumValues(POSTS_ENUMS_FILE, 'PostType');
    const valuesInCommonFile = extractEnumValues(COMMON_ENUMS_FILE, 'PostType');
    expect(valuesInPostsFile).toEqual(valuesInCommonFile);
  });

  it('includes every known post type in both files, including MATING', () => {
    const valuesInPostsFile = extractEnumValues(POSTS_ENUMS_FILE, 'PostType');
    const valuesInCommonFile = extractEnumValues(COMMON_ENUMS_FILE, 'PostType');
    expect(valuesInPostsFile.sort()).toEqual([...KNOWN_POST_TYPES].sort());
    expect(valuesInCommonFile.sort()).toEqual([...KNOWN_POST_TYPES].sort());
  });
});
