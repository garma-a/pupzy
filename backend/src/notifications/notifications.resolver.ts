import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { NotificationsService } from './notifications.service';
import type { GqlContext } from '../common/types/gql-context.type';
import type { Notification } from '../database/schema';

/**
 * NotificationsResolver — GraphQL resolver for notification queries and mutations.
 *
 * ## Authentication
 * All operations require a logged-in user (global FirebaseAuthGuard).
 * Notifications are scoped to the current user — no cross-user access.
 */
@Resolver('Notification')
export class NotificationsResolver {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Returns the current user's notification inbox, newest first.
   * Supports cursor-based pagination for infinite scroll.
   */
  @Query('myNotifications')
  async myNotifications(
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Context() ctx: GqlContext,
  ) {
    return this.notificationsService.getMyNotifications(ctx.user!.id, first, after);
  }

  /**
   * Returns the unread notification count for the badge indicator.
   */
  @Query('myUnreadNotificationCount')
  async myUnreadNotificationCount(@Context() ctx: GqlContext): Promise<number> {
    return this.notificationsService.getUnreadCount(ctx.user!.id);
  }

  /**
   * Marks a single notification as read.
   * Returns the updated notification.
   */
  @Mutation('markNotificationRead')
  async markNotificationRead(
    @Args('notificationId') notificationId: string,
    @Context() ctx: GqlContext,
  ): Promise<Notification> {
    return this.notificationsService.markRead(notificationId, ctx.user!.id);
  }

  /**
   * Marks ALL notifications for the current user as read.
   * Returns the count of notifications updated.
   */
  @Mutation('markAllNotificationsRead')
  async markAllNotificationsRead(@Context() ctx: GqlContext): Promise<number> {
    return this.notificationsService.markAllRead(ctx.user!.id);
  }
}
