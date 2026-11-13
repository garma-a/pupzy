import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
} from '../../../../src/notifications/admin-announcement.contract.ts';
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH, characterCount, newRequestKey } from './announcement-limits.js';

describe('announcement form limits', () => {
  it('match the shared contract the server validates with', () => {
    assert.equal(TITLE_MAX_LENGTH, ANNOUNCEMENT_TITLE_MAX_LENGTH);
    assert.equal(BODY_MAX_LENGTH, ANNOUNCEMENT_BODY_MAX_LENGTH);
  });

  it('counts characters the way a person does', () => {
    assert.equal(characterCount('abc'), 3);
    assert.equal(characterCount('أسبوع'), 5);
    assert.equal(characterCount('🐶'), 1);
    assert.equal(characterCount(null), 0);
  });

  it('generates a fresh UUID request key each time', () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const keys = new Set(Array.from({ length: 50 }, () => newRequestKey()));
    assert.equal(keys.size, 50);
    for (const key of keys) assert.match(key, pattern);
  });
});
