import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class DistanceProvider extends InheritedWidget {
  final double maxDistance;
  final ValueChanged<double> onChanged;

  const DistanceProvider({
    super.key,
    required this.maxDistance,
    required this.onChanged,
    required super.child,
  });

  static DistanceProvider of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<DistanceProvider>()!;
  }

  static DistanceProvider? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<DistanceProvider>();
  }

  @override
  bool updateShouldNotify(DistanceProvider oldWidget) => maxDistance != oldWidget.maxDistance;
}

class DistanceFilter extends StatefulWidget {
  const DistanceFilter({super.key});

  @override
  State<DistanceFilter> createState() => _DistanceFilterState();
}

class _DistanceFilterState extends State<DistanceFilter> {
  static const _chips = [
    ('5km', null, 5.0),
    ('15km', null, 15.0),
    ('30km', null, 30.0),
    ('50+km', null, double.infinity),
    ('Vets', Icons.local_hospital_outlined, double.infinity),
  ];

  int _indexForDistance(double d) {
    for (int i = 0; i < _chips.length - 1; i++) {
      if (_chips[i].$3 == d) return i;
    }
    return 1;
  }

  @override
  Widget build(BuildContext context) {
    final provider = DistanceProvider.maybeOf(context);
    final selectedIndex = provider != null ? _indexForDistance(provider.maxDistance) : 1;

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: List.generate(_chips.length, (i) {
          final (label, icon, maxDist) = _chips[i];
          final active = selectedIndex == i;
          return Padding(
            padding: const EdgeInsets.only(right: AppSpacing.sm),
            child: GestureDetector(
              onTap: () => provider?.onChanged(maxDist),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: active ? AppColors.chipActive : AppColors.chipInactive,
                  borderRadius: BorderRadius.circular(AppRadius.chip),
                  border: Border.all(color: active ? AppColors.chipActive : AppColors.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 14, color: active ? Colors.white : AppColors.textSecondary),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: active ? Colors.white : AppColors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
