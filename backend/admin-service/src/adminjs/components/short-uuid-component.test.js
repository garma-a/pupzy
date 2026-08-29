import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatShortUuid } from './short-uuid.js';

describe('formatShortUuid', () => {
  it('shortens standard UUIDs for list view while retaining prefix and suffix', () => {
    const uuid = '01954848-abcd-7123-8456-123456789abc';
    const shortened = formatShortUuid(uuid, true);
    assert.equal(shortened, '01954848…9abc');
    assert.ok(shortened.length < uuid.length);
  });

  it('keeps the full UUID when isList is false (show / record view)', () => {
    const uuid = '01954848-abcd-7123-8456-123456789abc';
    const full = formatShortUuid(uuid, false);
    assert.equal(full, uuid);
  });

  it('handles short strings gracefully without corruption', () => {
    assert.equal(formatShortUuid('short-id', true), 'short-id');
    assert.equal(formatShortUuid('', true), '');
    assert.equal(formatShortUuid(null, true), '');
    assert.equal(formatShortUuid(undefined, true), '');
  });
});
