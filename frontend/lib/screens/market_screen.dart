import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/post.dart';
import '../models/product.dart';
import '../theme/app_theme.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/top_bar.dart';
import 'post_form_screen.dart';
import 'product_detail_screen.dart';

enum _SortOption { newest, priceLowToHigh, priceHighToLow }

/// A fixed-choice category: (canonical value compared against Product.category, English label, Arabic label).
typedef _CategoryChoice = (String value, String en, String ar);

class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key});

  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  String _category = 'All';
  static const List<_CategoryChoice> _categories = [
    ('All', 'All', 'الكل'),
    ('Care', 'Care', 'رعاية'),
    ('Food', 'Food', 'طعام'),
    ('Transport', 'Transport', 'نقل'),
    ('Accessories', 'Accessories', 'إكسسوارات'),
    ('Grooming', 'Grooming', 'تجميل'),
    ('Medical Supplies', 'Medical Supplies', 'مستلزمات طبية'),
    ('Other', 'Other', 'أخرى'),
  ];
  final _searchController = TextEditingController();
  String _query = '';
  _SortOption _sort = _SortOption.newest;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Product> get _filtered {
    var list = MockData.products.toList();
    if (_category != 'All') {
      list = list.where((p) => p.category == _category).toList();
    }
    if (_query.trim().isNotEmpty) {
      final q = _query.trim().toLowerCase();
      list = list.where((p) => p.title.toLowerCase().contains(q) || p.description.toLowerCase().contains(q)).toList();
    }
    switch (_sort) {
      case _SortOption.newest:
        list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        break;
      case _SortOption.priceLowToHigh:
        list.sort((a, b) => (a.price ?? 0).compareTo(b.price ?? 0));
        break;
      case _SortOption.priceHighToLow:
        list.sort((a, b) => (b.price ?? 0).compareTo(a.price ?? 0));
        break;
    }
    return list;
  }

  String _sortLabel(BuildContext context, _SortOption o) {
    switch (o) {
      case _SortOption.newest:
        return t(context, 'Newest', 'الأحدث');
      case _SortOption.priceLowToHigh:
        return t(context, 'Price: Low to High', 'السعر: من الأقل للأعلى');
      case _SortOption.priceHighToLow:
        return t(context, 'Price: High to Low', 'السعر: من الأعلى للأقل');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpacing.md),
            const PupzyTopBar(),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
                child: Row(
                  children: [
                    const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: TextField(
                        controller: _searchController,
                        onChanged: (v) => setState(() => _query = v),
                        style: Theme.of(context).textTheme.bodyMedium,
                        decoration: InputDecoration(
                          hintText: t(context, 'Search listings...', 'ابحث في الإعلانات...'),
                          hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            const DistanceFilter(),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 100),
                children: [
                  const SizedBox(height: AppSpacing.lg),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Row(
                      children: [
                        Text(t(context, 'Marketplace', 'السوق'), style: Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(width: AppSpacing.md),
                        Container(width: 4, height: 32, color: AppColors.sectionLineGreen),
                        const Spacer(),
                        PopupMenuButton<_SortOption>(
                          initialValue: _sort,
                          onSelected: (v) => setState(() => _sort = v),
                          itemBuilder: (context) => _SortOption.values
                              .map((o) => PopupMenuItem(value: o, child: Text(_sortLabel(context, o))))
                              .toList(),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.sort, size: 16, color: AppColors.textSecondary),
                              const SizedBox(width: 4),
                              Text(_sortLabel(context, _sort), style: Theme.of(context).textTheme.bodySmall),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  // Category chips
                  SizedBox(
                    height: 40,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      children: _categories.map((c) {
                        final active = _category == c.$1;
                        return Padding(
                          padding: const EdgeInsets.only(right: AppSpacing.sm),
                          child: GestureDetector(
                            onTap: () => setState(() => _category = c.$1),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                              decoration: BoxDecoration(
                                color: active ? AppColors.primary : AppColors.surface,
                                borderRadius: BorderRadius.circular(AppRadius.chip),
                                border: Border.all(color: active ? AppColors.primary : AppColors.border),
                              ),
                              child: Text(t(context, c.$2, c.$3),
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                    color: active ? Colors.white : AppColors.textPrimary,
                                  )),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  // Sell banner
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: GestureDetector(
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const PostFormScreen(type: PostType.product)),
                        );
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(AppRadius.card),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 32,
                              height: 32,
                              decoration: BoxDecoration(border: Border.all(color: AppColors.border), shape: BoxShape.circle),
                              child: const Icon(Icons.add, size: 18, color: AppColors.textSecondary),
                            ),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(t(context, 'Have something to sell?', 'لديك شيء تريد بيعه؟'), style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                                  Text(t(context, 'Buyers contact you directly — no middleman', 'يتواصل معك المشترون مباشرة — بدون وسيط'), style: Theme.of(context).textTheme.bodySmall),
                                ],
                              ),
                            ),
                            const Icon(Icons.chevron_right, color: AppColors.textMuted),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Builder(
                    builder: (context) {
                      final maxDist = DistanceProvider.of(context).maxDistance;
                      final kmLabel = t(context, 'km', 'كم');
                      final distLabel = maxDist.isFinite ? '${maxDist.toInt()}$kmLabel' : '50+$kmLabel';
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        child: RichText(
                          text: TextSpan(
                            style: Theme.of(context).textTheme.bodySmall,
                            children: [
                              TextSpan(text: t(context, 'Listings within ', 'إعلانات ضمن ')),
                              TextSpan(text: distLabel, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
                              TextSpan(text: t(context, ' of you', ' منك')),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  // Listings grid
                  Builder(builder: (context) {
                    final filtered = _filtered;
                    if (filtered.isEmpty) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xxl),
                        child: Center(
                          child: Text(t(context, 'No listings match your search', 'لا توجد إعلانات مطابقة لبحثك'), style: Theme.of(context).textTheme.bodyMedium),
                        ),
                      );
                    }
                    return GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        mainAxisSpacing: AppSpacing.md,
                        crossAxisSpacing: AppSpacing.md,
                        childAspectRatio: 0.82,
                      ),
                      itemCount: filtered.length,
                      itemBuilder: (context, i) {
                        final p = filtered[i];
                        final sold = p.status == ListingStatus.sold;
                        return GestureDetector(
                          onTap: () async {
                            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductDetailScreen(product: p)));
                            if (mounted) setState(() {});
                          },
                          child: Container(
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(AppRadius.card),
                              boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 8, offset: const Offset(0, 3))],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Stack(
                                    children: [
                                      Positioned.fill(
                                        child: ClipRRect(
                                          borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                                          child: Opacity(
                                            opacity: sold ? 0.5 : 1,
                                            child: ImageWithFallback(url: p.imageUrls.first, width: double.infinity),
                                          ),
                                        ),
                                      ),
                                      if (sold)
                                        Positioned(
                                          top: AppSpacing.sm,
                                          left: AppSpacing.sm,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration: BoxDecoration(color: AppColors.critical, borderRadius: BorderRadius.circular(AppRadius.chip)),
                                            child: Text(t(context, 'SOLD', 'مباع'), style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                                          ),
                                        )
                                      else if (p.isFree)
                                        Positioned(
                                          top: AppSpacing.sm,
                                          left: AppSpacing.sm,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration:
                                                BoxDecoration(color: AppColors.sectionLineGreen, borderRadius: BorderRadius.circular(AppRadius.chip)),
                                            child: Text(t(context, 'FREE', 'مجاني'), style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                                          ),
                                        ),
                                      Positioned(
                                        top: AppSpacing.sm,
                                        right: AppSpacing.sm,
                                        child: CustomPaint(
                                          size: const Size(22, 28),
                                          painter: _FlagPainter(color: AppColors.primary.withValues(alpha: 0.85)),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Padding(
                                  padding: const EdgeInsets.all(AppSpacing.sm),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(p.title,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
                                      Text(
                                        p.isFree ? t(context, 'Free', 'مجاني') : '${p.price?.toInt() ?? '-'} ${p.currency}',
                                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                              color: AppColors.primary,
                                              fontWeight: FontWeight.w700,
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    );
                  }),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FlagPainter extends CustomPainter {
  final Color color;
  _FlagPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width, size.height)
      ..lineTo(size.width / 2, size.height * 0.75)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
