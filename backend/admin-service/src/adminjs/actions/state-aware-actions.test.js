import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBanUserAction, buildUnbanUserAction } from './ban-user.action.js';
import { buildPostActions } from './moderate-post.actions.js';

describe('State-Aware Action Visibility Matrix', () => {
  const dummyPool = {};
  const dummyComponent = 'DummyComponent';
  const dummyCache = null;

  const postActions = buildPostActions(dummyPool, dummyComponent, dummyCache);
  const banUserAction = buildBanUserAction(dummyPool, dummyComponent, dummyCache);
  const unbanUserAction = buildUnbanUserAction(dummyPool, dummyCache);

  const createPostRecord = (status, moderation_status) => ({
    id: () => 'test-post-id',
    params: { id: 'test-post-id', status, moderation_status },
    get: (key) => ({ id: 'test-post-id', status, moderation_status })[key],
  });

  const createUserRecord = (is_banned) => ({
    id: () => 'test-user-id',
    params: { id: 'test-user-id', is_banned },
    get: (key) => ({ id: 'test-user-id', is_banned })[key],
  });

  describe('Post Actions', () => {
    it('shows Flag and Remove but not Approve or Restore on an active clean post', () => {
      const record = createPostRecord('ACTIVE', 'CLEAN');
      const context = { record };

      assert.equal(postActions.approvePost.isVisible(context), false);
      assert.equal(postActions.flagPost.isVisible(context), true);
      assert.equal(postActions.removePost.isVisible(context), true);
      assert.equal(postActions.restorePost.isVisible(context), false);
    });

    it('shows Approve and Remove but not Flag or Restore on an active flagged post', () => {
      const record = createPostRecord('ACTIVE', 'FLAGGED');
      const context = { record };

      assert.equal(postActions.approvePost.isVisible(context), true);
      assert.equal(postActions.flagPost.isVisible(context), false);
      assert.equal(postActions.removePost.isVisible(context), true);
      assert.equal(postActions.restorePost.isVisible(context), false);
    });

    it('shows Approve, Flag, and Remove but not Restore on an active pending post', () => {
      const record = createPostRecord('ACTIVE', 'PENDING_AUTO_REVIEW');
      const context = { record };

      assert.equal(postActions.approvePost.isVisible(context), true);
      assert.equal(postActions.flagPost.isVisible(context), true);
      assert.equal(postActions.removePost.isVisible(context), true);
      assert.equal(postActions.restorePost.isVisible(context), false);
    });

    it('shows Restore but no moderation or removal transition on a removed post (clean, flagged, or pending)', () => {
      const statuses = ['CLEAN', 'FLAGGED', 'PENDING_AUTO_REVIEW'];
      for (const moderationStatus of statuses) {
        const record = createPostRecord('REMOVED', moderationStatus);
        const context = { record };

        assert.equal(
          postActions.approvePost.isVisible(context),
          false,
          `approvePost should be hidden for REMOVED / ${moderationStatus}`,
        );
        assert.equal(
          postActions.flagPost.isVisible(context),
          false,
          `flagPost should be hidden for REMOVED / ${moderationStatus}`,
        );
        assert.equal(
          postActions.removePost.isVisible(context),
          false,
          `removePost should be hidden for REMOVED / ${moderationStatus}`,
        );
        assert.equal(
          postActions.restorePost.isVisible(context),
          true,
          `restorePost should be visible for REMOVED / ${moderationStatus}`,
        );
      }
    });

    it('works with records using plain params object without get method', () => {
      const record = { params: { status: 'ACTIVE', moderation_status: 'CLEAN' } };
      assert.equal(postActions.flagPost.isVisible({ record }), true);
      assert.equal(postActions.approvePost.isVisible({ record }), false);
    });

    it('safely returns false when context or record is missing', () => {
      assert.equal(postActions.approvePost.isVisible({}), false);
      assert.equal(postActions.flagPost.isVisible({}), false);
      assert.equal(postActions.removePost.isVisible({}), false);
      assert.equal(postActions.restorePost.isVisible({}), false);
      assert.equal(postActions.approvePost.isVisible(null), false);
    });
  });

  describe('User Actions', () => {
    it('shows Ban but not Unban on an active user', () => {
      const record = createUserRecord(false);
      const context = { record };

      assert.equal(banUserAction.isVisible(context), true);
      assert.equal(unbanUserAction.isVisible(context), false);
    });

    it('shows Unban but not Ban on a banned user', () => {
      const record = createUserRecord(true);
      const context = { record };

      assert.equal(banUserAction.isVisible(context), false);
      assert.equal(unbanUserAction.isVisible(context), true);
    });

    it('handles string and numeric boolean variants for is_banned', () => {
      assert.equal(banUserAction.isVisible({ record: { params: { is_banned: 'true' } } }), false);
      assert.equal(unbanUserAction.isVisible({ record: { params: { is_banned: 'true' } } }), true);

      assert.equal(banUserAction.isVisible({ record: { params: { is_banned: 'false' } } }), true);
      assert.equal(unbanUserAction.isVisible({ record: { params: { is_banned: 'false' } } }), false);

      assert.equal(banUserAction.isVisible({ record: { params: { is_banned: 1 } } }), false);
      assert.equal(unbanUserAction.isVisible({ record: { params: { is_banned: 1 } } }), true);

      assert.equal(banUserAction.isVisible({ record: { params: { is_banned: 0 } } }), true);
      assert.equal(unbanUserAction.isVisible({ record: { params: { is_banned: 0 } } }), false);
    });

    it('safely returns false when context or record is missing', () => {
      assert.equal(banUserAction.isVisible({}), false);
      assert.equal(unbanUserAction.isVisible({}), false);
      assert.equal(banUserAction.isVisible(null), false);
    });
  });

  describe('Independence of Role-Based Accessibility and State-Aware Visibility', () => {
    it('preserves role-based isAccessible independent of post state', () => {
      const superAdminContext = { currentAdmin: { id: 'admin-1', role: 'SUPER_ADMIN' } };
      const staffAdminContext = { currentAdmin: { id: 'admin-2', role: 'ADMIN' } };
      const unauthorizedContext = { currentAdmin: { id: 'user-1', role: 'USER' } };
      const noAdminContext = { currentAdmin: null };

      for (const action of Object.values(postActions)) {
        assert.equal(action.isAccessible(superAdminContext), true);
        assert.equal(action.isAccessible(staffAdminContext), true);
        assert.equal(action.isAccessible(unauthorizedContext), false);
        assert.equal(action.isAccessible(noAdminContext), false);
      }
    });

    it('preserves role-based isAccessible independent of user state', () => {
      const superAdminContext = { currentAdmin: { id: 'admin-1', role: 'SUPER_ADMIN' } };
      const staffAdminContext = { currentAdmin: { id: 'admin-2', role: 'ADMIN' } };
      const unauthorizedContext = { currentAdmin: { id: 'user-1', role: 'USER' } };

      assert.equal(banUserAction.isAccessible(superAdminContext), true);
      assert.equal(banUserAction.isAccessible(staffAdminContext), true);
      assert.equal(banUserAction.isAccessible(unauthorizedContext), false);

      assert.equal(unbanUserAction.isAccessible(superAdminContext), true);
      assert.equal(unbanUserAction.isAccessible(staffAdminContext), true);
      assert.equal(unbanUserAction.isAccessible(unauthorizedContext), false);
    });
  });
});
