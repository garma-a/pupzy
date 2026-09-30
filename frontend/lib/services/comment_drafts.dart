import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../utils/client_request_id.dart';

/// One Comment submission: its identity and everything needed to repeat it
/// exactly.
///
/// The `clientRequestId` stays the same for as long as the text and photos
/// are unchanged, so retrying after a lost response returns the canonical
/// Comment instead of creating a duplicate (and a duplicate notification).
/// Photos that already uploaded keep their `mediaId`, so a retry doesn't
/// upload them again. Changing the text or photos is a different submission
/// and gets a new id.
class PendingComment {
  final String clientRequestId;
  final String text;

  /// Chosen photos, in order.
  final List<String> imagePaths;

  /// Upload ticket per photo, same order as [imagePaths]; null until that
  /// photo has uploaded.
  final List<String?> mediaIds;

  /// The last attempt got no answer, so it may already be published.
  final bool outcomeUnknown;

  const PendingComment({
    required this.clientRequestId,
    required this.text,
    required this.imagePaths,
    required this.mediaIds,
    this.outcomeUnknown = false,
  });

  factory PendingComment.start({required String text, required List<String> imagePaths}) => PendingComment(
        clientRequestId: generateClientRequestId(),
        text: text,
        imagePaths: List.unmodifiable(imagePaths),
        mediaIds: List.filled(imagePaths.length, null),
      );

  /// Whether [text] and [imagePaths] are this same submission.
  bool matches(String text, List<String> imagePaths) =>
      text == this.text && imagePaths.length == this.imagePaths.length && _sameOrder(imagePaths, this.imagePaths);

  bool get allUploaded => mediaIds.every((id) => id != null);

  PendingComment withMediaId(int index, String mediaId) =>
      _copy(mediaIds: [for (var i = 0; i < mediaIds.length; i++) i == index ? mediaId : mediaIds[i]]);

  PendingComment withOutcomeUnknown(bool value) => _copy(outcomeUnknown: value);

  /// The upload tickets expired or were consumed and nothing was published:
  /// upload every photo again. The payload changes, so the id does too.
  PendingComment withFreshUploads() => PendingComment(
        clientRequestId: generateClientRequestId(),
        text: text,
        imagePaths: imagePaths,
        mediaIds: List.filled(imagePaths.length, null),
      );

  /// The server saw this id with different content (`CONFLICT`); start over
  /// as a new submission, keeping any uploaded photos.
  PendingComment withNewId() => PendingComment(
        clientRequestId: generateClientRequestId(),
        text: text,
        imagePaths: imagePaths,
        mediaIds: mediaIds,
      );

  PendingComment _copy({List<String?>? mediaIds, bool? outcomeUnknown}) => PendingComment(
        clientRequestId: clientRequestId,
        text: text,
        imagePaths: imagePaths,
        mediaIds: mediaIds ?? this.mediaIds,
        outcomeUnknown: outcomeUnknown ?? this.outcomeUnknown,
      );

  Map<String, dynamic> toJson() => {
        'clientRequestId': clientRequestId,
        'text': text,
        'imagePaths': imagePaths,
        'mediaIds': mediaIds,
        'outcomeUnknown': outcomeUnknown,
      };

  static PendingComment? fromJson(Object? json) {
    if (json is! Map) return null;
    final paths = (json['imagePaths'] as List?)?.cast<String>() ?? const [];
    final ids = (json['mediaIds'] as List?)?.cast<String?>() ?? const [];
    final id = json['clientRequestId'];
    final text = json['text'];
    if (id is! String || text is! String || ids.length != paths.length) return null;
    return PendingComment(
      clientRequestId: id,
      text: text,
      imagePaths: paths,
      mediaIds: ids,
      outcomeUnknown: json['outcomeUnknown'] == true,
    );
  }
}

/// A Reply submission — like [PendingComment], without photos.
class PendingReply {
  final String clientRequestId;
  final String text;
  final bool outcomeUnknown;

  const PendingReply({required this.clientRequestId, required this.text, this.outcomeUnknown = false});

  factory PendingReply.start(String text) => PendingReply(clientRequestId: generateClientRequestId(), text: text);

  PendingReply withOutcomeUnknown(bool value) =>
      PendingReply(clientRequestId: clientRequestId, text: text, outcomeUnknown: value);

  PendingReply withNewId() => PendingReply.start(text);

  Map<String, dynamic> toJson() => {'clientRequestId': clientRequestId, 'text': text, 'outcomeUnknown': outcomeUnknown};

  static PendingReply? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['clientRequestId'];
    final text = json['text'];
    if (id is! String || text is! String) return null;
    return PendingReply(clientRequestId: id, text: text, outcomeUnknown: json['outcomeUnknown'] == true);
  }
}

/// Keeps unsent Comments and Replies on the device, so closing the sheet or
/// the app — or losing the connection mid-send — doesn't lose them or their
/// submission identity. One draft per Post (Comments) and per Comment
/// (Replies). Storage failures are ignored: a draft is a convenience, and the
/// send itself never depends on it.
class CommentDraftStore {
  const CommentDraftStore();

  static String _commentKey(String postId) => 'comment_draft:$postId';
  static String _replyKey(String commentId) => 'reply_draft:$commentId';

  Future<PendingComment?> loadComment(String postId) async =>
      PendingComment.fromJson(await _read(_commentKey(postId)));

  Future<void> saveComment(String postId, PendingComment draft) => _write(_commentKey(postId), draft.toJson());

  Future<void> clearComment(String postId) => _remove(_commentKey(postId));

  Future<PendingReply?> loadReply(String commentId) async => PendingReply.fromJson(await _read(_replyKey(commentId)));

  Future<void> saveReply(String commentId, PendingReply draft) => _write(_replyKey(commentId), draft.toJson());

  Future<void> clearReply(String commentId) => _remove(_replyKey(commentId));

  Future<Object?> _read(String key) async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(key);
      return raw == null ? null : jsonDecode(raw);
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String key, Map<String, dynamic> value) async {
    try {
      await (await SharedPreferences.getInstance()).setString(key, jsonEncode(value));
    } catch (_) {}
  }

  Future<void> _remove(String key) async {
    try {
      await (await SharedPreferences.getInstance()).remove(key);
    } catch (_) {}
  }
}

bool _sameOrder(List<String> a, List<String> b) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
