import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/notification_item.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';

class NotificationsPanel extends StatelessWidget {
  const NotificationsPanel({super.key});

  IconData _iconFor(NotificationType type) {
    switch (type) {
      case NotificationType.like:
        return Icons.favorite;
      case NotificationType.comment:
        return Icons.chat_bubble;
      case NotificationType.follow:
        return Icons.person_add;
    }
  }

  @override
  Widget build(BuildContext context) {
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
                child: ListView.builder(
                  controller: scrollController,
                  itemCount: MockData.notifications.length,
                  itemBuilder: (context, i) {
                    final n = MockData.notifications[i];
                    return ListTile(
                      leading: Stack(
                        children: [
                          CircleAvatar(backgroundImage: NetworkImage(n.avatarUrl)),
                          Positioned(
                            right: -2,
                            bottom: -2,
                            child: Container(
                              padding: const EdgeInsets.all(3),
                              decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                              child: Icon(_iconFor(n.type), size: 10, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                      title: RichText(
                        text: TextSpan(
                          style: Theme.of(context).textTheme.bodyMedium,
                          children: [
                            TextSpan(text: n.username, style: const TextStyle(fontWeight: FontWeight.w700)),
                            TextSpan(text: ' ${n.actionText}'),
                          ],
                        ),
                      ),
                      subtitle: Text(timeAgo(n.timestamp, context.watch<LangProvider>().lang), style: Theme.of(context).textTheme.bodySmall),
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
