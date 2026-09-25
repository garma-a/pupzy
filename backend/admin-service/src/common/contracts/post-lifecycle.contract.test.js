import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_DISCUSSION_LOCK_NAMESPACE,
  POST_LIFECYCLE_LOCK_ORDER,
  POST_LIFECYCLE_SIDE_EFFECTS,
  POST_EXPIRY_POLICIES,
  RENEWAL_COOLDOWN_DAYS,
  OWNER_CLOSURE_TRANSITIONS,
  LOST_SUBTYPE_CLOSURE_TRANSITIONS,
  ownerClosureTargets,
  canOwnerClose,
  canOwnerRemove,
  canOwnerRenew,
  canExpirePost,
  canAdminRemove,
  canAdminResolve,
  canAdminReopen,
  canAdminRestore,
} from '../../../../src/common/contracts/post-lifecycle.contract.ts';

describe('AdminJS Post Lifecycle Contract (shared with the API)', () => {
  it('loads the same contract module and discussion-lock namespace as the API', () => {
    assert.equal(POST_DISCUSSION_LOCK_NAMESPACE, 'comment_discussion:');
    assert.deepEqual([...POST_LIFECYCLE_LOCK_ORDER], ['post-discussion-advisory', 'post-row']);
  });

  it('agrees with the API owner closure table', () => {
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.RESCUE, ['RESOLVED', 'ANIMAL_DECEASED']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.LOST, ['REUNITED']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.ADOPTION, ['ADOPTED']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.PRODUCT, ['SOLD']);
    assert.deepEqual(OWNER_CLOSURE_TRANSITIONS.MATING, ['RESOLVED']);
    assert.deepEqual(LOST_SUBTYPE_CLOSURE_TRANSITIONS.LOST_PET, ['REUNITED']);
    assert.deepEqual(LOST_SUBTYPE_CLOSURE_TRANSITIONS.FOUND_STRAY, ['RESOLVED', 'REUNITED']);
    assert.deepEqual(ownerClosureTargets('MATING'), ['RESOLVED']);
    assert.deepEqual(ownerClosureTargets('LOST', 'FOUND_STRAY'), ['RESOLVED', 'REUNITED']);
    assert.equal(canOwnerClose('PRODUCT', 'ACTIVE', 'SOLD'), true);
    assert.equal(canOwnerClose('PRODUCT', 'ACTIVE', 'RESOLVED'), false);
    assert.equal(canOwnerClose('MATING', 'ACTIVE', 'RESOLVED'), true);
    assert.equal(canOwnerClose('LOST', 'ACTIVE', 'RESOLVED', 'LOST_PET'), false);
    assert.equal(canOwnerClose('LOST', 'ACTIVE', 'RESOLVED', 'FOUND_STRAY'), true);
    assert.equal(canOwnerClose('RESCUE', 'ACTIVE', 'ANIMAL_DECEASED'), true);
    assert.equal(canOwnerClose('LOST', 'ACTIVE', 'ANIMAL_DECEASED', 'FOUND_STRAY'), false);
    assert.equal(canOwnerClose('ADOPTION', 'ACTIVE', 'ANIMAL_DECEASED'), false);
    assert.equal(canOwnerClose('PRODUCT', 'ACTIVE', 'ANIMAL_DECEASED'), false);
    assert.equal(canOwnerClose('MATING', 'ACTIVE', 'ANIMAL_DECEASED'), false);
    assert.equal(canOwnerRemove('REMOVED'), false);
  });

  it('gates administrative removal and restoration on exactly the supported source states', () => {
    assert.equal(canAdminRemove('ACTIVE'), true);
    assert.equal(canAdminRemove('REMOVED'), false);
    assert.equal(canAdminRemove('RESOLVED'), false);
    assert.equal(canAdminRestore('REMOVED'), true);
    assert.equal(canAdminRestore('ACTIVE'), false);
  });

  it('agrees with the API on type-specific administrator resolution targets', () => {
    assert.equal(canAdminResolve('RESCUE', 'ACTIVE', 'RESOLVED'), true);
    assert.equal(canAdminResolve('RESCUE', 'ACTIVE', 'ANIMAL_DECEASED'), true);
    assert.equal(canAdminResolve('LOST', 'ACTIVE', 'REUNITED', 'LOST_PET'), true);
    assert.equal(canAdminResolve('LOST', 'ACTIVE', 'RESOLVED', 'FOUND_STRAY'), true);
    assert.equal(canAdminResolve('LOST', 'ACTIVE', 'RESOLVED', 'LOST_PET'), false);
    assert.equal(canAdminResolve('LOST', 'ACTIVE', 'ANIMAL_DECEASED', 'FOUND_STRAY'), false);
    assert.equal(canAdminResolve('ADOPTION', 'ACTIVE', 'ADOPTED'), true);
    assert.equal(canAdminResolve('ADOPTION', 'ACTIVE', 'ANIMAL_DECEASED'), false);
    assert.equal(canAdminResolve('PRODUCT', 'ACTIVE', 'SOLD'), true);
    assert.equal(canAdminResolve('PRODUCT', 'ACTIVE', 'ANIMAL_DECEASED'), false);
    assert.equal(canAdminResolve('MATING', 'ACTIVE', 'RESOLVED'), true);
    assert.equal(canAdminResolve('MATING', 'ACTIVE', 'ANIMAL_DECEASED'), false);
    assert.equal(canAdminResolve('PRODUCT', 'ACTIVE', 'RESOLVED'), false);
    assert.equal(canAdminResolve('RESCUE', 'RESOLVED', 'RESOLVED'), false);
    assert.equal(canAdminResolve('RESCUE', 'ANIMAL_DECEASED', 'ANIMAL_DECEASED'), false);
    assert.equal(canAdminResolve('PRODUCT', 'EXPIRED', 'SOLD'), false);
  });

  it('agrees with the API on the administrator reopening correction', () => {
    for (const status of ['RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'ANIMAL_DECEASED']) {
      assert.equal(canAdminReopen(status), true);
    }
    for (const status of ['ACTIVE', 'REMOVED', 'EXPIRED']) {
      assert.equal(canAdminReopen(status), false);
    }
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_REOPEN, {
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_REOPENED_BY_ADMIN',
      closeOpenPostReports: false,
      terminatePendingInteractions: false,
    });
  });

  it('declares the administrative audit, report-closure and notification side effects', () => {
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_RESOLVE, {
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_RESOLVED_BY_ADMIN',
      closeOpenPostReports: false,
      terminatePendingInteractions: true,
    });
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_REMOVE, {
      userPostCountDelta: 'DECREMENT',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_REMOVED_BY_ADMIN',
      closeOpenPostReports: true,
      terminatePendingInteractions: false,
    });
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_RESTORE, {
      userPostCountDelta: 'INCREMENT',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: null,
      closeOpenPostReports: true,
      terminatePendingInteractions: false,
    });
    assert.equal(POST_LIFECYCLE_SIDE_EFFECTS.OWNER_CLOSE.terminatePendingInteractions, true);
  });

  it('agrees with the API on the inactivity policy and the EXPIRED lifecycle', () => {
    assert.deepEqual(POST_EXPIRY_POLICIES.PRODUCT, {
      expiryAfterDays: 14,
      reminderAfterDays: 11,
      renewable: true,
    });
    assert.deepEqual(POST_EXPIRY_POLICIES.ADOPTION, {
      expiryAfterDays: 30,
      reminderAfterDays: 27,
      renewable: true,
    });
    assert.deepEqual(POST_EXPIRY_POLICIES.RESCUE, {
      expiryAfterDays: null,
      reminderAfterDays: 60,
      renewable: false,
    });
    assert.deepEqual(POST_EXPIRY_POLICIES.LOST, {
      expiryAfterDays: null,
      reminderAfterDays: 60,
      renewable: false,
    });
    assert.equal(POST_EXPIRY_POLICIES.MATING.expiryAfterDays, null);
    assert.equal(POST_EXPIRY_POLICIES.MATING.reminderAfterDays, null);
    assert.equal(RENEWAL_COOLDOWN_DAYS, 7);
    assert.equal(canExpirePost('PRODUCT', 'ACTIVE'), true);
    assert.equal(canExpirePost('ADOPTION', 'ACTIVE'), true);
    assert.equal(canExpirePost('MATING', 'ACTIVE'), false);
    assert.equal(canExpirePost('RESCUE', 'ACTIVE'), false);
    assert.equal(canExpirePost('LOST', 'ACTIVE'), false);
    assert.equal(canOwnerRenew('PRODUCT', 'EXPIRED'), true);
    assert.equal(canOwnerRenew('PRODUCT', 'SOLD'), false);
    assert.equal(canOwnerRenew('ADOPTION', 'EXPIRED'), true);
    assert.equal(canOwnerRenew('ADOPTION', 'ADOPTED'), false);
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.EXPIRE, {
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: false,
      moderationAudit: false,
      ownerNotification: null,
      closeOpenPostReports: false,
      terminatePendingInteractions: true,
    });
    assert.deepEqual(POST_LIFECYCLE_SIDE_EFFECTS.OWNER_RENEW, {
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: true,
      invalidateAdminDashboardCache: false,
      moderationAudit: false,
      ownerNotification: null,
      closeOpenPostReports: false,
      terminatePendingInteractions: false,
    });
  });
});
