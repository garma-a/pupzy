import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { cities } from './cities.schema';
import { users } from './users.schema';
import {
  postTypeEnum,
  postStatusEnum,
  moderationStatusEnum,
  urgencyTierEnum,
  productCategoryEnum,
} from './enums';

/**
 * `posts` table — Class Table Inheritance (CTI) base table.
 *
 * ## CTI pattern
 * Every post — regardless of type — has a row here. The extension tables
 * (`rescue_posts`, `lost_posts`, `adoption_posts`, `product_posts`) share
 * the same primary key and are joined **only** on the single-post detail
 * screen. Feed and list queries never touch the extension tables.
 *
 * ## Location (merged from former post_locations)
 * The former `post_locations` table was a 1:1 that every feed query joined.
 * `city_id`, `area_name`, and `coordinates` now live directly on this table,
 * eliminating both the join and the sync logic.
 *
 * ## Coordinate privacy (enforced in resolver, NOT here)
 * - RESCUE / LOST → coordinates returned as { latitude, longitude }
 * - ADOPTION / PRODUCT → coordinates stripped; city + distance only
 *
 * ## Engagement counters
 * - `upvote_count` — RESCUE, LOST, ADOPTION only. Always 0 for PRODUCT.
 * - `save_count` — all 4 types. On PRODUCT acts as buyer wishlist.
 * - `view_count` — all 4 types. Updated via Redis buffer flush cron only.
 * - `report_count` — denormalized from post_reports for AdminJS moderation queue.
 *
 * ## Ranking
 * `effective_score` is always 0 for RESCUE/LOST (sorted by urgency + recency).
 * Recalculated on every upvote/save and on every view-flush cron run.
 *
 * ## Indexes
 * Standard B-tree indexes are declared below. Partial indexes (WHERE clauses)
 * cannot be expressed in Drizzle and are added in custom migration SQL.
 * See drizzle/migrations/custom.sql for the full list.
 */
export const posts = pgTable(
  'posts',
  {
    /** Internal post ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    /** FK → users. CASCADE on user delete. */
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Which vertical this post belongs to. Drives CTI join on detail screen. */
    postType: postTypeEnum('post_type').notNull(),

    /** Post headline. Max 200 chars. */
    title: varchar('title', { length: 200 }).notNull(),

    /** Full post body. */
    description: text('description').notNull(),

    /** Lifecycle status. ADOPTED/SOLD hide from feeds, stay in history. */
    status: postStatusEnum('status').notNull().default('ACTIVE'),

    /** Moderation state. Posts are live immediately — rescue cannot wait. */
    moderationStatus: moderationStatusEnum('moderation_status')
      .notNull()
      .default('PENDING_AUTO_REVIEW'),

    /**
     * Emergency urgency tier. Required for RESCUE and LOST; must be NULL for
     * ADOPTION and PRODUCT. No database default — a missing urgency on an
     * emergency post should fail loudly, not silently fall back to MODERATE.
     * Enforced by CHECK constraint chk_posts_urgency_by_type in custom SQL.
     */
    urgency: urgencyTierEnum('urgency'),

    // ── Location (merged from former post_locations) ──────────────────────────

    /** City this post is scoped to. FK → cities. RESTRICT on city delete. */
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),

    /**
     * Human-readable neighborhood, e.g. "Maadi". Optional.
     * Shown on cards below the city name.
     */
    areaName: varchar('area_name', { length: 200 }),

    /**
     * Exact GPS coordinates as PostGIS POINT(longitude, latitude). SRID=4326.
     * Stored for all 4 post types but returned to clients only for RESCUE/LOST.
     * GIST index added in custom migration SQL.
     * Stored as text EWKT so Drizzle can write/read without PostGIS driver issues.
     */
    coordinates: text('coordinates').notNull(),

    // ── Market category — denormalized from product_posts ─────────────────────

    /**
     * NULL for RESCUE, LOST, ADOPTION.
     * Kept in sync with product_posts.category by the service layer on INSERT/UPDATE.
     * Enables category-filtered market feed browsing via idx_posts_market_category
     * without joining product_posts on every paginated request.
     */
    marketCategory: productCategoryEnum('market_category'),

    // ── Engagement counters ───────────────────────────────────────────────────

    /**
     * RESCUE, LOST, ADOPTION only. Always 0 for PRODUCT (resolver rejects
     * upvotes on PRODUCT — no upvote button on Market feed).
     */
    upvoteCount: integer('upvote_count').notNull().default(0),

    /** All 4 post types. On PRODUCT acts as buyer wishlist/bookmark. */
    saveCount: integer('save_count').notNull().default(0),

    /**
     * All 4 post types. Primary ranking signal for PRODUCT.
     * NEVER written per-request — only updated via Redis buffer flush cron
     * every 2-3 minutes. See view tracking flow in master config.
     */
    viewCount: integer('view_count').notNull().default(0),

    /**
     * Denormalized from post_reports. AdminJS moderation queue sorts by this
     * to surface most-reported posts first.
     */
    reportCount: integer('report_count').notNull().default(0),

    // ── Feed ranking ──────────────────────────────────────────────────────────

    /**
     * Always 0.0 for RESCUE and LOST (sorted by urgency + recency instead).
     *
     * ADOPTION formula:
     *   (upvote_count × 3 + save_count × 2 + view_count × 0.1 + 1) / POWER(age_hours + 2, 1.5)
     *
     * PRODUCT formula:
     *   (view_count × 1 + save_count × 5 + 1) / POWER(age_hours + 2, 1.5)
     *
     * Recalculated immediately on upvote/save and by the view-flush cron.
     */
    effectiveScore: doublePrecision('effective_score').notNull().default(0.0),

    // ── Auto-removal ──────────────────────────────────────────────────────────

    /**
     * Initialized to created_at on INSERT. Updated differently per type:
     *   ADOPTION → upvotes and saves only (views alone too passive). Auto-removed after 30 days.
     *   PRODUCT  → views and saves. A view means a buyer looked. Auto-removed after 14 days.
     *   RESCUE / LOST → never updated. Never auto-removed.
     * Before the cron removes a post, POST_INACTIVITY_NUDGE is sent to the creator.
     */
    lastEngagedAt: timestamp('last_engaged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Row last-update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // ── Profile / post history ──────────────────────────────────────────────
    creatorCreatedIdx: index('idx_posts_creator_created').on(
      table.creatorId,
      table.createdAt,
    ),
    creatorStatusIdx: index('idx_posts_creator_status').on(
      table.creatorId,
      table.status,
      table.createdAt,
    ),

    // ── City scoping (used by all feed queries) ──────────────────────────────
    cityTypeIdx: index('idx_posts_city_type').on(table.cityId, table.postType),

    /*
     * All partial indexes below require WHERE clauses and cannot be expressed
     * in Drizzle's index() API. They are added in custom migration SQL.
     *
     * See drizzle/migrations/custom.sql for:
     *   idx_posts_help_feed       — (city_id, post_type, urgency, created_at) WHERE status='ACTIVE' AND post_type IN ('RESCUE','LOST')
     *   idx_posts_adopt_score     — (city_id, effective_score, created_at) WHERE status='ACTIVE' AND post_type='ADOPTION'
     *   idx_posts_market_score    — (city_id, effective_score, created_at) WHERE status='ACTIVE' AND post_type='PRODUCT'
     *   idx_posts_market_category — (city_id, market_category, effective_score) WHERE status='ACTIVE' AND post_type='PRODUCT'
     *   idx_posts_moderation      — (report_count, created_at) WHERE moderation_status='FLAGGED'
     *   idx_posts_last_engaged    — (post_type, last_engaged_at) WHERE status='ACTIVE' AND post_type IN ('ADOPTION','PRODUCT')
     *
     * GIST index on coordinates:
     *   idx_posts_coordinates — USING GIST (coordinates)
     */
  }),
);

/** TypeScript type for a full `posts` row. */
export type Post = typeof posts.$inferSelect;

/** TypeScript type for inserting a new `posts` row. */
export type NewPost = typeof posts.$inferInsert;
