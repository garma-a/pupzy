import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_DISCUSSION_LOCK_NAMESPACE,
  POST_LIFECYCLE_LOCK_ORDER,
  POST_LIFECYCLE_SIDE_EFFECTS,
  OWNER_CLOSURE_TRANSITIONS,
  ownerClosureTargets,
  canOwnerClose,
  canOwnerRemove,
  canAdminRemove,
  canAdminRestore,
} from '../../../../src/common/contracts/post-lifecycle.contract.ts';

describe('AdminJS Post Lifecycle Contract (shared with the API)', () => {
  it('loads the same contract module and discussion-lock namespace as the API', () => {
    assert.equal(POST_DISCUSSION_LOCK_NAMESPACE, 'comment_discussion:');
    assert.deepEqual([...POST_LIFECYCLE_LOCK_ORDER], ['post-discussion-advisory', 'post-row']);
  });

  it('agrees with the API owner closure table', () => {
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.RESCUE, ['RESOLVED']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.LOST, ['REUNITED']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.ADOPTION, ['ADOPTED']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.PRODUCT, ['SOLD']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.MATING, []);
    assert.deepEqual(ownerClosureTargets('MATING'), []);
    assert.equal(canOwnerClose('PRODUCT', 'ACTIVE', 'SOLD'), true);
    assert.equal(canOwnerClose('PRODUCT', 'ACTIVE', 'RESOLVED'), false);
    assert.equal(canOwnerRemove('REMOVED'), false);
  });

  it('gates administrative removal and restoration on exactly the supported source states', () => {
    assert.equal(canAdminRemove('ACTIVE'), true);
    assert.equal(canAdminRemove('REMOVED'), false);
    assert.equal(canAdminRemove('RESOLVED'), false);
    assert.equal(canAdminRestore('REMOVED'), true);
    assert.equal(canAdminRestore('ACTIVE'), false);
  });

  it('declares the administrative audit, report-closure and notification side effects', () => {
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_REMOVE, {
      userPostCountDelta: 'DECREMENT',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_REMOVED_BY_ADMIN',
      closeOpenPostReports: true,
    });
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_RESTORE, {
      userPostCountDelta: 'INCREMENT',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: null,
      closeOpenPostReports: true,
    });
  });
});
