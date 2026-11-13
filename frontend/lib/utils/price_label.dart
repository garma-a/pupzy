import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';

import '../localization/lang_provider.dart';

final _amountFormat = NumberFormat.decimalPattern('en');

/// A whole price with thousands separators: 1250 → "1,250". Western digits
/// in both languages, as Egyptian shops write prices.
String formatPriceAmount(double amount) => _amountFormat.format(amount.round());

/// The currency as shoppers read it: "EGP" in English, "ج.م" in Arabic.
/// Other ISO codes are shown as they are.
String currencyLabel(BuildContext context, String? currency) {
  final code = currency ?? 'EGP';
  return code == 'EGP' ? t(context, 'EGP', 'ج.م') : code;
}

/// How a Marketplace listing's price reads as plain text (sharing, screen
/// readers): "Free" for a giveaway, otherwise the amount and currency, e.g.
/// "1,250 EGP" or "1,250 ج.م". On screen, use `PriceTag`.
String priceLabel(BuildContext context, {required bool isFree, double? amount, String? currency}) =>
    isFree ? t(context, 'Free', 'مجاني') : '${amount == null ? '-' : formatPriceAmount(amount)} ${currencyLabel(context, currency)}';
