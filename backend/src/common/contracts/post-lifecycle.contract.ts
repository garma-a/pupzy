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
 * | `OWNER_RENEW`   | Post owner    | GraphQL `renewPost`                                |
 * | `EXPIRE`        | System job    | `PostExpiryProcessor` inactivity boundary          |
 * | `ADMIN_RESOLVE` | Administrator | AdminJS type-specific resolution actions           |
 * | `ADMIN_REOPEN`  | Administrator | AdminJS `reopenPost`                               |
 * | `ADMIN_REMOVE`  | Administrator | AdminJS `removePost` (and the ban Post cascade)    |
 * | `ADMIN_RESTORE` | Administrator | AdminJS `restorePost`                              |
 *
 * ## Lock order (API, admin and jobs)
 * Every transition acquires, inside one database transaction:
 * 1. the transaction-scoped advisory key `comment_discussion:<postId>`
 *    (`POST_DISCUSSION_LOCK_NAMESPACE`), then
 * 2. the canonical `posts` row with `SELECT ... FOR UPDATE`.
 * The row is re-read and revalidated after the locks, so a competing
 * discussion write, removal, renewal, ban cascade or transition cannot
 * interleave.
 *
 * ## Transaction boundary
 * The status write, `trg_sync_user_post_counts` counter delta, moderation
 * audit row, owner notification, open Post Report closure, pending direct
 * interaction termination and durable reminder state commit together. Cache
 * invalidation and other external effects run only after commit.
 *
 * ## Statuses
 * `ACTIVE` plus the per-type successful outcomes, `REMOVED` and `EXPIRED`.
 * Administrative removal stores `REMOVED`; inactivity expiry stores `EXPIRED`,
 * deliberately distinct so an expired listing keeps its detail, media and
 * discussion until renewal. Conceptually the two events are recorded by actor,
 * status value and side effects (see `POST_LIFECYCLE_SIDE_EFFECTS`).
 */

/** Lifecycle statuses a Post can hold today. */
export type PostLifecycleStatus = 'ACTIVE' | 'RESOLVED' | 'REUNITED' | 'ADOPTED' | 'SOLD' | 'REMOVED' | 'EXPIRED';

/** Listing types a Post can hold today. */
export type PostLifecyclePostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

/** Direction discriminator carried by every LOST Post. */
export type PostLifecycleLostReportType = 'LOST_PET' | 'FOUND_STRAY';

/** Named lifecycle transitions covered by this contract. */
export type PostLifecycleTransitionName =
  | 'OWNER_CLOSE'
  | 'OWNER_REMOVE'
  | 'OWNER_RENEW'
  | 'EXPIRE'
  | 'ADMIN_RESOLVE'
  | 'ADMIN_REOPEN'
  | 'ADMIN_REMOVE'
  | 'ADMIN_RESTORE';

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
 * True when an administrator may record a Post Resolution for this Post.
 *
 * Administrators mirror the owner's successful outcome per type (and, for
 * LOST, direction) but are never a second owner path: the source status must
 * still be `ACTIVE`, so a recorded outcome can only be corrected through the
 * explicit reopening transition and never overwritten by another resolution.
 */
export function canAdminResolve(
  postType: string,
  currentStatus: string,
  targetStatus: string,
  lostReportType?: string | null,
): boolean {
  if (currentStatus !== 'ACTIVE') return false;
  return ownerClosureTargets(postType, lostReportType).includes(targetStatus as PostLifecycleStatus);
}

/**
 * The successful outcomes a Post Resolution can record. These are the only
 * statuses an administrator may correct through reopening; `ACTIVE`, `REMOVED`
 * and `EXPIRED` are deliberately absent. This is the one outcome list: the
 * AdminJS queue predicates, the reopening rule and the notification templates
 * all derive from it, so adding an outcome cannot ship in one service only.
 */
export const COMPLETED_POST_OUTCOMES = Object.freeze([
  'RESOLVED',
  'REUNITED',
  'ADOPTED',
  'SOLD',
] as const satisfies readonly PostLifecycleStatus[]);

/** A completed Post outcome: one of `COMPLETED_POST_OUTCOMES`. */
export type PostLifecycleCompletedOutcome = (typeof COMPLETED_POST_OUTCOMES)[number];

/**
 * True when an administrator may reopen this Post.
 *
 * Reopening is the administrator-only correction for a mistaken Post
 * Resolution. It applies only to a completed successful outcome, so it never
 * overwrites an `ACTIVE` Post and never bypasses the dedicated paths for
 * removed or expired content: a `REMOVED` Post is returned only by the
 * explicit restoration transition, and an `EXPIRED` listing only by explicit
 * owner renewal. Owners have no reopening path in any case.
 */
export function canAdminReopen(currentStatus: string): boolean {
  return COMPLETED_POST_OUTCOMES.includes(currentStatus as PostLifecycleCompletedOutcome);
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

/** Days between two owner renewals of the same listing. */
export const RENEWAL_COOLDOWN_DAYS = 7;

/**
 * Inactivity policy for one Post type.
 *
 * - `expiryAfterDays` is the inactive window after which the expiry job moves
 *   an `ACTIVE` Post to `EXPIRED`; `null` means the type never expires
 *   automatically.
 * - `reminderAfterDays` is the inactive window after which the owner receives
 *   one `POST_INACTIVITY_NUDGE`. With expiry enabled it is the three-days-
 *   before marker; without expiry it is a stand-alone inactivity reminder that
 *   never removes the Post from discovery. `null` means no inactivity reminder.
 * - `renewable` allows the owner to explicitly renew an `ACTIVE` or `EXPIRED`
 *   listing of this type (subject to `RENEWAL_COOLDOWN_DAYS`).
 *
 * Ticket 12 shipped the PRODUCT window and the shared machinery; ticket 13
 * filled the ADOPTION entry with its 30/27-day window and ticket 14 enabled the
 * stand-alone 60-day reminder for RESCUE and LOST. The processor already
 * honours every enabled entry, so enabling a type changes policy data and
 * tests, not transition rules.
 *
 * ADOPTION and PRODUCT are the renewable types. An expired adoption listing
 * keeps its pending applications terminated exactly like a product listing:
 * the expiry boundary is type-independent.
 */
export interface PostExpiryPolicy {
  readonly expiryAfterDays: number | null;
  readonly reminderAfterDays: number | null;
  readonly renewable: boolean;
}

/**
 * Per-type inactivity policy. Every type is listed explicitly so "never
 * expires" and "not renewable" are contract statements rather than missing
 * configuration. `MATING` expiry stays disabled, matching the agreed product
 * model that rescue, lost/found and mating cases end by owner or administrator
 * decision, not by clock. RESCUE and LOST additionally receive one stand-alone
 * reminder after 60 inactive days; that reminder never changes their status.
 */
export const POST_EXPIRY_POLICIES: Readonly<Record<PostLifecyclePostType, PostExpiryPolicy>> = Object.freeze({
  RESCUE: Object.freeze({ expiryAfterDays: null, reminderAfterDays: 60, renewable: false }),
  LOST: Object.freeze({ expiryAfterDays: null, reminderAfterDays: 60, renewable: false }),
  ADOPTION: Object.freeze({ expiryAfterDays: 30, reminderAfterDays: 27, renewable: true }),
  PRODUCT: Object.freeze({ expiryAfterDays: 14, reminderAfterDays: 11, renewable: true }),
  MATING: Object.freeze({ expiryAfterDays: null, reminderAfterDays: null, renewable: false }),
});

/** Resolves the inactivity policy for a Post type, or null for unknown types. */
export function postExpiryPolicy(postType: string): PostExpiryPolicy | null {
  return POST_EXPIRY_POLICIES[postType as PostLifecyclePostType] ?? null;
}

/**
 * True when the expiry job may move this `ACTIVE` Post to `EXPIRED` under its
 * type policy. Read-only Posts and unknown types are never eligible.
 */
export function canExpirePost(postType: string, currentStatus: string): boolean {
  const policy = postExpiryPolicy(postType);
  return currentStatus === 'ACTIVE' && policy?.expiryAfterDays != null;
}

/**
 * True when the owner may explicitly renew this Post. Renewal applies only to
 * the types whose policy enables it, from `ACTIVE` or `EXPIRED`. Completed
 * outcomes and `REMOVED` are never renewable; the cooldown is enforced against
 * the stored renewal timestamp, not this predicate.
 */
export function canOwnerRenew(postType: string, currentStatus: string): boolean {
  const policy = postExpiryPolicy(postType);
  if (!policy?.renewable) return false;
  return currentStatus === 'ACTIVE' || currentStatus === 'EXPIRED';
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
 * - Administrator resolution records the actor, internal reason and outcome in
 *   the audit row, terminates pending direct interactions and inserts the
 *   bilingual owner notification in the same transaction, then invalidates the
 *   AdminJS dashboard cache after commit. It deliberately leaves the
 *   moderation fields and open Post Reports untouched: a Post Resolution is
 *   not a moderation takedown.
 * - Administrator reopening corrects a completed outcome back to `ACTIVE`. It
 *   records the actor, internal reason and corrected outcome in the audit row
 *   and inserts the bilingual owner notification in the same transaction, then
 *   invalidates the AdminJS dashboard cache after commit. It deliberately
 *   leaves moderation fields, open Post Reports and every terminated or
 *   approved interaction untouched: reopening never revives closed contact
 *   requests or adoption applications.
 * - Administrator removal and restoration additionally write the audit row,
 *   close open Post Reports, and invalidate the AdminJS dashboard cache.
 *   Removal notifies the owner; restoration does not.
 * - Removal is not destructive: Post media, discussion and engagement records
 *   are retained, and restoration makes them reachable again.
 * - Inactivity expiry is not moderation and not a successful outcome: it keeps
 *   the Post counted for its owner, terminates pending direct interactions in
 *   the same transaction, and notifies nobody (the owner already received the
 *   pre-expiry reminder). Explicit renewal returns the Post to `ACTIVE`,
 *   resets the inactivity window and never revives terminated interactions.
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
    OWNER_RENEW: Object.freeze({
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: true,
      invalidateAdminDashboardCache: false,
      moderationAudit: false,
      ownerNotification: null,
      closeOpenPostReports: false,
      terminatePendingInteractions: false,
    }),
    EXPIRE: Object.freeze({
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: false,
      moderationAudit: false,
      ownerNotification: null,
      closeOpenPostReports: false,
      terminatePendingInteractions: true,
    }),
    ADMIN_RESOLVE: Object.freeze({
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_RESOLVED_BY_ADMIN',
      closeOpenPostReports: false,
      terminatePendingInteractions: true,
    }),
    ADMIN_REOPEN: Object.freeze({
      userPostCountDelta: 'NONE',
      invalidateOwnerUserCache: false,
      invalidateAdminDashboardCache: true,
      moderationAudit: true,
      ownerNotification: 'POST_REOPENED_BY_ADMIN',
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
