import 'dart:ui';

import 'package:flutter/material.dart';

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

class _AppShellState extends State<AppShell> {
  int _index = 0;
  double _maxDistance = 15.0;
  bool _postSheetOpen = false;

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
      if (result == 'adopt') _index = 3;
    });
  }

  @override
  Widget build(BuildContext context) {
    return DistanceProvider(
      maxDistance: _maxDistance,
      onChanged: (d) => setState(() => _maxDistance = d),
      child: Scaffold(
        extendBody: true,
        body: IndexedStack(
          index: _index,
          children: [
            const HomeScreen(),
            const HelpScreen(),
            const SizedBox.shrink(),
            const AdoptScreen(),
            const MarketScreen(),
          ],
        ),
        bottomNavigationBar: _PupzyBottomNav(
          currentIndex: _index,
          postOpen: _postSheetOpen,
          onTap: (i) {
            if (i == 2) {
              _openNewPost();
            } else {
              setState(() => _index = i);
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
                _NavItem(icon: Icons.home_outlined, activeIcon: Icons.home, label: 'Home', index: 0, currentIndex: currentIndex, onTap: onTap),
                _NavItem(icon: Icons.favorite_border, activeIcon: Icons.favorite, label: 'Help', index: 1, currentIndex: currentIndex, onTap: onTap),
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
                _NavItem(icon: Icons.pets_outlined, activeIcon: Icons.pets, label: 'Adopt', index: 3, currentIndex: currentIndex, onTap: onTap),
                _NavItem(icon: Icons.shopping_bag_outlined, activeIcon: Icons.shopping_bag, label: 'Market', index: 4, currentIndex: currentIndex, onTap: onTap),
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
