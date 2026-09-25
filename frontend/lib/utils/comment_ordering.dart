import '../models/comment.dart';

/// Client-side discussion ordering, mirroring the backend's pinned-first
/// Top/Newest ranking (comments-flutter-integration-contract.md §5.3–5.4):
///
/// - the pinned Comment is always first;
/// - `TOP` ranks the rest by `boostCount DESC, createdAt DESC, id DESC`;
/// - `NEWEST` ranks them by `createdAt DESC, id DESC`.
///
/// Sorting only reorders what is already loaded. A Comment whose new rank
/// falls past the loaded pages can't be placed correctly this way, so the
/// sheet also re-fetches the loaded range after a ranking change.
int compareComments(Comment a, Comment b, String sort) {
  if (sort == 'TOP') {
    final byBoost = b.boostCount.compareTo(a.boostCount);
    if (byBoost != 0) return byBoost;
  }
  final byTime = b.createdAt.compareTo(a.createdAt);
  if (byTime != 0) return byTime;
  return b.id.compareTo(a.id);
}

/// Pinned first, then the rest in [sort] order, with no duplicate ids. When
/// more than one Comment claims to be pinned, the first one wins and the
/// others are ranked as regular Comments.
List<Comment> rankComments(Iterable<Comment> comments, String sort) {
  final seen = <String>{};
  Comment? pinned;
  final regular = <Comment>[];
  for (final c in comments) {
    if (!seen.add(c.id)) continue;
    if (c.isPinned && pinned == null) {
      pinned = c;
    } else {
      regular.add(c.isPinned ? c.copyWith(isPinned: false) : c);
    }
  }
  regular.sort((a, b) => compareComments(a, b, sort));
  return [?pinned, ...regular];
}

/// A newly published Comment goes directly beneath the pin (or first when
/// there is none) — it never displaces the pinned Comment.
List<Comment> insertNewComment(List<Comment> comments, Comment created) {
  final rest = comments.where((c) => c.id != created.id).toList();
  final pinIndex = rest.indexWhere((c) => c.isPinned);
  final at = pinIndex == 0 ? 1 : 0;
  return [...rest.take(at), created, ...rest.skip(at)];
}

/// Appends a fetched page, skipping any id already on screen (ranks can
/// shift across a cursor boundary between two page loads).
List<Comment> appendPage(List<Comment> existing, List<Comment> incoming) {
  final ids = existing.map((c) => c.id).toSet();
  return [...existing, ...incoming.where((c) => ids.add(c.id))];
}

/// After pinning [pinned]: it moves to the top and any previous pin rejoins
/// the regular ranking.
List<Comment> applyPin(List<Comment> comments, Comment pinned, String sort) => rankComments(
      [pinned, ...comments.where((c) => c.id != pinned.id).map((c) => c.isPinned ? c.copyWith(isPinned: false) : c)],
      sort,
    );

/// Replaces [updated] in place and re-ranks (unpin, Boost).
List<Comment> applyUpdate(List<Comment> comments, Comment updated, String sort) =>
    rankComments(comments.map((c) => c.id == updated.id ? updated : c), sort);
