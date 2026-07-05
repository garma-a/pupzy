import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';

import '../models/product.dart';
import '../theme/app_theme.dart';
import '../widgets/pet_carousel.dart';

class ProductDetailScreen extends StatefulWidget {
  final Product product;

  const ProductDetailScreen({super.key, required this.product});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  int _quantity = 1;

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Stack(
                  children: [
                    PetCarousel(imageUrls: product.imageUrls, height: 300),
                    SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.sm),
                        child: CircleAvatar(
                          backgroundColor: Colors.black45,
                          child: IconButton(
                            icon: const Icon(Icons.arrow_back, color: Colors.white),
                            onPressed: () => Navigator.of(context).pop(),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(product.category.toUpperCase(),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.primary, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text(product.name, style: Theme.of(context).textTheme.headlineLarge),
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          Text('\$${product.price.toStringAsFixed(2)}',
                              style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: AppColors.primary)),
                          const SizedBox(width: AppSpacing.md),
                          const Icon(Icons.star, size: 18, color: Colors.amber),
                          const SizedBox(width: 2),
                          Text('${product.rating} (${product.reviewCount})',
                              style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text('Description', style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(product.description, style: Theme.of(context).textTheme.bodyMedium),
                      const SizedBox(height: AppSpacing.lg),
                      Text('Quantity', style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          _QtyButton(
                            icon: Icons.remove,
                            onTap: () => setState(() => _quantity = (_quantity - 1).clamp(1, 99)),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                            child: Text('$_quantity', style: Theme.of(context).textTheme.headlineSmall),
                          ),
                          _QtyButton(
                            icon: Icons.add,
                            onTap: () => setState(() => _quantity = (_quantity + 1).clamp(1, 99)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 96),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => Fluttertoast.showToast(msg: 'Added $_quantity × ${product.name} to cart'),
              child: const Text('Add to Cart'),
            ),
          ),
        ),
      ),
    );
  }
}

class _QtyButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _QtyButton({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.chip),
      child: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(AppRadius.chip),
        ),
        child: Icon(icon, size: 18),
      ),
    );
  }
}
