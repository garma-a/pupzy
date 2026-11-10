import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import '../utils/city_search.dart';

/// A search-as-you-type bottom sheet for picking a city from the full
/// `cities` list. Search tolerates spelling differences and matches names,
/// alternative spellings, the governorate and a Neighbourhood's district
/// (see [CitySearchIndex]).
///
/// Shared between the profile's "home city" picker and the feed screens'
/// "browse a different area" location picker.
class CityPickerSheet extends StatefulWidget {
  final List<Map<String, dynamic>> cities;
  final TextEditingController searchController;
  final ValueChanged<Map<String, dynamic>> onSelected;
  final String? title;
  final VoidCallback? onUseCurrentLocation;

  const CityPickerSheet({
    super.key,
    required this.cities,
    required this.searchController,
    required this.onSelected,
    this.title,
    this.onUseCurrentLocation,
  });

  @override
  State<CityPickerSheet> createState() => _CityPickerSheetState();
}

class _CityPickerSheetState extends State<CityPickerSheet> {
  /// How long typing must pause before the list is filtered again.
  static const searchDelay = Duration(milliseconds: 150);

  Timer? _searchTimer;
  String _query = '';

  // The last search, kept so rebuilds that change nothing don't search again.
  String? _resultsQuery;
  bool? _resultsArabic;
  List<Map<String, dynamic>> _results = const [];

  @override
  void initState() {
    super.initState();
    _query = widget.searchController.text;
    widget.searchController.addListener(_onSearchChanged);
  }

  @override
  void didUpdateWidget(covariant CityPickerSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.searchController != widget.searchController) {
      oldWidget.searchController.removeListener(_onSearchChanged);
      widget.searchController.addListener(_onSearchChanged);
      _query = widget.searchController.text;
    }
    if (oldWidget.cities != widget.cities) _resultsQuery = null;
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    widget.searchController.removeListener(_onSearchChanged);
    super.dispose();
  }

  void _onSearchChanged() {
    _searchTimer?.cancel();
    _searchTimer = Timer(searchDelay, () {
      if (!mounted) return;
      final query = widget.searchController.text;
      if (query != _query) setState(() => _query = query);
    });
  }

  List<Map<String, dynamic>> _resultsFor(bool arabic) {
    if (_resultsQuery != _query || _resultsArabic != arabic) {
      _results = CitySearchIndex.of(widget.cities).search(_query, arabic: arabic);
      _resultsQuery = _query;
      _resultsArabic = arabic;
    }
    return _results;
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;
    final arabic = context.watch<LangProvider>().lang == Lang.ar;
    final results = _resultsFor(arabic);
    final hasHeader = widget.onUseCurrentLocation != null;
    final headerCount = hasHeader ? 1 : 0;

    return Container(
      height: MediaQuery.of(context).size.height * 0.7,
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: AppSpacing.lg),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(widget.title ?? t(context, 'Select a city', 'اختر مدينة'), style: Theme.of(context).textTheme.headlineSmall),
          ),
          const SizedBox(height: AppSpacing.md),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: TextField(
              controller: widget.searchController,
              autofocus: true,
              decoration: InputDecoration(
                hintText: t(context, 'Search by area, city or governorate...', 'ابحث بالحي أو المدينة أو المحافظة...'),
                hintStyle: TextStyle(color: AppColors.textMuted, fontSize: 14),
                prefixIcon: const Icon(Icons.search, color: AppColors.textMuted, size: 20),
                filled: true,
                fillColor: AppColors.surface,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.primary, width: 1.5),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Expanded(
            // Built lazily: only the rows on screen exist, however long the list.
            child: ListView.builder(
              padding: EdgeInsets.only(bottom: bottomPad + AppSpacing.lg),
              itemCount: headerCount + (results.isEmpty ? 1 : results.length),
              itemBuilder: (context, index) {
                if (hasHeader && index == 0) {
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ListTile(
                        leading: const Icon(Icons.my_location, color: AppColors.primary, size: 20),
                        title: Text(
                          t(context, 'Use my current location', 'استخدم موقعي الحالي'),
                          style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                        dense: true,
                        onTap: widget.onUseCurrentLocation,
                      ),
                      if (results.isNotEmpty) const Divider(height: 1, color: AppColors.border),
                    ],
                  );
                }
                if (results.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                    child: Center(
                      child: Text(
                        t(context, 'No cities found', 'لا توجد مدن'),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  );
                }
                final city = results[index - headerCount];
                return ListTile(
                  leading: const Icon(Icons.location_on_outlined, color: AppColors.primary, size: 20),
                  title: Text(
                    (arabic ? city['nameArabic'] : city['nameEnglish']) as String,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                  ),
                  subtitle: Text(
                    citySubtitle(city, arabic: arabic),
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                  ),
                  dense: true,
                  onTap: () => widget.onSelected(city),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
