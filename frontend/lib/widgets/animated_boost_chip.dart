import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A boost chip that bounces on tap and updates its count/color optimistically —
/// flips instantly (no waiting on the network to feel responsive), calls
/// [onToggle] in the background, and reverts itself if that call fails.
class AnimatedBoostChip extends StatefulWidget {
  final int count;
  final bool boosted;
  final Future<bool> Function() onToggle;
  final String boostedLabel;
  final String unboostedLabel;
  final Color activeColor;
  final Color inactiveColor;
  final EdgeInsetsGeometry padding;
  final double iconSize;
  final double fontSize;

  const AnimatedBoostChip({
    super.key,
    required this.count,
    required this.boosted,
    required this.onToggle,
    required this.boostedLabel,
    required this.unboostedLabel,
    required this.activeColor,
    required this.inactiveColor,
    this.padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
    this.iconSize = 15,
    this.fontSize = 13,
  });

  @override
  State<AnimatedBoostChip> createState() => _AnimatedBoostChipState();
}

class _AnimatedBoostChipState extends State<AnimatedBoostChip> with SingleTickerProviderStateMixin {
  late bool _boosted = widget.boosted;
  late int _count = widget.count;
  bool _pending = false;
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 320));
  late final Animation<double> _scale = TweenSequence<double>([
    TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.25).chain(CurveTween(curve: Curves.easeOut)), weight: 35),
    TweenSequenceItem(tween: Tween(begin: 1.25, end: 0.92).chain(CurveTween(curve: Curves.easeInOut)), weight: 25),
    TweenSequenceItem(tween: Tween(begin: 0.92, end: 1.0).chain(CurveTween(curve: Curves.easeOut)), weight: 40),
  ]).animate(_controller);

  @override
  void didUpdateWidget(covariant AnimatedBoostChip oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only follow external updates when we're not mid-toggle ourselves —
    // otherwise a slow parent rebuild could stomp the optimistic flip.
    if (!_pending && (widget.boosted != oldWidget.boosted || widget.count != oldWidget.count)) {
      _boosted = widget.boosted;
      _count = widget.count;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleTap() async {
    if (_pending) return;
    final nextBoosted = !_boosted;
    final prevCount = _count;
    setState(() {
      _boosted = nextBoosted;
      _count = prevCount + (nextBoosted ? 1 : -1);
      _pending = true;
    });
    _controller.forward(from: 0);
    final ok = await widget.onToggle();
    if (!mounted) return;
    setState(() {
      _pending = false;
      if (!ok) {
        _boosted = !nextBoosted;
        _count = prevCount;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final color = _boosted ? widget.activeColor : widget.inactiveColor;
    return Semantics(
      button: true,
      label: _boosted ? widget.boostedLabel : widget.unboostedLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _handleTap,
        child: ScaleTransition(
          scale: _scale,
          child: Container(
            padding: widget.padding,
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(AppRadius.chip),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.arrow_upward, size: widget.iconSize, color: color),
                const SizedBox(width: 5),
                Text(
                  '$_count  ${_boosted ? widget.boostedLabel : widget.unboostedLabel}',
                  style: TextStyle(fontSize: widget.fontSize, color: color, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
