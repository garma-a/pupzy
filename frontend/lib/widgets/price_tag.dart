import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import '../utils/price_label.dart';

/// A Marketplace price, the first thing a shopper scans for: the amount large
/// and bold with even-width digits ("1,250"), the currency smaller and
/// lighter beside it, and a giveaway as a green "Free" pill.
///
/// [large] is the size for the listing page; the default suits a feed card.
class PriceTag extends StatelessWidget {
  const PriceTag({super.key, required this.isFree, this.amount, this.currency, this.large = false});

  final bool isFree;
  final double? amount;
  final String? currency;
  final bool large;

  static const _freeColor = AppColors.sectionLineGreen;

  @override
  Widget build(BuildContext context) {
    // Rebuild on a language switch even when built as a const widget.
    context.watch<LangProvider>();
    final textTheme = Theme.of(context).textTheme;
    final label = priceLabel(context, isFree: isFree, amount: amount, currency: currency);

    if (isFree) {
      return Semantics(
        label: label,
        excludeSemantics: true,
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: large ? 12 : 8, vertical: large ? 5 : 3),
          decoration: BoxDecoration(color: _freeColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppRadius.chip)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.volunteer_activism_outlined, size: large ? 18 : 13, color: _freeColor),
              SizedBox(width: large ? 6 : 4),
              Text(
                t(context, 'Free', 'مجاني'),
                style: textTheme.bodyMedium?.copyWith(
                  color: _freeColor,
                  fontWeight: FontWeight.w800,
                  fontSize: large ? 17 : 13,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final amountSize = large ? 28.0 : 17.0;
    final base = textTheme.bodyLarge?.copyWith(
      color: AppColors.textPrimary,
      height: 1.15,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: amount == null ? '-' : formatPriceAmount(amount!),
            style: base?.copyWith(fontSize: amountSize, fontWeight: FontWeight.w800, letterSpacing: -0.3),
          ),
          TextSpan(
            text: ' ${currencyLabel(context, currency)}',
            style: base?.copyWith(fontSize: amountSize * 0.6, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
          ),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      semanticsLabel: label,
    );
  }
}
