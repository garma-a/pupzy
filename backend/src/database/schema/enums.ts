import { pgEnum } from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// POST ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminates which vertical a post belongs to.
 * Drives the CTI join at the detail-screen level.
 */
export const postTypeEnum = pgEnum('post_type', [
  'RESCUE',
  'LOST',
  'ADOPTION',
  'PRODUCT',
  'MATING', // Pet mating (تزاوج) — owner keeps the pet; same-species partner search
]);

/**
 * Discriminator within the LOST section.
 * Replaces what would have been a 5th post_type.
 */
export const lostFoundTypeEnum = pgEnum('lost_found_type', ['LOST_PET', 'FOUND_STRAY']);

/**
 * Lifecycle state of a post.
 * ADOPTED and SOLD hide posts from feeds instantly but keep them in
 * the creator's post history. REMOVED is a soft delete.
 */
export const postStatusEnum = pgEnum('post_status', ['ACTIVE', 'RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'REMOVED']);

/**
 * AI / admin moderation lifecycle.
 * Posts are live immediately — a rescue alert cannot wait on review.
 */
export const moderationStatusEnum = pgEnum('moderation_status', ['PENDING_AUTO_REVIEW', 'CLEAN', 'FLAGGED']);

/**
 * Declared in CRITICAL → MODERATE order so PostgreSQL's ASC sort
 * gives CRITICAL first on the Help feed automatically — no extra logic needed.
 */
export const urgencyTierEnum = pgEnum('urgency_tier', ['CRITICAL', 'URGENT', 'MODERATE']);

// ─────────────────────────────────────────────────────────────────────────────
// ANIMAL ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const speciesTypeEnum = pgEnum('species_type', ['DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER']);

export const genderTypeEnum = pgEnum('gender_type', ['MALE', 'FEMALE', 'UNKNOWN']);

export const ageUnitEnum = pgEnum('age_unit', ['DAYS', 'WEEKS', 'MONTHS', 'YEARS']);

// ─────────────────────────────────────────────────────────────────────────────
// RESCUE-SPECIFIC ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coordination signal on a rescue post — tells responders what kind of
 * help is needed based on the reporter's current situation.
 */
export const reporterRoleEnum = pgEnum('reporter_role', [
  'REPORTING', // Spotted animal but no longer on site
  'ON_SITE', // Currently with animal — send help here
  'CAN_TRANSPORT', // On site and can move — provide a destination
]);

export const foundAnimalConditionEnum = pgEnum('found_animal_condition', ['HEALTHY', 'INJURED', 'UNKNOWN']);

// ─────────────────────────────────────────────────────────────────────────────
// ADOPTION-SPECIFIC ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const spaceRequirementEnum = pgEnum('space_requirement', [
  'APARTMENT_OK',
  'NEEDS_YARD',
  'NEEDS_FARM_OR_LARGE_SPACE',
]);

export const livingSituationEnum = pgEnum('living_situation', ['APARTMENT', 'HOUSE_WITH_YARD', 'FARM', 'OTHER']);

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT-SPECIFIC ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const productCategoryEnum = pgEnum('product_category', [
  'CARE',
  'FOOD',
  'TRANSPORT',
  'ACCESSORIES',
  'GROOMING',
  'MEDICAL_SUPPLIES',
  'OTHER',
]);

export const productConditionEnum = pgEnum('product_condition', ['NEW', 'LIKE_NEW', 'USED']);

// ─────────────────────────────────────────────────────────────────────────────
// SHARED ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const requestStatusEnum = pgEnum('request_status', ['PENDING', 'APPROVED', 'REJECTED']);

export const reportReasonEnum = pgEnum('report_reason', [
  'UNRELATED_TO_ANIMALS',
  'SPAM',
  'INAPPROPRIATE_CONTENT',
  'SCAM',
  'DUPLICATE',
  'OTHER',
]);

export type ReportReason = (typeof reportReasonEnum.enumValues)[number];

export const notificationTypeEnum = pgEnum('notification_type', [
  'NEW_UPVOTE',
  'POST_SAVED',
  'CONTACT_REQUEST_RECEIVED',
  'CONTACT_REQUEST_APPROVED',
  'CONTACT_REQUEST_REJECTED',
  'ADOPTION_APPLICATION_RECEIVED',
  'ADOPTION_APPLICATION_APPROVED',
  'ADOPTION_APPLICATION_REJECTED',
  'POST_REMOVED_BY_ADMIN',
  'POST_INACTIVITY_NUDGE',
  'SYSTEM_ANNOUNCEMENT',
]);

// ─────────────────────────────────────────────────────────────────────────────
// CITY ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle status of a City reference record.
 * - OFFICIAL: Authoritative selectable city in active catalog
 * - LEGACY: Historical city retained for data integrity
 * - RETIRED: Former official city removed/replaced
 */
export const cityLifecycleStatusEnum = pgEnum('city_lifecycle_status', ['OFFICIAL', 'LEGACY', 'RETIRED']);

export type CityLifecycleStatus = (typeof cityLifecycleStatusEnum.enumValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALITY TAGS — TypeScript union only, NOT a Postgres enum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Personality tags stored as `text[]` in Postgres (not a PG enum array).
 * Drizzle ORM does not reliably support PG enum arrays.
 * Each value is validated against this tuple in the service layer before insert.
 */
export const PERSONALITY_TAGS = [
  'PLAYFUL',
  'GENTLE',
  'INDOOR',
  'OUTDOOR',
  'GOOD_WITH_KIDS',
  'GOOD_WITH_CATS',
  'GOOD_WITH_DOGS',
  'SHY',
  'ENERGETIC',
  'CALM',
] as const;

export type PersonalityTag = (typeof PERSONALITY_TAGS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// STAGED UPLOAD ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purpose of an upload ticket.
 * Binds the media to a specific vertical/domain to prevent purpose confusion.
 */
export const stagedUploadPurposeEnum = pgEnum('staged_upload_purpose', ['POST_MEDIA', 'COMMENT_IMAGE']);

export type StagedUploadPurpose = (typeof stagedUploadPurposeEnum.enumValues)[number];

/**
 * Lifecycle states of a staged upload ticket.
 * - ISSUED: Ticket issued with presigned PUT URL, awaiting client upload.
 * - CLAIMED: Atomically claimed during post or comment creation to prevent concurrent reuse.
 * - FINALIZED: Verified and copied to permanent public storage.
 * - FAILED: Expired, missing in R2, or failed during finalization.
 */
export const stagedUploadStatusEnum = pgEnum('staged_upload_status', [
  'ISSUED',
  'CLAIMED',
  'FINALIZED',
  'FAILED',
  'EXPIRED',
]);

export type StagedUploadStatus = (typeof stagedUploadStatusEnum.enumValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moderation and lifecycle states of a comment.
 * - ACTIVE: Visible in discussions.
 * - IMAGE_HIDDEN: Text visible, images hidden by reports.
 * - HIDDEN: Temporarily hidden by reports.
 * - DELETED: Deleted by author (neutral structural tombstone if replies exist).
 * - REMOVED: Permanently removed by administrator.
 */
export const commentStatusEnum = pgEnum('comment_status', ['ACTIVE', 'IMAGE_HIDDEN', 'HIDDEN', 'DELETED', 'REMOVED']);

export type CommentStatus = (typeof commentStatusEnum.enumValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA DELETION ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status of background media deletion work items.
 * - PENDING: Queued for deletion from R2 and CDN cache purge.
 * - PROCESSING: Currently being executed by worker.
 * - COMPLETED: Successfully deleted from R2 and purged from CDN.
 * - FAILED: Reached maximum retry attempts; visible for operator intervention.
 */
export const mediaDeletionStatusEnum = pgEnum('media_deletion_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export type MediaDeletionStatus = (typeof mediaDeletionStatusEnum.enumValues)[number];
