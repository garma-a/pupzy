import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PUPZY_COLORS, pupzyTheme } from './theme.js';

describe('Pupzy Admin Theme Tokens', () => {
  it('defines the approved Flutter-era Pupzy color palette', () => {
    assert.equal(PUPZY_COLORS.primary100, '#C4622D', 'Pupzy primary orange');
    assert.equal(PUPZY_COLORS.bg, '#FAF6F1', 'Warm cream background');
    assert.equal(PUPZY_COLORS.text, '#2D1506', 'Dark-brown text');
    assert.equal(PUPZY_COLORS.error, '#D94040', 'Critical / danger state');
    assert.equal(PUPZY_COLORS.success, '#2D8B6F', 'Success green');
    assert.equal(PUPZY_COLORS.accent, '#8B6355', 'Secondary brown accent');
    assert.equal(PUPZY_COLORS.border, '#E8DED5', 'Standard border');
    assert.equal(PUPZY_COLORS.container, '#FFFFFF', 'White container cards');
  });

  it('configures typography with Cairo and DM Sans for bilingual scanning', () => {
    assert.match(pupzyTheme.font, /Cairo/);
    assert.match(pupzyTheme.font, /DM Sans/);
  });

  it('configures borders and focus shadows', () => {
    assert.equal(pupzyTheme.borders.default, '1px solid #E8DED5');
    assert.ok(pupzyTheme.shadows.login);
    assert.ok(pupzyTheme.shadows.card);
  });
});
