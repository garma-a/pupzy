import { pgTable, uuid, varchar, boolean, numeric } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { productCategoryEnum, productConditionEnum } from './enums';

/**
 * `product_posts` — CTI extension table for `post_type = 'PRODUCT'`.
 *
 * ## CTI pattern
 * Shares the primary key with `posts`. Joined ONLY on the single-post
 * detail screen — never on feed or list queries.
 *
 * ## Category denormalization
 * `category` is the source of truth here.
 * `posts.market_category` is a denormalized copy kept in sync by the service
 * layer on INSERT/UPDATE. The denormalized column enables the category-filtered
 * market feed index (`idx_posts_market_category`) without joining this table
 * on every paginated request.
 *
 * ## No upvotes
 * PRODUCT posts cannot be upvoted. The Market feed has no upvote button.
 * `posts.upvote_count` stays 0 for all PRODUCT rows. Resolver rejects
 * upvote mutations on PRODUCT.
 *
 * ## View-driven ranking
 * `view_count` is the primary ranking signal for PRODUCT (there are no upvotes).
 * `last_engaged_at` is updated on views (via cron flush) and saves.
 * Auto-removed after 14 days of no views.
 *
 * ## Contact model
 * Seller's phone number is decrypted and returned directly as seller contact
 * on the detail screen — no contact-request approval gate. The wa.me/ link is
 * built at query time from the decrypted phone number; nothing is stored.
 *
 * ## Price / free constraint
 * `price_amount` must be NULL when `is_free = true`.
 * `price_amount` must be NOT NULL when `is_free = false`.
 * Enforced by CHECK constraint `chk_product_price_by_free` in custom migration SQL.
 */
export const productPosts = pgTable('product_posts', {
  /**
   * Shared primary key with `posts.id`.
   */
  postId: uuid('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),

  /**
   * Source of truth for category. `posts.market_category` is denormalized from here.
   * Service layer keeps both in sync on every INSERT/UPDATE.
   */
  category: productCategoryEnum('category').notNull(),

  /** Physical condition of the item. */
  condition: productConditionEnum('condition').notNull(),

  /**
   * Price in Egyptian Pounds (or `price_currency`).
   * NULL only when `is_free = true`.
   * Enforced by CHECK constraint `chk_product_price_by_free` in custom migration SQL.
   * Using NUMERIC(10,2) for exact decimal storage — avoids floating-point issues
   * with monetary values.
   */
  priceAmount: numeric('price_amount', { precision: 10, scale: 2 }),

  /**
   * ISO 4217 currency code. Defaults to EGP (Egyptian Pound).
   * Stored per-listing for future multi-currency support.
   */
  priceCurrency: varchar('price_currency', { length: 3 }).notNull().default('EGP'),

  /**
   * Whether the item is being given away for free.
   * When true, `price_amount` must be NULL (CHECK constraint).
   */
  isFree: boolean('is_free').notNull().default(false),

  /**
   * Whether the seller is willing to negotiate on price.
   * Shown as a badge on the card so buyers know negotiation is welcome.
   */
  openToOffers: boolean('open_to_offers').notNull().default(false),
});

/** TypeScript type for a full `product_posts` row. */
export type ProductPost = typeof productPosts.$inferSelect;

/** TypeScript type for inserting a new `product_posts` row. */
export type NewProductPost = typeof productPosts.$inferInsert;
