import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/app_notification.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/skeleton_loader.dart';
import 'adoption_detail_screen.dart';
import 'product_detail_screen.dart';
import 'rescue_detail_screen.dart';

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
    case 'POST_INACTIVITY_NUDGE':
      return Icons.timer_outlined;
    case 'SYSTEM_ANNOUNCEMENT':
      return Icons.campaign_outlined;
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final (notifications, _, error) = await graphql.fetchMyNotifications();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _notifications = notifications;
      _errorMessage = error;
    });
  }

  Future<void> _openNotification(AppNotification n) async {
    final graphql = context.read<GraphQLService>();
    if (!n.isRead) {
      setState(() {
        _notifications = _notifications.map((x) => x.id == n.id ? x.copyWith(isRead: true) : x).toList();
      });
      graphql.markNotificationRead(n.id);
    }
    final postId = n.relatedPostId;
    if (postId == null) return;
    final (post, _) = await graphql.fetchPostDetail(postId);
    if (!mounted || post == null) return;
    Navigator.of(context).pop();
    switch (post.postType) {
      case 'RESCUE':
      case 'LOST':
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => RescueDetailScreen(postId: postId)));
        break;
      case 'ADOPTION':
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => AdoptionDetailScreen(postId: postId)));
        break;
      case 'PRODUCT':
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductDetailScreen(postId: postId)));
        break;
    }
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
            borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
          ),
          child: Column(
            children: [
              const SizedBox(height: AppSpacing.sm),
              Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Text(t(context, 'Notifications', 'الإشعارات'), style: Theme.of(context).textTheme.headlineMedium),
              ),
              Expanded(
                child: _loading
                    ? ListView(
                        children: const [ListRowSkeleton(), ListRowSkeleton(), ListRowSkeleton(), ListRowSkeleton()],
                      )
                    : _errorMessage != null
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                                  const SizedBox(height: AppSpacing.sm),
                                  Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                                  const SizedBox(height: AppSpacing.md),
                                  OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                                ],
                              ),
                            ),
                          )
                        : _notifications.isEmpty
                            ? Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.notifications_none, size: 44, color: AppColors.textMuted),
                                    const SizedBox(height: AppSpacing.sm),
                                    Text(
                                      t(context, 'No notifications yet', 'لا توجد إشعارات بعد'),
                                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                    ),
                                  ],
                                ),
                              )
                            : ListView.builder(
                                controller: scrollController,
                                itemCount: _notifications.length,
                                itemBuilder: (context, i) {
                                  final n = _notifications[i];
                                  return ListTile(
                                    onTap: () => _openNotification(n),
                                    leading: Container(
                                      width: 40,
                                      height: 40,
                                      decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.12), shape: BoxShape.circle),
                                      child: Icon(_iconForType(n.type), size: 18, color: AppColors.primary),
                                    ),
                                    title: Text(n.title, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                                    subtitle: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(n.body, style: Theme.of(context).textTheme.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                                        Text(timeAgo(n.createdAt, lang), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
                                      ],
                                    ),
                                    isThreeLine: true,
                                    tileColor: n.isRead ? null : AppColors.primary.withValues(alpha: 0.05),
                                  );
                                },
                              ),
              ),
            ],
          ),
        );
      },
    );
  }
}
