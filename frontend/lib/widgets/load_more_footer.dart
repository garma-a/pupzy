import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// Posts per feed page (the server's default page size).
const feedPageSize = 20;

/// Feeds load [feedPageSize] posts per page. Scrolling near the end loads
/// the next page by itself until this many posts are on screen; after that
/// the list ends with a [LoadMoreFooter] "Show more" button, and each tap
/// loads one more page. The cap keeps memory, data use and image decoding
/// bounded on long sessions, and gives the feed a natural stopping point.
const feedAutoLoadLimit = 60;

/// Whether scrolling may load the next page of a feed by itself.
bool feedCanAutoLoad(int loaded) => loaded < feedAutoLoadLimit;

/// Whether a feed should end with a [LoadMoreFooter]: while a page loads,
/// once auto-loading has stopped with more pages left (the button), or at
/// the very end of a feed longer than one page ("That's everything").
bool feedShowsFooter({required bool loadingMore, required bool hasNextPage, required int loaded}) =>
    loadingMore || (hasNextPage ? !feedCanAutoLoad(loaded) : loaded > feedPageSize);

/// The end of a paginated list: loading the next page, a failed page with
/// Retry, a "Show more" button, or — once more than one page was loaded —
/// a quiet end-of-list line.
///
/// With [autoLoad] the next page loads as soon as the footer is built (a
/// full-screen list scrolled to its end). Without it the user taps "Show
/// more" (a section inside a longer screen, where loading more should be a
/// choice).
class LoadMoreFooter extends StatelessWidget {
  final bool hasMore;
  final bool loading;
  final bool failed;
  final bool autoLoad;

  /// Whether more than the first page is on screen — the end-of-list line is
  /// only worth showing then.
  final bool pagedBeyondFirst;
  final VoidCallback onLoadMore;

  const LoadMoreFooter({
    super.key,
    required this.hasMore,
    required this.loading,
    required this.failed,
    required this.onLoadMore,
    this.autoLoad = false,
    this.pagedBeyondFirst = false,
  });

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    if (loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }
    if (failed) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Flexible(child: Text(t(context, "Couldn't load more.", 'تعذر تحميل المزيد.'), style: muted)),
            TextButton(onPressed: onLoadMore, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
          ],
        ),
      );
    }
    if (hasMore) {
      if (autoLoad) {
        WidgetsBinding.instance.addPostFrameCallback((_) => onLoadMore());
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
          child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
        );
      }
      return Center(
        child: TextButton(onPressed: onLoadMore, child: Text(t(context, 'Show more', 'عرض المزيد'))),
      );
    }
    if (!pagedBeyondFirst) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Center(child: Text(t(context, "That's everything", 'هذا كل شيء'), style: muted)),
    );
  }
}
