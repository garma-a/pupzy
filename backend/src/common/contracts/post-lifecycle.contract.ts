/**
 * Canonical Post lifecycle transition and side-effect contract.
 *
 * Shared by the NestJS GraphQL API and the AdminJS service. This is the one
 * place that defines which actor may move a Post between lifecycle statuses,
 * which locks every transition takes, and which side effects must commit with
 * it. It is deliberately a table of rules, not a framework: each service keeps
 * its own transaction helper and applies these rules inside it.
 *
 * ## Actors and entry points
 * | Transition      | Actor         | Entry point                                        |
 * | --------------- | ------------- | -------------------------------------------------- |
 * | `OWNER_CLOSE`   | Post owner    | GraphQL `updatePostStatus`                         |
 * | `OWNER_REMOVE`  | Post owner    | GraphQL `deletePost`                               |
 * | `ADMIN_REMOVE`  | Administrator | AdminJS `removePost` (and the ban Post cascade)    |
 * | `ADMIN_RESTORE` | Administrator | AdminJS `restorePost`                              |
 *
 * ## Lock order (API and admin)
 * Every transition acquires, inside one database transaction:
 * 1. the transaction-scoped advisory key `comment_discussion:<postId>`
 *    (`POST_DISCUSSION_LOCK_NAMESPACE`), then
 * 2. the canonical `posts` row with `SELECT ... FOR UPDATE`.
 * The row is re-read and revalidated after the locks, so a competing
 * discussion write, removal, ban cascade or transition cannot interleave.
 *
 * ## Transaction boundary
 * The status write, `trg_sync_user_post_counts` counter delta, moderation
 * audit row, owner notification, open Post Report closure and pending direct
 * interaction termination commit together. Cache invalidation and other
 * external effects run only after commit.
 *
 * ## Statuses
 * This contract covers the existing lifecycle only: `ACTIVE` plus the
 * per-type successful outcomes and `REMOVED`. Administrative removal and
 * inactivity expiry intentionally reuse `REMOVED` as their stored status
 * while staying conceptually distinct (see `POST_LIFECYCLE_SIDE_EFFECTS`).
 * No new status is introduced here; later lifecycle work extends these tables.
 */

/** Lifecycle statuses a Post can hold today. */
export type PostLifecycleStatus = 'ACTIVE' | 'RESOLVED' | 'REUNITED' | 'ADOPTED' | 'SOLD' | 'REMOVED';

/** Listing types a Post can hold today. */
export type PostLifecyclePostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

/** Direction discriminator carried by every LOST Post. */
export type PostLifecycleLostReportType = 'LOST_PET' | 'FOUND_STRAY';

/** Named lifecycle transitions covered by this contract. */
export type PostLifecycleTransitionName = 'OWNER_CLOSE' | 'OWNER_REMOVE' | 'ADMIN_REMOVE' | 'ADMIN_RESTORE';

/**
 * Advisory-lock key namespace that serializes a single Post's discussion
 * writes with every lifecycle transition. Both services must prefix the Post
 * id with exactly this string.
 */
export const POST_DISCUSSION_LOCK_NAMESPACE = 'comment_discussion:';

/**
 * Ordered locks every lifecycle transition acquires before revalidating and
 * writing. Consumers must keep this order to avoid deadlock with discussion
 * mutations, which take the same keys in the same order.
 */
export const POST_LIFECYCLE_LOCK_ORDER = Object.freeze(['post-discussion-advisory', 'post-row'] as const);

/**
 * Owner closure targets by Post type. Owners may close an `ACTIVE` Post into
 * its type-specific successful outcome only. Successful outcomes stay directly
 * readable while leaving discovery.
 *
 * LOST is the one type whose targets depend on its direction discriminator:
 * see `LOST_SUBTYPE_CLOSURE_TRANSITIONS`. The entry here is the conservative
 * default used when no `report_type` can be read.
 */
export const OWNER_CLOSURE_TRANSITIONS: Readonly<Record<PostLifecyclePostType, readonly PostLifecycleStatus[]>> =
  Object.freeze({
    RESCUE: Object.freeze(['RESOLVED'] as const),
    LOST: Object.freeze(['REUNITED'] as const),
    ADOPTION: Object.freeze(['ADOPTED'] as const),
    PRODUCT: Object.freeze(['SOLD'] as const),
    MATING: Object.freeze(['RESOLVED'] as const),
  });

/**
 * Owner closure targets for LOST Posts, keyed by their `report_type`.
 *
 * - `LOST_PET` closes as `REUNITED`, unchanged.
 * - `FOUND_STRAY` accepts `RESOLVED` while retaining `REUNITED` for existing
 *   clients that already send it.
 */
export const LOST_SUBTYPE_CLOSURE_TRANSITIONS: Readonly<
  Record<PostLifecycleLostReportType, readonly PostLifecycleStatus[]>
> = Object.freeze({
  LOST_PET: Object.freeze(['REUNITED'] as const),
  FOUND_STRAY: Object.freeze(['RESOLVED', 'REUNITED'] as const),
});

/**
 * Resolves the owner closure targets for a Post. LOST Posts use their
 * direction discriminator; a missing or unknown discriminator keeps the
 * conservative REUNITED-only behavior. Unknown types have no allowed targets,
 * matching the historical empty-list fallback.
 */
export function ownerClosureTargets(postType: string, lostReportType?: string | null): readonly PostLifecycleStatus[] {
  if (postType === 'LOST') {
    return (
      LOST_SUBTYPE_CLOSURE_TRANSITIONS[lostReportType as PostLifecycleLostReportType] ?? OWNER_CLOSURE_TRANSITIONS.LOST
    );
  }
  return OWNER_CLOSURE_TRANSITIONS[postType as PostLifecyclePostType] ?? [];
}

/**
 * True when an owner may close this Post from its current status into the
 * requested target. Closing is only possible from `ACTIVE`, and only into a
 * target that belongs to the Post's type and (for LOST) direction.
 */
export function canOwnerClose(
  postType: string,
  currentStatus: string,
  targetStatus: string,
  lostReportType?: string | null,
): boolean {
  if (currentStatus !== 'ACTIVE') return false;
  return ownerClosureTargets(postType, lostReportType).includes(targetStatus as PostLifecycleStatus);
}

/**
 * True when an owner may remove this Post. Owners retain manual removal from
 * every non-Removed status; `REMOVED` stays terminal for owner actions and
 * administrator restoration is the only way back.
 */
export function canOwnerRemove(currentStatus: string): boolean {
  return currentStatus !== 'REMOVED';
}

/**
 * True when an administrator may remove this Post. Administrative removal is
 * the moderation takedown path and only applies to `ACTIVE` Posts, so it can
 * never overwrite a recorded successful outcome.
 */
export function canAdminRemove(currentStatus: string): boolean {
  return currentStatus === 'ACTIVE';
}

/**
 * True when an administrator may restore this Removed Post. Restoration
 * returns the Post to `ACTIVE` and preserves its prior moderation status.
 */
export function canAdminRestore(currentStatus: string): boolean {
  return currentStatus === 'REMOVED';
}

/** Side effects that must hold for one named lifecycle transition. */
export interface PostLifecycleSideEffects {
  /**
   * Counter delta applied by the `trg_sync_user_post_counts` database
   * trigger when the status change commits. `NONE` transitions still fire the
   * trigger but do not change the owner's Post counters.
   */
  readonly userPostCountDelta: 'NONE' | 'DECREMENT' | 'INCREMENT';
  /** The API must invalidate the owner's cached `user_resolve` entry. */
  readonly invalidateOwnerUserCache: boolean;
  /** The AdminJS dashboard cache must be invalidated after commit. */
  readonly invalidateAdminDashboardCache: boolean;
  /** An append-only `moderation_actions` row records actor, action and reason. */
  readonly moderationAudit: boolean;
  /** Notification type inserted for the owner, or null when none is sent. */
  readonly ownerNotification: string | null;
  /** Every still-open Post Report for the Post is closed in the transaction. */
  readonly closeOpenPostReports: boolean;
  /**
   * Every still-PENDING Contact Request and Adoption Application targeting
   * the Post is moved to its terminal `REJECTED` state in the same
   * transaction. Records are preserved and previously approved interactions
   * are never touched.
   */
  readonly terminatePendingInteractions: boolean;
}

/**
 * Side-effect contract per transition.
 *
 * - Owner actions commit the status change and the counter trigger delta only;
 *   they invalidate the API user cache after commit. They deliberately do not
 *   write moderation audit rows or owner notifications. Owner closure also
 *   terminates pending direct interactions in the same transaction; owner
 *   removal keeps its established behavior.
 * - Administrator removal and restoration additionally write the audit row,
 *   close open Post Reports, and invalidate the AdminJS dashboard cache.
 *   Removal notifies the owner; restoration does not.
 * - Removal is not destructive: Post media, discussion and engagement records
 *   are retained, and restoration makes them reachable again.
 */
export const POST_LIFECYCLE_SIDE_EFFECTS: Readonly<Record<PostLifecycleTransitionName, PostLifecycleSideEffects>> =
  Object.freeze({
    OWNER_CLOSE: Object.freeze({
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: true,
      invalidateAdminDashboardCache: false,
      moderationAudit: false,
      ownerNotification: null,
      closeOpenPostReports: false,
      terminatePendingInteractions: true,
    }),
    OWNER_REMOVE: Object.freeze({
      userPostCountDelta: 'DECREMENT',
      invalidateOwnerUserCache: true,
      invalidateAdminDashboardCache: false,
      moderationAudit: false,
      ownerNotification: null,
      closeOpenPostReports: false,
      terminatePendingInteractions: false,
    }),
    ADMIN_REMOVE: Object.freeze({
      userPostCountDelta: 'DECREMENT',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_REMOVED_BY_ADMIN',
      closeOpenPostReports: true,
      terminatePendingInteractions: false,
    }),
    ADMIN_RESTORE: Object.freeze({
      userPostCountDelta: 'INCREMENT',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: null,
      closeOpenPostReports: true,
      terminatePendingInteractions: false,
    }),
  });
