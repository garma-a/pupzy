import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// A search-as-you-type bottom sheet for picking a city from the full
/// `cities` list — filters by English name, Arabic name, or governorate.
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
  List<Map<String, dynamic>> _filtered = [];

  @override
  void initState() {
    super.initState();
    _filtered = widget.cities;
    widget.searchController.addListener(_onSearch);
  }

  void _onSearch() {
    final query = widget.searchController.text.toLowerCase().trim();
    setState(() {
      if (query.isEmpty) {
        _filtered = widget.cities;
      } else {
        _filtered = widget.cities.where((city) {
          final en = (city['nameEnglish'] as String).toLowerCase();
          final ar = city['nameArabic'] as String;
          final gov = (city['governorate'] as String).toLowerCase();
          return en.contains(query) || ar.contains(query) || gov.contains(query);
        }).toList();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;
    final lang = context.watch<LangProvider>().lang;

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
                hintText: t(context, 'Search by city, governorate...', 'ابحث بالمدينة أو المحافظة...'),
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
            child: ListView(
              padding: EdgeInsets.only(bottom: bottomPad + AppSpacing.lg),
              children: [
                if (widget.onUseCurrentLocation != null)
                  ListTile(
                    leading: const Icon(Icons.my_location, color: AppColors.primary, size: 20),
                    title: Text(
                      t(context, 'Use my current location', 'استخدم موقعي الحالي'),
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    dense: true,
                    onTap: widget.onUseCurrentLocation,
                  ),
                if (widget.onUseCurrentLocation != null && _filtered.isNotEmpty) const Divider(height: 1, color: AppColors.border),
                if (_filtered.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                    child: Center(
                      child: Text(
                        t(context, 'No cities found', 'لا توجد مدن'),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  )
                else
                  ..._filtered.map((city) => ListTile(
                        leading: const Icon(Icons.location_on_outlined, color: AppColors.primary, size: 20),
                        title: Text(
                          lang == Lang.ar ? city['nameArabic'] as String : city['nameEnglish'] as String,
                          style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                        ),
                        subtitle: Text(
                          city['governorate'] as String,
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                        ),
                        dense: true,
                        onTap: () => widget.onSelected(city),
                      )),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
