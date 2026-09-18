import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * `blocks` — directional safety relationships between two Pupzy Accounts.
 *
 * A Block is owned by its initiating (blocker) account, but any active Block in
 * either direction isolates the pair for user-facing reads and writes.
 *
 * ## Constraints
 * - The ordered pair `(blocker_id, blocked_id)` is unique; the reverse pair is a
 *   distinct relationship owned by the other Pupzy Account.
 * - A check constraint prohibits self-blocking.
 * - Both foreign keys cascade so Account Deletion removes every Block involving
 *   the account and leaves unrelated relationships intact.
 *
 * ## Indexes
 * | Index                      | Serves                                        |
 * |----------------------------|-----------------------------------------------|
 * | unique_block_ordered_pair  | duplicate prevention + directed pair lookup   |
 * | idx_blocks_blocked         | reverse-direction pair lookup                 |
 * | idx_blocks_blocker_created | newest-first Blocked Accounts pagination      |
 */
export const blocks = pgTable(
  'blocks',
  {
    /** Internal Block ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** FK → users. The Pupzy Account that initiated and owns the Block. */
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** FK → users. The Pupzy Account isolated by the Block. */
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Row creation timestamp. Blocked Accounts pagination orders by this column. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_block_ordered_pair').on(table.blockerId, table.blockedId),
    index('idx_blocks_blocked').on(table.blockedId),
    index('idx_blocks_blocker_created').on(table.blockerId, table.createdAt.desc(), table.id.desc()),
    check('blocks_no_self_block', sql`${table.blockerId} <> ${table.blockedId}`),
  ],
);

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
