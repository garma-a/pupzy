import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.schema';

export const moderationActionTypeEnum = pgEnum('moderation_action_type', [
  'POST_APPROVED',
  'POST_FLAGGED',
  'POST_REMOVED',
  'POST_RESTORED',
  'USER_BANNED',
  'USER_UNBANNED',
]);

export const moderationTargetTypeEnum = pgEnum('moderation_target_type', ['POST', 'USER']);

/**
 * Append-only audit log. targetId is polymorphic and deliberately has no
 * foreign key; targetType selects the posts or users table.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    adminUserId: uuid('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    actionType: moderationActionTypeEnum('action_type').notNull(),
    targetType: moderationTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index('idx_moderation_actions_target').on(table.targetType, table.targetId, table.createdAt),
    adminIdx: index('idx_moderation_actions_admin').on(table.adminUserId, table.createdAt),
    typeIdx: index('idx_moderation_actions_type').on(table.actionType, table.createdAt),
  }),
);

export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;
