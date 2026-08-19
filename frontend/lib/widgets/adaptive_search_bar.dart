import 'dart:async';

import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// A live-narrowing search field: debounces keystrokes before reporting them
/// to [onChanged] (so a fast typist doesn't trigger a rebuild per key), and
/// shows a clear button once there's text. Owns its own [TextEditingController]
/// — the parent only ever sees the settled query string.
class AdaptiveSearchBar extends StatefulWidget {
  final String hintText;
  final ValueChanged<String> onChanged;
  final Duration debounce;

  const AdaptiveSearchBar({
    super.key,
    required this.hintText,
    required this.onChanged,
    this.debounce = const Duration(milliseconds: 300),
  });

  @override
  State<AdaptiveSearchBar> createState() => _AdaptiveSearchBarState();
}

class _AdaptiveSearchBarState extends State<AdaptiveSearchBar> {
  final _controller = TextEditingController();
  Timer? _debounceTimer;
  bool _hasText = false;

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _handleChanged(String value) {
    setState(() => _hasText = value.isNotEmpty);
    _debounceTimer?.cancel();
    _debounceTimer = Timer(widget.debounce, () => widget.onChanged(value));
  }

  void _clear() {
    _debounceTimer?.cancel();
    _controller.clear();
    setState(() => _hasText = false);
    widget.onChanged('');
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
      child: Row(
        children: [
          const Icon(Icons.search, size: 18, color: AppColors.textMuted),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: TextField(
              controller: _controller,
              onChanged: _handleChanged,
              style: Theme.of(context).textTheme.bodyMedium,
              decoration: InputDecoration(
                hintText: widget.hintText,
                hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          if (_hasText)
            Semantics(
              button: true,
              label: t(context, 'Clear search', 'مسح البحث'),
              child: GestureDetector(
                onTap: _clear,
                child: const Padding(
                  padding: EdgeInsets.only(left: AppSpacing.xs),
                  child: Icon(Icons.close, size: 18, color: AppColors.textMuted),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
