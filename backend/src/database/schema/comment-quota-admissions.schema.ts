import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

export const commentQuotaAdmissions = pgTable(
  'comment_quota_admissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 32 }).notNull(),
    clientRequestId: varchar('client_request_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_comment_quota_admissions_user_action_created').on(table.userId, table.action, table.createdAt),
    index('idx_comment_quota_admissions_user_client_request').on(table.userId, table.clientRequestId),
  ],
);

export type CommentQuotaAdmission = typeof commentQuotaAdmissions.$inferSelect;
export type NewCommentQuotaAdmission = typeof commentQuotaAdmissions.$inferInsert;
