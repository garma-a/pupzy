import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../services/notification_center.dart';
import '../services/push_service.dart';
import '../services/terms_gate.dart';
import '../theme/app_theme.dart';
import '../widgets/distance_filter.dart';
import 'adopt_screen.dart';
import 'help_screen.dart';
import 'home_screen.dart';
import 'market_screen.dart';
import 'new_post_sheet.dart';


class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  int _index = 0;
  // Home is visited immediately; the other 3 feed tabs only start fetching
  // once the user actually opens them, instead of all firing at launch.
  final Set<int> _visitedIndices = {0};
  double _maxDistance = 15.0;
  bool _postSheetOpen = false;

  @override
  void initState() {
    super.initState();
    // Runs once per authenticated session: sync the explicit language
    // preference with the backend (so notifications/push render in the
    // right language), register this device for push, and show the Terms
    // acceptance sheet if the backend says it's required. Deferred to a
    // post-frame callback so it runs after the first build has a BuildContext
    // with every provider (and a Navigator) available.
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrapSession());
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Back from the background: notifications may have arrived meanwhile
  /// (the badge would otherwise stay stale), and the user may have allowed
  /// notifications in the phone's settings.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final graphql = context.read<GraphQLService>();
    context.read<NotificationCenter>().refresh(graphql);
    context.read<PushService>().ensureRegistered();
  }

  Future<void> _bootstrapSession() async {
    if (!mounted) return;
    final graphql = context.read<GraphQLService>();
    final me = await graphql.fetchMe();
    if (!mounted) return;
    final serverLang = me?['languagePreference'] as String?;
    final localLang = context.read<LangProvider>().lang;
    if (serverLang == 'ar' || serverLang == 'en') {
      // The backend is the multi-device source of truth once synchronized.
      final serverIsAr = serverLang == 'ar';
      if ((localLang == Lang.ar) != serverIsAr) {
        context.read<LangProvider>().setLang(serverIsAr ? Lang.ar : Lang.en);
      }
    } else {
      // Never synchronized (e.g. an account created before this feature, or
      // native Sign in with Apple/Google onboarding that skipped it) — push
      // the on-device choice up once so notifications stop defaulting to
      // English.
      graphql.updateMyLanguagePreference(localLang == Lang.ar ? 'ar' : 'en');
    }

    if (!mounted) return;
    context.read<PushService>().initialize(graphql, context.read<NotificationCenter>());

    if (!mounted) return;
    ensureTermsAccepted(context);
  }

  void _goToIndex(int i) {
    setState(() {
      _index = i;
      _visitedIndices.add(i);
    });
  }

  Future<void> _openNewPost() async {
    setState(() => _postSheetOpen = true);
    final result = await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const NewPostSheet(),
    );
    if (!mounted) return;
    setState(() {
      _postSheetOpen = false;
      if (result == 'adopt') {
        _index = 3;
        _visitedIndices.add(3);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    // AppShell is its own pushed route — establishing a real rebuild
    // dependency here (rather than relying on the root-level
    // Consumer<LangProvider> in main.dart, which a dedicated regression
    // test confirmed does NOT reach an already-built route's content)
    // covers everything nested inside it too: the bottom nav and all four
    // tab screens (Home/Help/Adopt/Market), since none of those are
    // separately-routed — they're plain children of this same build().
    context.watch<LangProvider>();
    return DistanceProvider(
      maxDistance: _maxDistance,
      onChanged: (d) => setState(() => _maxDistance = d),
      child: Scaffold(
        extendBody: true,
        body: IndexedStack(
          index: _index,
          children: [
            HomeScreen(
              onNavigateToHelp: () => _goToIndex(1),
              onNavigateToAdopt: () => _goToIndex(3),
              onNavigateToMarket: () => _goToIndex(4),
              active: _index == 0,
            ),
            _visitedIndices.contains(1) ? HelpScreen(active: _index == 1) : const SizedBox.shrink(),
            const SizedBox.shrink(),
            _visitedIndices.contains(3) ? AdoptScreen(active: _index == 3) : const SizedBox.shrink(),
            _visitedIndices.contains(4) ? MarketScreen(active: _index == 4) : const SizedBox.shrink(),
          ],
        ),
        bottomNavigationBar: _PupzyBottomNav(
          currentIndex: _index,
          postOpen: _postSheetOpen,
          onTap: (i) {
            if (i == 2) {
              _openNewPost();
            } else {
              _goToIndex(i);
            }
          },
        ),
      ),
    );
  }
}

class _PupzyBottomNav extends StatelessWidget {
  final int currentIndex;
  final bool postOpen;
  final ValueChanged<int> onTap;

  const _PupzyBottomNav({
    required this.currentIndex,
    required this.postOpen,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 12 + bottomPadding),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
          child: Container(
            height: 64,
            decoration: BoxDecoration(
              color: AppColors.navBg.withValues(alpha: 0.68),
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: AppColors.border.withValues(alpha: 0.35)),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 20, offset: const Offset(0, 6)),
              ],
            ),
            child: Row(
              children: [
                _NavItem(icon: Icons.home_outlined, activeIcon: Icons.home, label: t(context, 'Home', 'الرئيسية'), index: 0, currentIndex: currentIndex, onTap: onTap),
                _NavItem(icon: Icons.favorite_border, activeIcon: Icons.favorite, label: t(context, 'Help', 'المساعدة'), index: 1, currentIndex: currentIndex, onTap: onTap),
                Expanded(
                  child: GestureDetector(
                    onTap: () => onTap(2),
                    child: Center(
                      child: AnimatedScale(
                        scale: postOpen ? 0.9 : 1.0,
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeOut,
                        child: Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [AppColors.primaryLight, AppColors.primary],
                            ),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white.withValues(alpha: 0.25), width: 1.5),
                            boxShadow: [
                              BoxShadow(
                                color: AppColors.primary.withValues(alpha: postOpen ? 0.2 : 0.4),
                                blurRadius: postOpen ? 8 : 14,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: AnimatedRotation(
                            turns: postOpen ? 0.125 : 0,
                            duration: const Duration(milliseconds: 250),
                            curve: Curves.easeOutBack,
                            child: const Icon(Icons.add, color: Colors.white, size: 28),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                _NavItem(icon: Icons.pets_outlined, activeIcon: Icons.pets, label: t(context, 'Adopt', 'تبني'), index: 3, currentIndex: currentIndex, onTap: onTap),
                _NavItem(icon: Icons.shopping_bag_outlined, activeIcon: Icons.shopping_bag, label: t(context, 'Market', 'المتجر'), index: 4, currentIndex: currentIndex, onTap: onTap),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final int index;
  final int currentIndex;
  final ValueChanged<int> onTap;

  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.index,
    required this.currentIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final active = currentIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => onTap(index),
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(active ? activeIcon : icon, size: 24, color: active ? AppColors.primary : AppColors.textMuted),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: active ? FontWeight.w700 : FontWeight.w400,
                color: active ? AppColors.primary : AppColors.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
