import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../screens/notifications_panel.dart';
import '../screens/profile_screen.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class PupzyTopBar extends StatelessWidget {
  const PupzyTopBar({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthService>().currentUser;
    final photoUrl = user?.photoURL;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        0,
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.asset(
              'assets/images/Logo.png',
              width: 80,
              height: 80,
              color: AppColors.primary,
              colorBlendMode: BlendMode.srcIn,
            ),
          ),
          const Spacer(),
          _NotifButton(),
          const SizedBox(width: AppSpacing.sm),
          Semantics(
            button: true,
            label: t(context, 'Open profile', 'فتح الملف الشخصي'),
            child: GestureDetector(
              onTap: () {
                showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Colors.transparent,
                  builder: (_) => const ProfileSheet(),
                );
              },
              child: CircleAvatar(
                radius: 20,
                backgroundImage:
                    photoUrl != null ? NetworkImage(photoUrl) : null,
                child: photoUrl == null
                    ? Text(
                        user?.displayName?.isNotEmpty == true
                            ? user!.displayName![0].toUpperCase()
                            : '?',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.textPrimary,
                        ),
                      )
                    : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NotifButton extends StatefulWidget {
  @override
  State<_NotifButton> createState() => _NotifButtonState();
}

class _NotifButtonState extends State<_NotifButton> {
  bool get _hasUnread => MockData.notifications.any((n) => !n.isRead);

  @override
  Widget build(BuildContext context) {
    final hasUnread = _hasUnread;
    return Semantics(
      button: true,
      label: hasUnread
          ? t(context, 'Notifications, unread', 'الإشعارات، غير مقروءة')
          : t(context, 'Notifications', 'الإشعارات'),
      child: GestureDetector(
        onTap: () async {
          await showModalBottomSheet(
            context: context,
            isScrollControlled: true,
            backgroundColor: Colors.transparent,
            builder: (_) => const NotificationsPanel(),
          );
          if (mounted) setState(() {});
        },
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.surface,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.border),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(
                Icons.notifications_none,
                size: 20,
                color: AppColors.textSecondary,
              ),
              if (hasUnread)
                Positioned(
                  top: 8,
                  right: 8,
                  child: Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      color: AppColors.critical,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
