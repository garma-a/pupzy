import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/models/comment.dart';
import 'package:pupzy/utils/comment_ordering.dart';

Comment c(String id, {int boosts = 0, int minute = 0, bool pinned = false}) => Comment.fromJson({
      'id': id,
      'postId': 'p',
      'text': id,
      'status': 'ACTIVE',
      'replyCount': 0,
      'boostCount': boosts,
      'isBoostedByMe': false,
      'isPinned': pinned,
      'media': <Object>[],
      'createdAt': DateTime.utc(2026, 9, 26, 10, minute).toIso8601String(),
      'updatedAt': DateTime.utc(2026, 9, 26, 10, minute).toIso8601String(),
    });

List<String> ids(List<Comment> list) => list.map((x) => x.id).toList();

void main() {
  group('rankComments', () {
    test('TOP: pin first, then boosts, then newest', () {
      final ranked = rankComments([c('old', minute: 1), c('pin', pinned: true), c('hot', boosts: 3), c('new', minute: 9)], 'TOP');
      expect(ids(ranked), ['pin', 'hot', 'new', 'old']);
    });

    test('NEWEST ignores boosts but keeps the pin first', () {
      final ranked = rankComments([c('old', minute: 1, boosts: 9), c('new', minute: 9), c('pin', pinned: true)], 'NEWEST');
      expect(ids(ranked), ['pin', 'new', 'old']);
    });

    test('drops duplicate ids and keeps only one pin', () {
      final ranked = rankComments([c('a', pinned: true), c('b', pinned: true, minute: 5), c('a')], 'NEWEST');
      expect(ids(ranked), ['a', 'b']);
      expect(ranked.where((x) => x.isPinned), hasLength(1));
    });
  });

  test('a new Comment goes beneath the pin, never above it', () {
    final list = [c('pin', pinned: true), c('x')];
    expect(ids(insertNewComment(list, c('mine', minute: 30))), ['pin', 'mine', 'x']);
    expect(ids(insertNewComment([c('x')], c('mine', minute: 30))), ['mine', 'x']);
  });

  test('pinning moves the Comment first and returns the old pin to its rank', () {
    final list = [c('oldPin', pinned: true, minute: 1), c('a', boosts: 2), c('b', minute: 5)];
    final after = applyPin(list, c('b', minute: 5, pinned: true), 'TOP');
    expect(ids(after), ['b', 'a', 'oldPin']);
    expect(after.first.isPinned, isTrue);
    expect(after.where((x) => x.isPinned), hasLength(1));
  });

  test('unpinning puts the Comment back in its natural rank', () {
    final list = [c('pin', pinned: true, minute: 1), c('a', boosts: 2), c('b', minute: 5)];
    final after = applyUpdate(list, c('pin', minute: 1), 'TOP');
    expect(ids(after), ['a', 'b', 'pin']);
  });

  test('a Boost reranks under TOP without moving the pin', () {
    final list = [c('pin', pinned: true), c('a', boosts: 1, minute: 5), c('b', minute: 9)];
    final after = applyUpdate(list, c('b', boosts: 2, minute: 9), 'TOP');
    expect(ids(after), ['pin', 'b', 'a']);
  });

  test('appending a page skips Comments already on screen', () {
    expect(ids(appendPage([c('a'), c('b')], [c('b'), c('c')])), ['a', 'b', 'c']);
  });
}
