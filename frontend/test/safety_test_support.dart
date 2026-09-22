import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/app_notification.dart';
import 'package:pupzy/models/blocked_user.dart';
import 'package:pupzy/models/post_detail.dart';
import 'package:pupzy/models/rescue_proof.dart';
import 'package:pupzy/models/safety.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/services/safety_events.dart';

/// Captures every Fluttertoast message shown during a test (the real plugin
/// has no implementation under `flutter test`).
class ToastRecorder {
  final List<String> messages = [];

  void install() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('PonnamKarthik/fluttertoast'),
      (call) async {
        if (call.method == 'showToast') messages.add(call.arguments['msg'] as String);
        return true;
      },
    );
  }

  void uninstall() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('PonnamKarthik/fluttertoast'),
      null,
    );
  }
}

/// A [GraphQLService] stand-in for widget tests. The real one builds a
/// network client on top of `FirebaseAuth`, which can't exist here — so this
/// implements just the safety operations and lets everything else throw
/// (`noSuchMethod`) if a test ever reaches for it by accident.
class FakeSafetyGraphQL implements GraphQLService {
  final List<String> calls = [];
  SafetyResult Function(String op)? resultFor;

  Map<String, Object?> lastReportPost = {};
  Map<String, Object?> lastReportUser = {};
  Map<String, Object?> lastReportComment = {};

  List<BlockedUser> Function(String? after)? blockedPages;
  bool Function(String? after)? hasNext;

  SafetyResult _result(String op) => resultFor?.call(op) ?? SafetyResult.success;

  @override
  Future<SafetyResult> reportPost({required String postId, required String reason, String? details}) async {
    calls.add('reportPost');
    lastReportPost = {'postId': postId, 'reason': reason, 'details': details};
    return _result('reportPost');
  }

  @override
  Future<SafetyResult> reportComment({required String commentId, required String reason, String? details}) async {
    calls.add('reportComment');
    lastReportComment = {'commentId': commentId, 'reason': reason, 'details': details};
    return _result('reportComment');
  }

  @override
  Future<SafetyResult> reportUser({
    required String userId,
    required String reason,
    String? details,
    AccountReportSource? sourceType,
    String? sourceId,
  }) async {
    calls.add('reportUser');
    lastReportUser = {'userId': userId, 'reason': reason, 'details': details, 'sourceType': sourceType?.value, 'sourceId': sourceId};
    return _result('reportUser');
  }

  final List<String> blockedIds = [];
  final List<String> unblockedIds = [];

  @override
  Future<SafetyResult> blockUser(String userId) async {
    calls.add('blockUser');
    blockedIds.add(userId);
    return _result('blockUser');
  }

  @override
  Future<SafetyResult> unblockUser(String userId) async {
    calls.add('unblockUser');
    unblockedIds.add(userId);
    return _result('unblockUser');
  }

  @override
  Future<(List<BlockedUser> users, String? endCursor, bool hasNextPage, String? errorMessage)> fetchBlockedUsers({
    int first = 20,
    String? after,
  }) async {
    calls.add('fetchBlockedUsers(after: $after)');
    final users = blockedPages?.call(after) ?? <BlockedUser>[];
    return (users, users.isEmpty ? null : 'cursor-${users.last.id}', hasNext?.call(after) ?? false, null);
  }

  // ── post lifecycle ─────────────────────────────────────────────────────────
  final List<(String postId, String status)> statusCalls = [];
  final List<String> deletedPostIds = [];

  (bool, String?) _pair(String op) {
    final r = _result(op);
    return (r.ok, r.message);
  }

  @override
  Future<(bool success, String? errorMessage)> updatePostStatus({required String postId, required String status}) async {
    calls.add('updatePostStatus');
    statusCalls.add((postId, status));
    return _pair('updatePostStatus');
  }

  @override
  Future<(bool success, String? errorMessage)> deletePost(String postId) async {
    calls.add('deletePost');
    deletedPostIds.add(postId);
    return _pair('deletePost');
  }

  // ── rescue / found proof ───────────────────────────────────────────────────
  List<RescueProof> myProofs = [];
  List<RescueProof> postProofs = [];
  RescueProof? proofToReturn;
  SafetyResult? proofFailure;
  final List<Map<String, Object?>> submittedProofs = [];
  final List<String> confirmedProofIds = [];
  final List<String> rejectedProofIds = [];
  final List<String> whatsappLookups = [];
  String? whatsappLink;
  String? whatsappError;

  @override
  Future<(RescueProof? proof, String? errorCode, String? errorMessage)> submitRescueProof({
    required String postId,
    required List<String> mediaIds,
    required DateTime happenedAt,
    required String areaName,
    required String condition,
    required String whereabouts,
    required String story,
  }) async {
    calls.add('submitRescueProof');
    submittedProofs.add({
      'postId': postId,
      'mediaIds': mediaIds,
      'happenedAt': happenedAt,
      'areaName': areaName,
      'condition': condition,
      'whereabouts': whereabouts,
      'story': story,
    });
    final failure = proofFailure;
    if (failure != null) return (null, failure.code, failure.message);
    return (proofToReturn ?? proof('created'), null, null);
  }

  @override
  Future<(RescueProof? proof, String? errorCode, String? errorMessage)> confirmRescueProof(String proofId) async {
    calls.add('confirmRescueProof');
    confirmedProofIds.add(proofId);
    final failure = proofFailure;
    if (failure != null) return (null, failure.code, failure.message);
    return (postProofs.firstWhere((p) => p.id == proofId).copyWith(status: 'CONFIRMED'), null, null);
  }

  @override
  Future<(RescueProof? proof, String? errorCode, String? errorMessage)> rejectRescueProof(String proofId) async {
    calls.add('rejectRescueProof');
    rejectedProofIds.add(proofId);
    final failure = proofFailure;
    if (failure != null) return (null, failure.code, failure.message);
    return (postProofs.firstWhere((p) => p.id == proofId).copyWith(status: 'REJECTED'), null, null);
  }

  @override
  Future<(List<RescueProof> proofs, String? errorMessage)> fetchMyRescueProofs({required String postId}) async {
    calls.add('fetchMyRescueProofs');
    return (List.of(myProofs), null);
  }

  @override
  Future<(List<RescueProof> proofs, String? errorMessage)> fetchPostRescueProofs({required String postId}) async {
    calls.add('fetchPostRescueProofs');
    return (List.of(postProofs), null);
  }

  @override
  Future<(String? link, String? errorMessage)> fetchRescueProofWhatsAppLink(String proofId) async {
    whatsappLookups.add(proofId);
    return (whatsappLink, whatsappError);
  }

  // ── notifications ──────────────────────────────────────────────────────────
  List<AppNotification> notifications = [];
  PostDetail? postDetailResult;
  String? postDetailError;
  final List<String> readNotificationIds = [];

  @override
  Future<(List<AppNotification> notifications, int unreadCount, String? errorMessage)> fetchMyNotifications({int first = 30}) async {
    return (notifications, notifications.where((n) => !n.isRead).length, null);
  }

  @override
  Future<(bool success, String? errorMessage)> markNotificationRead(String notificationId) async {
    readNotificationIds.add(notificationId);
    return (true, null);
  }

  @override
  Future<(PostDetail? post, String? errorMessage)> fetchPostDetail(String id) async {
    calls.add('fetchPostDetail($id)');
    return (postDetailResult, postDetailError);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

RescueProof proof(
  String id, {
  String status = 'PENDING',
  String? name = 'Mona',
  bool deletedSubmitter = false,
  DateTime? createdAt,
  int photos = 2,
}) =>
    RescueProof(
      id: id,
      postId: 'post-1',
      status: status,
      submitter: deletedSubmitter ? null : RescueProofSubmitter(id: 'sub-$id', fullName: name, fullNameArabic: name == null ? null : 'منى'),
      media: [for (var i = 0; i < photos; i++) RescueProofMedia(id: '$id-m$i', publicUrl: 'https://img.test/$id/$i.jpg')],
      happenedAt: DateTime.utc(2026, 9, 18, 10, 30),
      areaName: 'Maadi, Road 9',
      condition: 'HEALTHY',
      whereabouts: 'WITH_ME',
      story: 'Found her under a car and took her to my place.',
      createdAt: createdAt ?? DateTime.utc(2026, 9, 18, 12),
    );

BlockedUser blockedUser(String id, {String? name, String? arabic, bool verified = false}) => BlockedUser(
      id: id,
      fullName: name,
      fullNameArabic: arabic,
      isVerified: verified,
      blockedAt: DateTime.utc(2026, 9, 18, 12),
    );

/// Wraps [child] in the same provider/localization stack the real app has.
Widget safetyTestApp({
  required FakeSafetyGraphQL graphql,
  required SafetyEvents events,
  required Widget child,
  LangProvider? lang,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<LangProvider>.value(value: lang ?? LangProvider()),
      ChangeNotifierProvider<SafetyEvents>.value(value: events),
      Provider<GraphQLService>.value(value: graphql),
    ],
    child: Consumer<LangProvider>(
      builder: (context, l, _) => MaterialApp(
        locale: l.locale,
        supportedLocales: const [Locale('en'), Locale('ar')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(body: child),
      ),
    ),
  );
}
