import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../localization/lang_provider.dart';
import '../screens/notifications_panel.dart';
import '../screens/profile_screen.dart';
import '../services/auth_service.dart';
import '../services/browse_location_service.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'city_picker_sheet.dart';

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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
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
          const _LocationPill(),
        ],
      ),
    );
  }
}

/// "📍 Cairo, Egypt"-style area picker, shared across Home/Help/Adopt/Market
/// (all four render this same top bar). Lets the user browse posts in a
/// different city than their real location — mirrors the classifieds-app
/// pattern where you pick an area up top and every filter below respects it.
class _LocationPill extends StatefulWidget {
  const _LocationPill();

  @override
  State<_LocationPill> createState() => _LocationPillState();
}

class _LocationPillState extends State<_LocationPill> {
  final _searchController = TextEditingController();
  List<Map<String, dynamic>> _cities = [];
  bool _citiesLoaded = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _openPicker() async {
    if (!_citiesLoaded) {
      final graphql = context.read<GraphQLService>();
      final cities = await graphql.fetchCities();
      if (!mounted) return;
      setState(() {
        _cities = cities;
        _citiesLoaded = true;
      });
    }
    if (!mounted) return;
    _searchController.clear();
    final browseLocation = context.read<BrowseLocationService>();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => CityPickerSheet(
        cities: _cities,
        searchController: _searchController,
        title: t(context, 'Browse a location', 'تصفح موقعًا'),
        onUseCurrentLocation: () {
          browseLocation.clear();
          Navigator.of(ctx).pop();
        },
        onSelected: (city) {
          browseLocation.setCity(city);
          Navigator.of(ctx).pop();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selected = context.watch<BrowseLocationService>().selectedCity;
    final lang = context.watch<LangProvider>().lang;
    final label = selected != null
        ? '${lang == Lang.ar ? selected['nameArabic'] : selected['nameEnglish']}, ${selected['governorate']}'
        : t(context, 'Near me', 'بالقرب مني');

    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Semantics(
        button: true,
        label: t(context, 'Change browse location', 'تغيير موقع التصفح'),
        child: GestureDetector(
          onTap: _openPicker,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.location_on, size: 16, color: AppColors.primary),
              const SizedBox(width: 2),
              Flexible(
                child: Text(
                  label,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(Icons.keyboard_arrow_down, size: 16, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _NotifButton extends StatefulWidget {
  @override
  State<_NotifButton> createState() => _NotifButtonState();
}

class _NotifButtonState extends State<_NotifButton> {
  int _unreadCount = 0;

  @override
  void initState() {
    super.initState();
    _refreshUnreadCount();
  }

  Future<void> _refreshUnreadCount() async {
    final graphql = context.read<GraphQLService>();
    final (count, _) = await graphql.fetchMyUnreadNotificationCount();
    if (mounted) setState(() => _unreadCount = count ?? 0);
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _unreadCount > 0;
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
          _refreshUnreadCount();
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
                PositionedDirectional(
                  top: 8,
                  end: 8,
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
