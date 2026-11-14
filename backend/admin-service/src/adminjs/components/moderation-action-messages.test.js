import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POST_RESOLUTION_ACTIONS as RESOLUTION_ACTIONS } from '../actions/moderate-post.actions.js';
import { buildUnbanUserAction } from '../actions/ban-user.action.js';
import { buildCommentActions } from '../actions/moderate-comment.actions.js';
import { buildPostActions } from '../actions/moderate-post.actions.js';
import {
  ACTION_CONSEQUENCES,
  ACTION_LABELS,
  CONFIRM_ONLY_ACTIONS,
  POST_RESOLUTION_ACTIONS as CONFIRMATION_COPY,
} from './moderation-action-messages.js';

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

  it('gives every confirm-only action a label, a consequence and the shared form (never a GET guard)', () => {
    const component = 'ModerationAction';
    const actions = {
      ...buildPostActions(null, component, null),
      ...buildCommentActions(null, component, null),
      unbanUser: buildUnbanUserAction(null, component, null),
    };
    assert.deepEqual(Object.keys(CONFIRM_ONLY_ACTIONS).sort(), [
      'approvePost',
      'restoreComment',
      'restorePost',
      'unbanUser',
    ]);
    for (const [name, copy] of Object.entries(CONFIRM_ONLY_ACTIONS)) {
      assert.ok(copy.label && copy.consequence, `"${name}" needs a label and a consequence`);
      assert.equal(actions[name].component, component, `"${name}" must submit through the form`);
      assert.ok(!actions[name].guard, `"${name}" must not use a guard modal, which AdminJS submits as a GET`);
    }
  });

  it('labels removeComment instead of falling back to the raw action name', () => {
    assert.equal(ACTION_LABELS.removeComment, 'Remove Comment');
  });

  it('words Remove Profile Photo for the shared form', () => {
    assert.equal(ACTION_LABELS.removeProfilePhoto, 'Remove Profile Photo');
    assert.match(ACTION_CONSEQUENCES.removeProfilePhoto, /queues the stored image for deletion/);
  });
});
