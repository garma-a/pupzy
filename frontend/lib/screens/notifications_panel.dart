import 'dart:async';

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/app_notification.dart';
import '../services/graphql_service.dart';
import '../services/notification_center.dart';
import '../theme/app_theme.dart';
import '../utils/notification_routing.dart';
import '../utils/time_format.dart';
import '../widgets/skeleton_loader.dart';

IconData _iconForType(String type) {
  switch (type) {
    case 'NEW_UPVOTE':
      return Icons.arrow_upward;
    case 'POST_SAVED':
      return Icons.bookmark;
    case 'CONTACT_REQUEST_RECEIVED':
      return Icons.mail_outline;
    case 'CONTACT_REQUEST_APPROVED':
    case 'ADOPTION_APPLICATION_APPROVED':
      return Icons.check_circle_outline;
    case 'CONTACT_REQUEST_REJECTED':
    case 'ADOPTION_APPLICATION_REJECTED':
      return Icons.cancel_outlined;
    case 'ADOPTION_APPLICATION_RECEIVED':
      return Icons.assignment_outlined;
    case 'POST_REMOVED_BY_ADMIN':
      return Icons.report_gmailerrorred_outlined;
    case 'POST_RESOLVED_BY_ADMIN':
      return Icons.gavel_outlined;
    case 'POST_REOPENED_BY_ADMIN':
      return Icons.restore_outlined;
    case 'POST_INACTIVITY_NUDGE':
      return Icons.timer_outlined;
    case 'SYSTEM_ANNOUNCEMENT':
      return Icons.campaign_outlined;
    case 'NEW_COMMENT':
    case 'NEW_REPLY':
      return Icons.mode_comment_outlined;
    case 'COMMENT_BOOSTED':
      return Icons.arrow_upward;
    case 'COMMENT_PINNED':
      return Icons.push_pin_outlined;
    // Neutral on purpose: a completed rescue may have ended with the animal's
    // death, so completion never gets a success icon.
    case 'RESCUE_COMPLETED':
    case 'POST_COMPLETED':
      return Icons.flag_outlined;
    case 'RESCUE_REOPENED':
    case 'POST_REOPENED':
      return Icons.restore_outlined;
    default:
      return Icons.notifications_none;
  }
}

class NotificationsPanel extends StatefulWidget {
  const NotificationsPanel({super.key});

  @override
  State<NotificationsPanel> createState() => _NotificationsPanelState();
}

class _NotificationsPanelState extends State<NotificationsPanel> {
  bool _loading = true;
  String? _errorMessage;
  List<AppNotification> _notifications = [];
  bool _markingAllRead = false;
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  StreamSubscription<void>? _arrivals;

  static const _pageSize = 30;

  @override
  void initState() {
    super.initState();
    _load();
    // A push that lands while the inbox is open shows up in it right away.
    _arrivals = context.read<NotificationCenter>().arrivals.listen(
      (_) => _load(quiet: true),
    );
  }

  @override
  void dispose() {
    _arrivals?.cancel();
    super.dispose();
  }

  /// Loads the newest page. [quiet] keeps the current list on screen (pull to
  /// refresh, a push arriving) instead of flashing the skeleton.
  Future<void> _load({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _loading = true;
        _errorMessage = null;
      });
    }
    final graphql = context.read<GraphQLService>();
    final page = await graphql.fetchMyNotifications(first: _pageSize);
    if (!mounted) return;
    if (quiet && page.errorMessage != null) {
      Fluttertoast.showToast(msg: page.errorMessage!);
      return;
    }
    setState(() {
      _loading = false;
      _notifications = page.notifications;
      _endCursor = page.endCursor;
      _hasNextPage = page.hasNextPage;
      _errorMessage = page.errorMessage;
    });
    if (page.errorMessage == null) {
      context.read<NotificationCenter>().setUnreadCount(page.unreadCount);
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage) return;
    setState(() => _loadingMore = true);
    final page = await context.read<GraphQLService>().fetchMyNotifications(
      first: _pageSize,
      after: _endCursor,
    );
    if (!mounted) return;
    setState(() {
      _loadingMore = false;
      if (page.errorMessage != null) return;
      final known = _notifications.map((n) => n.id).toSet();
      _notifications = [
        ..._notifications,
        ...page.notifications.where((n) => !known.contains(n.id)),
      ];
      _endCursor = page.endCursor;
      _hasNextPage = page.hasNextPage;
    });
  }

  int get _unreadCount => _notifications.where((n) => !n.isRead).length;

  Future<void> _markAllRead() async {
    // Paint it read immediately — the list is already on screen and the
    // server returns only a count, so there is nothing else to wait for.
    final previous = _notifications;
    final center = context.read<NotificationCenter>();
    final previousCount = center.unreadCount;
    setState(() {
      _markingAllRead = true;
      _notifications = _notifications
          .map((n) => n.copyWith(isRead: true))
          .toList();
    });
    center.setUnreadCount(0);
    final (_, error) = await context
        .read<GraphQLService>()
        .markAllNotificationsRead();
    if (!mounted) return;
    setState(() {
      _markingAllRead = false;
      if (error != null) _notifications = previous;
    });
    if (error != null) {
      center.setUnreadCount(previousCount);
      Fluttertoast.showToast(msg: error);
    }
  }

  Future<void> _openNotification(AppNotification n) async {
    final graphql = context.read<GraphQLService>();
    if (!n.isRead) {
      setState(() {
        _notifications = _notifications
            .map((x) => x.id == n.id ? x.copyWith(isRead: true) : x)
            .toList();
      });
      context.read<NotificationCenter>().markedOneRead();
      graphql.markNotificationRead(n.id);
    }
    final postId = n.relatedPostId;
    if (postId == null) return;
    // Opened from the root navigator so the Post stays open after this
    // sheet closes; the post being gone is explained with a toast.
    final navigator = Navigator.of(context, rootNavigator: true);
    await openNotificationTarget(
      navigator: navigator,
      graphql: graphql,
      type: n.type,
      postId: postId,
      unavailableMessage: t(
        context,
        "This content isn't available.",
        'هذا المحتوى غير متاح.',
      ),
      beforeNavigate: () {
        if (mounted) Navigator.of(context).pop();
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final lang = context.watch<LangProvider>().lang;
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppRadius.sheet),
            ),
          ),
          child: Column(
            children: [
              const SizedBox(height: AppSpacing.sm),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        t(context, 'Notifications', 'الإشعارات'),
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                    ),
                    if (_unreadCount > 0)
                      TextButton(
                        onPressed: _markingAllRead ? null : _markAllRead,
                        child: Text(
                          t(context, 'Mark all read', 'تعليم الكل كمقروء'),
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: _loading
                    ? ListView(
                        children: const [
                          ListRowSkeleton(),
                          ListRowSkeleton(),
                          ListRowSkeleton(),
                          ListRowSkeleton(),
                        ],
                      )
                    : _errorMessage != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.xl,
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.cloud_off_outlined,
                                size: 40,
                                color: AppColors.textMuted,
                              ),
                              const SizedBox(height: AppSpacing.sm),
                              Text(
                                _errorMessage!,
                                style: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(color: AppColors.textMuted),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: AppSpacing.md),
                              OutlinedButton(
                                onPressed: _load,
                                child: Text(
                                  t(context, 'Retry', 'إعادة المحاولة'),
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    : _notifications.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.notifications_none,
                              size: 44,
                              color: AppColors.textMuted,
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              t(
                                context,
                                'No notifications yet',
                                'لا توجد إشعارات بعد',
                              ),
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () => _load(quiet: true),
                        child: ListView.builder(
                          controller: scrollController,
                          physics: const AlwaysScrollableScrollPhysics(),
                          itemCount:
                              _notifications.length + (_hasNextPage ? 1 : 0),
                          itemBuilder: (context, i) {
                            if (i == _notifications.length) {
                              // Reaching the end of what's loaded fetches the
                              // next, older page.
                              WidgetsBinding.instance.addPostFrameCallback(
                                (_) => _loadMore(),
                              );
                              return const Padding(
                                padding: EdgeInsets.all(AppSpacing.lg),
                                child: Center(
                                  child: SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  ),
                                ),
                              );
                            }
                            final n = _notifications[i];
                            return ListTile(
                              onTap: () => _openNotification(n),
                              leading: Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withValues(
                                    alpha: 0.12,
                                  ),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  _iconForType(n.type),
                                  size: 18,
                                  color: AppColors.primary,
                                ),
                              ),
                              title: Text(
                                n.title,
                                style: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    n.body,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodySmall,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  Text(
                                    timeAgo(n.createdAt, lang),
                                    style: Theme.of(context).textTheme.bodySmall
                                        ?.copyWith(color: AppColors.textMuted),
                                  ),
                                ],
                              ),
                              isThreeLine: true,
                              tileColor: n.isRead
                                  ? null
                                  : AppColors.primary.withValues(alpha: 0.05),
                            );
                          },
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
