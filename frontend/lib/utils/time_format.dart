import '../localization/lang_provider.dart';

String timeAgo(DateTime time, Lang lang) {
  final diff = DateTime.now().difference(time);
  final isArabic = lang == Lang.ar;
  if (diff.inMinutes < 1) return isArabic ? 'الآن' : 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}${isArabic ? 'د' : 'm'}';
  if (diff.inHours < 24) return '${diff.inHours}${isArabic ? 'س' : 'h'}';
  if (diff.inDays < 7) return '${diff.inDays}${isArabic ? 'ي' : 'd'}';
  return '${(diff.inDays / 7).floor()}${isArabic ? 'أ' : 'w'}';
}
