import 'package:flutter/widgets.dart';

import '../localization/lang_provider.dart';

/// How a Marketplace listing's price reads everywhere it is shown: "Free" for
/// a giveaway, otherwise the whole amount and currency, e.g. "350 EGP".
String priceLabel(BuildContext context, {required bool isFree, double? amount, String? currency}) =>
    isFree ? t(context, 'Free', 'مجاني') : '${amount?.toStringAsFixed(0) ?? '-'} ${currency ?? 'EGP'}';
