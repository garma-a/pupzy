import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
} from '../../../../src/notifications/admin-announcement.contract.ts';
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH, characterCount } from './announcement-limits.js';

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
});
