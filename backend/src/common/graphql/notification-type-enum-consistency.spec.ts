import * as fs from 'fs';
import * as path from 'path';
import { parse, Kind } from 'graphql';
import type { EnumTypeDefinitionNode } from 'graphql';
import { notificationTypeEnum } from '../../database/schema/enums';

/**
 * `NotificationType` is declared in two separate SDL files
 * (src/common/graphql/enums.graphql and src/posts/posts-enums.graphql) and the
 * persisted union lives in the Drizzle `notification_type` enum. Nothing else
 * enforces that all three agree, and a persisted value missing from the SDL
 * makes `myNotifications` fail non-null enum serialization for the whole
 * response the moment that value appears in an inbox. This guard catches the
 * drift without a database or running app.
 */
function extractEnumValues(filePath: string, enumName: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const doc = parse(source);
  const enumNode = doc.definitions.find(
    (d): d is EnumTypeDefinitionNode => d.kind === Kind.ENUM_TYPE_DEFINITION && d.name.value === enumName,
  );
  if (!enumNode) {
    throw new Error(`enum ${enumName} not found in ${filePath}`);
  }
  return (enumNode.values ?? []).map((v) => v.name.value).sort();
}

describe('NotificationType GraphQL enum consistency (regression guard)', () => {
  const POSTS_ENUMS_FILE = path.join(__dirname, '../../posts/posts-enums.graphql');
  const COMMON_ENUMS_FILE = path.join(__dirname, 'enums.graphql');

  it('is defined with the exact same values in both SDL files that declare it', () => {
    expect(extractEnumValues(POSTS_ENUMS_FILE, 'NotificationType')).toEqual(
      extractEnumValues(COMMON_ENUMS_FILE, 'NotificationType'),
    );
  });

  it('exposes every persisted notification type to GraphQL clients', () => {
    const valuesInPostsFile = extractEnumValues(POSTS_ENUMS_FILE, 'NotificationType');
    const valuesInCommonFile = extractEnumValues(COMMON_ENUMS_FILE, 'NotificationType');
    for (const value of notificationTypeEnum.enumValues) {
      expect(valuesInPostsFile).toContain(value);
      expect(valuesInCommonFile).toContain(value);
    }
  });

  it('exposes the administrator Post Resolution notification introduced with ticket 08', () => {
    expect(extractEnumValues(POSTS_ENUMS_FILE, 'NotificationType')).toContain('POST_RESOLVED_BY_ADMIN');
    expect(extractEnumValues(COMMON_ENUMS_FILE, 'NotificationType')).toContain('POST_RESOLVED_BY_ADMIN');
  });
});
