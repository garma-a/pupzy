import 'package:flutter/material.dart';

/// A heart/bookmark icon that bounces on toggle and updates optimistically —
/// flips instantly on tap (no waiting on the network to feel responsive),
/// calls [onToggle] in the background, and reverts itself if that call fails.
///
/// Only renders the icon + tap target + animation — wrap it in whatever
/// container/background a given card needs.
class AnimatedFavoriteIcon extends StatefulWidget {
  final bool isSaved;
  final Future<bool> Function() onToggle;
  final String semanticLabelOn;
  final String semanticLabelOff;
  final IconData filledIcon;
  final IconData outlineIcon;
  final Color activeColor;
  final Color inactiveColor;
  final double size;

  const AnimatedFavoriteIcon({
    super.key,
    required this.isSaved,
    required this.onToggle,
    required this.semanticLabelOn,
    required this.semanticLabelOff,
    required this.activeColor,
    required this.inactiveColor,
    this.filledIcon = Icons.favorite,
    this.outlineIcon = Icons.favorite_border,
    this.size = 16,
  });

  @override
  State<AnimatedFavoriteIcon> createState() => _AnimatedFavoriteIconState();
}

class _AnimatedFavoriteIconState extends State<AnimatedFavoriteIcon> with SingleTickerProviderStateMixin {
  late bool _saved = widget.isSaved;
  bool _pending = false;
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 320));
  late final Animation<double> _scale = TweenSequence<double>([
    TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.4).chain(CurveTween(curve: Curves.easeOut)), weight: 35),
    TweenSequenceItem(tween: Tween(begin: 1.4, end: 0.9).chain(CurveTween(curve: Curves.easeInOut)), weight: 25),
    TweenSequenceItem(tween: Tween(begin: 0.9, end: 1.0).chain(CurveTween(curve: Curves.easeOut)), weight: 40),
  ]).animate(_controller);

  @override
  void didUpdateWidget(covariant AnimatedFavoriteIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only follow external updates when we're not mid-toggle ourselves —
    // otherwise a slow parent rebuild could stomp the optimistic flip.
    if (!_pending && widget.isSaved != oldWidget.isSaved) {
      _saved = widget.isSaved;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleTap() async {
    if (_pending) return;
    final next = !_saved;
    setState(() {
      _saved = next;
      _pending = true;
    });
    _controller.forward(from: 0);
    final ok = await widget.onToggle();
    if (!mounted) return;
    setState(() {
      _pending = false;
      if (!ok) _saved = !next;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: _saved ? widget.semanticLabelOn : widget.semanticLabelOff,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _handleTap,
        child: ScaleTransition(
          scale: _scale,
          child: Icon(
            _saved ? widget.filledIcon : widget.outlineIcon,
            size: widget.size,
            color: _saved ? widget.activeColor : widget.inactiveColor,
          ),
        ),
      ),
    );
  }
}
