import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/distance_filter.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/top_bar.dart';
import 'product_detail_screen.dart';


class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key});

  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  String _category = 'All';
  final _categories = ['All', 'Care', 'Food'];

  List get _filtered {
    if (_category == 'All') return MockData.products;
    return MockData.products.where((p) => p.category == _category).toList();
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
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 12),
                decoration: BoxDecoration(color: AppColors.searchBg, borderRadius: BorderRadius.circular(AppRadius.chip)),
                child: Row(
                  children: [
                    const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                    const SizedBox(width: AppSpacing.sm),
                    Text('Search pets, posts, users...', style: Theme.of(context).textTheme.bodyMedium),
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
                        Text('Rescue Supply', style: Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(width: AppSpacing.md),
                        Container(width: 4, height: 32, color: AppColors.sectionLineGreen),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  // Category chips
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Row(
                      children: _categories.map((c) {
                        final active = _category == c;
                        return Padding(
                          padding: const EdgeInsets.only(right: AppSpacing.sm),
                          child: GestureDetector(
                            onTap: () => setState(() => _category = c),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                              decoration: BoxDecoration(
                                color: active ? AppColors.primary : AppColors.surface,
                                borderRadius: BorderRadius.circular(AppRadius.chip),
                                border: Border.all(color: active ? AppColors.primary : AppColors.border),
                              ),
                              child: Text(c,
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
                      onTap: () => Fluttertoast.showToast(msg: 'Seller onboarding coming soon!'),
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
                                  Text('Have something to sell?', style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                                  Text('Buyers contact you via WhatsApp', style: Theme.of(context).textTheme.bodySmall),
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
                      final distLabel = maxDist.isFinite ? '${maxDist.toInt()}km' : '50+km';
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        child: RichText(
                          text: TextSpan(
                            style: Theme.of(context).textTheme.bodySmall,
                            children: [
                              const TextSpan(text: 'Listings within '),
                              TextSpan(text: distLabel, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
                              const TextSpan(text: ' of you'),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  // Product grid
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: AppSpacing.md,
                      crossAxisSpacing: AppSpacing.md,
                      childAspectRatio: 0.82,
                    ),
                    itemCount: _filtered.length,
                    itemBuilder: (context, i) {
                      final p = _filtered[i];
                      return GestureDetector(
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductDetailScreen(product: p))),
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
                                    ClipRRect(
                                      borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.card)),
                                      child: ImageWithFallback(url: p.imageUrls.first, width: double.infinity),
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
                                    Text(p.name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
                                    Text('${p.price.toInt()} ${p.currency}',
                                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                              color: AppColors.primary,
                                              fontWeight: FontWeight.w700,
                                            )),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
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
