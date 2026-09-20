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
} from './post-lifecycle.contract';

describe('Post lifecycle transition contract', () => {
  describe('shared locking contract', () => {
    it('defines the discussion advisory key namespace both services must prefix Post ids with', () => {
      expect(POST_DISCUSSION_LOCK_NAMESPACE).toBe('comment_discussion:');
    });

    it('documents the advisory-then-row lock order', () => {
      expect(POST_LIFECYCLE_LOCK_ORDER).toEqual(['post-discussion-advisory', 'post-row']);
      expect(Object.isFrozen(POST_LIFECYCLE_LOCK_ORDER)).toBe(true);
    });
  });

  describe('owner closure transitions', () => {
    it('maps each Post type to its successful outcome only', () => {
      expect(OWNER_CLOSURE_TRANSITIONS.RESCUE).toEqual(['RESOLVED']);
      expect(OWNER_CLOSURE_TRANSITIONS.LOST).toEqual(['REUNITED']);
      expect(OWNER_CLOSURE_TRANSITIONS.ADOPTION).toEqual(['ADOPTED']);
      expect(OWNER_CLOSURE_TRANSITIONS.PRODUCT).toEqual(['SOLD']);
    });

    it('keeps MATING closed to owner closure in this preparatory contract', () => {
      expect(OWNER_CLOSURE_TRANSITIONS.MATING).toEqual([]);
      expect(ownerClosureTargets('MATING')).toEqual([]);
    });

    it('falls back to no targets for unknown Post types', () => {
      expect(ownerClosureTargets('UNKNOWN')).toEqual([]);
      expect(ownerClosureTargets('')).toEqual([]);
    });

    it('accepts only the ACTIVE-to-type-outcome transition', () => {
      expect(canOwnerClose('RESCUE', 'ACTIVE', 'RESOLVED')).toBe(true);
      expect(canOwnerClose('LOST', 'ACTIVE', 'REUNITED')).toBe(true);
      expect(canOwnerClose('ADOPTION', 'ACTIVE', 'ADOPTED')).toBe(true);
      expect(canOwnerClose('PRODUCT', 'ACTIVE', 'SOLD')).toBe(true);
    });

    it('rejects cross-type targets, successful states and unknown types', () => {
      expect(canOwnerClose('RESCUE', 'ACTIVE', 'SOLD')).toBe(false);
      expect(canOwnerClose('PRODUCT', 'ACTIVE', 'RESOLVED')).toBe(false);
      expect(canOwnerClose('MATING', 'ACTIVE', 'RESOLVED')).toBe(false);
      expect(canOwnerClose('UNKNOWN', 'ACTIVE', 'RESOLVED')).toBe(false);
    });

    it('rejects closing anything that is not ACTIVE', () => {
      expect(canOwnerClose('RESCUE', 'RESOLVED', 'RESOLVED')).toBe(false);
      expect(canOwnerClose('RESCUE', 'REMOVED', 'RESOLVED')).toBe(false);
      expect(canOwnerClose('LOST', 'REUNITED', 'REUNITED')).toBe(false);
    });
  });

  describe('removal transitions', () => {
    it('lets owners remove every non-Removed Post, including recorded outcomes', () => {
      for (const status of ['ACTIVE', 'RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD']) {
        expect(canOwnerRemove(status)).toBe(true);
      }
      expect(canOwnerRemove('REMOVED')).toBe(false);
    });

    it('lets administrators remove only Active Posts so outcomes are never overwritten', () => {
      expect(canAdminRemove('ACTIVE')).toBe(true);
      for (const status of ['RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'REMOVED']) {
        expect(canAdminRemove(status)).toBe(false);
      }
    });

    it('lets administrators restore only Removed Posts', () => {
      expect(canAdminRestore('REMOVED')).toBe(true);
      for (const status of ['ACTIVE', 'RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD']) {
        expect(canAdminRestore(status)).toBe(false);
      }
    });
  });

  describe('side-effect contract', () => {
    it('covers exactly the named transitions', () => {
      expect(Object.keys(POST_LIFECYCLE_SIDE_EFFECTS).sort()).toEqual([
        'ADMIN_REMOVE',
        'ADMIN_RESTORE',
        'OWNER_CLOSE',
        'OWNER_REMOVE',
      ]);
      expect(Object.isFrozen(POST_LIFECYCLE_SIDE_EFFECTS)).toBe(true);
    });

    it('keeps owner actions limited to cache invalidation after commit', () => {
      for (const transition of ['OWNER_CLOSE', 'OWNER_REMOVE'] as const) {
        expect(POST_LIFECYCLE_SIDE_EFFECTS[transition]).toMatchObject({
          invalidateOwnerUserCache: true,
          invalidateAdminDashboardCache: false,
          moderationAudit: false,
          ownerNotification: null,
          closeOpenPostReports: false,
        });
      }
      expect(POST_LIFECYCLE_SIDE_EFFECTS.OWNER_CLOSE.userPostCountDelta).toBe('NONE');
      expect(POST_LIFECYCLE_SIDE_EFFECTS.OWNER_REMOVE.userPostCountDelta).toBe('DECREMENT');
    });

    it('keeps administrative removal audited, notified and report-closing', () => {
      expect(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_REMOVE).toEqual({
        userPostCountDelta: 'DECREMENT',
        invalidateOwnerUserCache: false,
        invalidateAdminDashboardCache: true,
        moderationAudit: true,
        ownerNotification: 'POST_REMOVED_BY_ADMIN',
        closeOpenPostReports: true,
      });
    });

    it('keeps administrative restoration audited and report-closing without notifying the owner', () => {
      expect(POST_LIFECYCLE_SIDE_EFFECTS.ADMIN_RESTORE).toEqual({
        userPostCountDelta: 'INCREMENT',
        invalidateOwnerUserCache: false,
        invalidateAdminDashboardCache: true,
        moderationAudit: true,
        ownerNotification: null,
        closeOpenPostReports: true,
      });
    });
  });
});
