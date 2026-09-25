import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POST_RESOLUTION_ACTIONS as RESOLUTION_ACTIONS } from '../actions/moderate-post.actions.js';
import { POST_RESOLUTION_ACTIONS as CONFIRMATION_COPY } from './moderation-action-messages.js';

describe('Moderation action confirmation copy', () => {
  it('has a label and consequence for every Post Resolution action', () => {
    for (const actionName of Object.keys(RESOLUTION_ACTIONS)) {
      const confirmation = CONFIRMATION_COPY[actionName];
      assert.ok(confirmation, `missing confirmation copy for the "${actionName}" action`);
      assert.equal(typeof confirmation.label, 'string', `"${actionName}" label must be a string`);
      assert.ok(confirmation.label.length > 0, `"${actionName}" label must not be empty`);
      assert.equal(typeof confirmation.consequence, 'string', `"${actionName}" consequence must be a string`);
      assert.ok(confirmation.consequence.length > 0, `"${actionName}" consequence must not be empty`);
    }
  });

  it('does not keep confirmation copy for an action that no longer exists', () => {
    for (const actionName of Object.keys(CONFIRMATION_COPY)) {
      assert.ok(RESOLUTION_ACTIONS[actionName], `confirmation copy for unknown action "${actionName}"`);
    }
  });

  it('states the animal-deceased consequence without calling it a successful rescue', () => {
    const confirmation = CONFIRMATION_COPY.markAnimalDeceased;
    assert.equal(confirmation.label, 'Mark animal deceased');
    assert.match(confirmation.consequence, /animal died/);
    assert.match(confirmation.consequence, /never described as rescued/);
    assert.doesNotMatch(confirmation.consequence, /successful rescue/i);
  });
});
