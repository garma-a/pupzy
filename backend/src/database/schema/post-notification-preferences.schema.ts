import { pgTable, uuid, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';

/** Explicit mute survives subsequent saves, Boosts, and Comments. */
export const postNotificationPreferences = pgTable(
  'post_notification_preferences',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    muted: boolean('muted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.userId] }),
    userIdx: index('idx_post_notification_preferences_user').on(table.userId),
  }),
);
