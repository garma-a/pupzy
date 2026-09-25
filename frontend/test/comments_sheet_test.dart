import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/models/comment.dart';
import 'package:pupzy/models/terms_info.dart';
import 'package:pupzy/services/comment_drafts.dart';
import 'package:pupzy/services/comment_image_uploader.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/comments_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

Comment comment(String id, {int boosts = 0, int minute = 0, bool pinned = false, List<String> mediaIds = const []}) =>
    Comment.fromJson({
      'id': id,
      'postId': 'post-1',
      'text': 'text of $id',
      'status': 'ACTIVE',
      'replyCount': 0,
      'boostCount': boosts,
      'isBoostedByMe': false,
      'isPinned': pinned,
      'author': {'id': 'someone', 'fullName': 'Someone'},
      'media': [
        for (final (i, m) in mediaIds.indexed)
          {'id': m, 'publicUrl': 'https://cdn.example/$m.webp', 'width': 100, 'height': 100, 'displayOrder': i},
      ],
      'createdAt': DateTime.utc(2026, 9, 26, 10, minute).toIso8601String(),
      'updatedAt': DateTime.utc(2026, 9, 26, 10, minute).toIso8601String(),
    });

/// A discussion backend: ranks pinned-first like the API, pages by offset,
/// and is idempotent per `clientRequestId`. Each create call can be scripted
/// to succeed, to succeed but lose its response, or to fail with a code.
class FakeCommentsGraphQL extends FakeSafetyGraphQL {
  List<Comment> server = [];
  final List<String> createIds = [];
  final List<List<String>?> createMediaIds = [];
  final List<String> createScript = [];
  final List<String> replyIds = [];
  final List<String> replyScript = [];
  final Map<String, Comment> _committed = {};
  int fetchCommentCalls = 0;
  int _next = 0;

  List<Comment> _ranked(String sort) {
    final pinned = server.where((c) => c.isPinned).toList();
    final rest = server.where((c) => !c.isPinned).toList()
      ..sort((a, b) {
        if (sort == 'TOP' && a.boostCount != b.boostCount) return b.boostCount.compareTo(a.boostCount);
        final t = b.createdAt.compareTo(a.createdAt);
        return t != 0 ? t : b.id.compareTo(a.id);
      });
    return [...pinned.take(1), ...rest];
  }

  @override
  Future<Map<String, dynamic>?> fetchMe() async => {'id': 'me'};
  @override
  Future<TermsInfo?> fetchTerms() async => null;

  @override
  Future<(List<Comment>, String?, bool, String?)> fetchComments({
    required String postId,
    required String sort,
    int first = 20,
    String? after,
  }) async {
    fetchCommentCalls++;
    final ranked = _ranked(sort);
    final start = after == null ? 0 : int.parse(after);
    final end = (start + first).clamp(0, ranked.length);
    return (ranked.sublist(start, end), end > 0 ? '$end' : null, end < ranked.length, null);
  }

  @override
  Future<(List<Comment>, String?, bool, String?)> fetchReplies({required String commentId, int first = 20, String? after}) async =>
      (<Comment>[], null, false, null);

  @override
  Future<(Comment?, String?)> pinComment(String commentId) async {
    server = [for (final c in server) c.copyWith(isPinned: c.id == commentId)];
    return (server.firstWhere((c) => c.id == commentId), null);
  }

  @override
  Future<(bool, String?)> unpinComment(String postId) async {
    server = [for (final c in server) c.copyWith(isPinned: false)];
    return (true, null);
  }

  @override
  Future<(int?, bool?, String?)> toggleCommentBoost(String commentId) async {
    final c = server.firstWhere((x) => x.id == commentId);
    final boosted = !c.isBoostedByMe;
    final updated = c.copyWith(isBoostedByMe: boosted, boostCount: c.boostCount + (boosted ? 1 : -1));
    server = [for (final x in server) x.id == commentId ? updated : x];
    return (updated.boostCount, boosted, null);
  }

  CommentMutationResult _run(String id, List<String> script, Comment Function() create) {
    final mode = script.isEmpty ? 'ok' : script.removeAt(0);
    if (mode.startsWith('code:')) return CommentMutationResult(errorCode: mode.substring(5), errorMessage: 'server: ${mode.substring(5)}');
    final canonical = _committed.putIfAbsent(id, create);
    return mode == 'lost' ? const CommentMutationResult() : CommentMutationResult(comment: canonical);
  }

  @override
  Future<CommentMutationResult> createComment({
    required String clientRequestId,
    required String postId,
    required String text,
    List<String>? mediaIds,
  }) async {
    createIds.add(clientRequestId);
    createMediaIds.add(mediaIds);
    return _run(clientRequestId, createScript, () {
      final created = comment('new-${_next++}', minute: 59, mediaIds: mediaIds ?? const []);
      server = [...server, created];
      return created;
    });
  }

  @override
  Future<CommentMutationResult> createReply({required String clientRequestId, required String commentId, required String text}) async {
    replyIds.add(clientRequestId);
    return _run(clientRequestId, replyScript, () => comment('reply-${_next++}', minute: 59));
  }
}

/// Uploads succeed by default; queue failure codes in [script].
class FakeUploader extends CommentImageUploader {
  final List<String> uploadedPaths = [];
  final List<String?> script = [];
  int _n = 0;

  @override
  Future<CommentImageUpload> upload(GraphQLService graphql, XFile image) async {
    uploadedPaths.add(image.path);
    final failure = script.isEmpty ? null : script.removeAt(0);
    if (failure != null) return CommentImageUpload(errorCode: failure);
    return CommentImageUpload(mediaId: 'media-${_n++}');
  }
}

class FakePicker extends ImagePickerPlatform {
  List<String> nextPaths = ['/photos/a.jpg', '/photos/b.jpg'];

  @override
  Future<List<XFile>> getMultiImageWithOptions({MultiImagePickerOptions options = const MultiImagePickerOptions()}) async =>
      nextPaths.take(options.limit ?? 99).map(XFile.new).toList();

  @override
  Future<XFile?> getImageFromSource({required ImageSource source, ImagePickerOptions options = const ImagePickerOptions()}) async =>
      nextPaths.isEmpty ? null : XFile(nextPaths.first);
}

void main() {
  late FakeCommentsGraphQL graphql;
  late FakeUploader uploader;
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeCommentsGraphQL();
    uploader = FakeUploader();
    toasts = ToastRecorder()..install();
    ImagePickerPlatform.instance = FakePicker();
  });
  tearDown(() => toasts.uninstall());

  Future<void> pumpSheet(WidgetTester tester, {bool isPostOwner = true, bool allowImages = true}) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(
      graphql: graphql,
      events: SafetyEvents(),
      child: CommentsSheet(postId: 'post-1', isPostOwner: isPostOwner, allowImages: allowImages, imageUploader: uploader),
    ));
    await tester.pumpAndSettle();
  }

  /// Lets the background re-sync (debounced after pin/unpin/Boost) finish.
  Future<void> settleResync(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
  }

  List<String> shownOrder(WidgetTester tester) => tester
      .widgetList<Text>(find.textContaining('text of '))
      .map((t) => t.data!.replaceFirst('text of ', ''))
      .toList();

  Future<void> openMenuAndChoose(WidgetTester tester, String commentId, String action) async {
    final tile = find.ancestor(of: find.text('text of $commentId'), matching: find.byType(Row)).first;
    await tester.tap(find.descendant(of: find.ancestor(of: tile, matching: find.byType(Column)).first, matching: find.byIcon(Icons.more_horiz)).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text(action).last);
    await tester.pumpAndSettle();
  }

  Future<void> typeAndSend(WidgetTester tester, String text) async {
    await tester.enterText(find.widgetWithText(TextField, 'Add a comment...'), text);
    await tester.pump();
    await tester.tap(find.byIcon(Icons.send).last);
    await tester.pumpAndSettle();
  }

  // ── Item 2: ordering ─────────────────────────────────────────────────────

  group('ordering', () {
    testWidgets('a new Comment appears beneath the pin', (tester) async {
      graphql.server = [comment('pinned', pinned: true, minute: 1), comment('older', minute: 2)];
      await pumpSheet(tester);

      await typeAndSend(tester, 'hello');

      expect(shownOrder(tester), ['pinned', 'new-0', 'older']);
    });

    testWidgets('pinning a Comment from page two moves it first, with no duplicate', (tester) async {
      graphql.server = [for (var i = 0; i < 25; i++) comment('c$i', minute: 50 - i)];
      await pumpSheet(tester);
      await tester.scrollUntilVisible(find.text('text of c22'), 300, scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();

      await openMenuAndChoose(tester, 'c22', 'Pin comment');
      await settleResync(tester);
      // The list builds lazily; go back to the top to read it from the start.
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 5000));
      await tester.pumpAndSettle();

      final order = shownOrder(tester);
      expect(order.first, 'c22');
      expect(order.where((id) => id == 'c22'), hasLength(1));
      expect(order.toSet(), hasLength(order.length), reason: 'no Comment shown twice');
    });

    testWidgets('replacing the pin returns the old one to its rank', (tester) async {
      graphql.server = [comment('a', pinned: true, minute: 1), comment('b', minute: 5), comment('c', minute: 9)];
      await pumpSheet(tester);

      await openMenuAndChoose(tester, 'b', 'Pin comment');
      await settleResync(tester);

      expect(shownOrder(tester), ['b', 'c', 'a']);
    });

    testWidgets('unpinning puts the Comment back in its natural rank', (tester) async {
      graphql.server = [comment('old', pinned: true, minute: 1), comment('mid', minute: 5), comment('new', minute: 9)];
      await pumpSheet(tester);

      await openMenuAndChoose(tester, 'old', 'Unpin comment');
      expect(shownOrder(tester), ['new', 'mid', 'old'], reason: 'reordered immediately');
      await settleResync(tester);
      expect(shownOrder(tester), ['new', 'mid', 'old']);
    });

    testWidgets('a Boost reranks Top immediately', (tester) async {
      graphql.server = [comment('first', boosts: 1, minute: 1), comment('second', minute: 9)];
      await pumpSheet(tester);
      expect(shownOrder(tester), ['first', 'second']);

      // Boost "second" twice over: 0 → 1 ties on boosts, newer wins.
      final boost = find.descendant(
        of: find.ancestor(of: find.text('text of second'), matching: find.byType(Column)).first,
        matching: find.byIcon(Icons.arrow_upward),
      );
      await tester.tap(boost.first);
      await tester.pump();
      expect(shownOrder(tester), ['second', 'first']);
      await settleResync(tester);
      expect(shownOrder(tester), ['second', 'first']);
    });
  });

  // ── Items 5 and 6: photos and retries ────────────────────────────────────

  group('publishing', () {
    testWidgets('two photos publish together with the Comment', (tester) async {
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();

      await typeAndSend(tester, 'two photos');

      expect(uploader.uploadedPaths, ['/photos/a.jpg', '/photos/b.jpg']);
      expect(graphql.createMediaIds.single, ['media-0', 'media-1']);
      expect(find.text('text of new-0'), findsOneWidget);
    });

    testWidgets('the attach button stops at two photos', (tester) async {
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();
      final attach = tester.widget<IconButton>(find.ancestor(of: find.byIcon(Icons.image_outlined), matching: find.byType(IconButton)).last);
      expect(attach.onPressed, isNull);
    });

    testWidgets('a failed photo keeps the draft and never posts text-only by itself', (tester) async {
      uploader.script.addAll([null, CommentImageUploader.uploadFailed]);
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();

      await typeAndSend(tester, 'with photos');

      expect(graphql.createIds, isEmpty, reason: 'nothing published');
      expect(find.text("Your photos couldn't be uploaded, so your comment wasn't posted."), findsOneWidget);
      expect(find.widgetWithText(TextField, 'with photos'), findsOneWidget, reason: 'draft kept');
      expect(tester.widget<IconButton>(find.ancestor(of: find.byIcon(Icons.send), matching: find.byType(IconButton)).last).onPressed,
          isNotNull, reason: 'Send is usable again');

      // Retry uploads only the photo that failed.
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(uploader.uploadedPaths, ['/photos/a.jpg', '/photos/b.jpg', '/photos/b.jpg']);
      expect(graphql.createMediaIds.single, ['media-0', 'media-1']);
    });

    testWidgets('posting without photos is an explicit choice', (tester) async {
      uploader.script.addAll([CommentImageUploader.uploadFailed]);
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();
      await typeAndSend(tester, 'maybe photos');

      await tester.tap(find.text('Post without photos'));
      await tester.pumpAndSettle();

      expect(graphql.createMediaIds.single, isEmpty);
      expect(find.text('text of new-0'), findsOneWidget);
    });

    testWidgets('a lost response retried gives one Comment, with the same id and photos', (tester) async {
      graphql.createScript.add('lost');
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();

      await typeAndSend(tester, 'did it post?');
      expect(find.text("We couldn't confirm your comment was posted. Retrying won't post it twice."), findsOneWidget);

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(graphql.createIds, hasLength(2));
      expect(graphql.createIds.toSet(), hasLength(1), reason: 'same clientRequestId');
      expect(graphql.createMediaIds.toSet().map((m) => m.toString()).toSet(), hasLength(1), reason: 'same photos');
      expect(uploader.uploadedPaths, hasLength(2), reason: 'photos are not uploaded again');
      expect(find.text('text of new-0'), findsOneWidget);
      expect(graphql.server, hasLength(1), reason: 'exactly one Comment exists');
    });

    testWidgets('an expired upload ticket re-uploads under a new id', (tester) async {
      graphql.createScript.add('code:COMMENT_MEDIA_NOT_AVAILABLE');
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();

      await typeAndSend(tester, 'late');

      expect(uploader.uploadedPaths, hasLength(4), reason: 'both photos uploaded again');
      expect(graphql.createIds.toSet(), hasLength(2), reason: 'a new submission id for the new photos');
      expect(graphql.createMediaIds.last, ['media-2', 'media-3']);
      expect(find.text('text of new-0'), findsOneWidget);
    });

    testWidgets('a retryable processing failure retries the same request', (tester) async {
      graphql.createScript.add('code:COMMENT_MEDIA_PROCESSING_FAILED');
      await pumpSheet(tester);
      await tester.tap(find.byIcon(Icons.image_outlined));
      await tester.pumpAndSettle();
      await typeAndSend(tester, 'process me');

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(graphql.createIds.toSet(), hasLength(1));
      expect(uploader.uploadedPaths, hasLength(2));
      expect(find.text('text of new-0'), findsOneWidget);
    });

    testWidgets('changing the text makes it a new submission', (tester) async {
      graphql.createScript.add('code:RATE_LIMITED');
      await pumpSheet(tester, allowImages: false);
      await typeAndSend(tester, 'first try');
      await typeAndSend(tester, 'edited');

      expect(graphql.createIds.toSet(), hasLength(2));
    });

    testWidgets('an unconfirmed Comment survives closing the sheet, keeping its id', (tester) async {
      graphql.createScript.add('lost');
      await pumpSheet(tester, allowImages: false);
      await typeAndSend(tester, 'keep me');
      final firstId = graphql.createIds.single;

      // Close and reopen the sheet.
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
      final saved = await const CommentDraftStore().loadComment('post-1');
      expect(saved?.clientRequestId, firstId);
      expect(saved?.outcomeUnknown, isTrue);

      await pumpSheet(tester, allowImages: false);
      expect(find.widgetWithText(TextField, 'keep me'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.send).last);
      await tester.pumpAndSettle();

      expect(graphql.createIds, [firstId, firstId]);
      expect(graphql.server, hasLength(1));
      expect(await const CommentDraftStore().loadComment('post-1'), isNull, reason: 'cleared once confirmed');
    });

    testWidgets('a lost Reply retried is posted once', (tester) async {
      graphql.server = [comment('parent', minute: 1)];
      graphql.replyScript.add('lost');
      await pumpSheet(tester);
      await tester.tap(find.text('Reply'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Write a reply...'), 'reply once');
      await tester.pump();

      await tester.tap(find.byIcon(Icons.send).first);
      await tester.pumpAndSettle();
      expect(toasts.messages.last, contains("couldn't confirm your reply"));
      await tester.tap(find.byIcon(Icons.send).first);
      await tester.pumpAndSettle();

      expect(graphql.replyIds, hasLength(2));
      expect(graphql.replyIds.toSet(), hasLength(1));
      expect(find.text('text of reply-0'), findsOneWidget);
    });
  });
}
