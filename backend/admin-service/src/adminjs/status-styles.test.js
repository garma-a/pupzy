import assert from 'node:assert/strict';
import { it } from 'node:test';
import { STATUS_STYLES, statusMeaning } from './status-styles.js';
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
it('keeps every badge meaning at WCAG AA text contrast', () => {
  for (const [meaning, { color, background }] of Object.entries(STATUS_STYLES)) {
    const values = [luminance(color), luminance(background)].sort((a, b) => a - b);
    const ratio = (values[1] + 0.05) / (values[0] + 0.05);
    assert.ok(ratio >= 4.5, `${meaning}: ${ratio.toFixed(2)}:1`);
    console.log(`${meaning}: ${ratio.toFixed(2)}:1`);
  }
});
it('distinguishes open, closed outcomes, flagged, pending and removed targets', () => {
  assert.equal(statusMeaning('OPEN'), 'open');
  assert.equal(statusMeaning('NO_ACTION'), 'neutral');
  assert.equal(statusMeaning('ACTION_TAKEN'), 'success');
  assert.equal(statusMeaning('FLAGGED'), 'flagged');
  assert.equal(statusMeaning('PENDING_AUTO_REVIEW'), 'pending');
  for (const value of ['REMOVED', 'BANNED']) assert.equal(statusMeaning(value), 'removed');
});
