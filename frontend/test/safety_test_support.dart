import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/app_notification.dart';
import 'package:pupzy/models/blocked_user.dart';
import 'package:pupzy/models/contact_request.dart';
import 'package:pupzy/models/list_page.dart';
import 'package:pupzy/models/post_detail.dart';
import 'package:pupzy/models/safety.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/services/notification_center.dart';
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

  // ── approved-contact handoff ───────────────────────────────────────────────
  List<ContactRequest> myContactRequests = [];
  final List<String> whatsAppLinkLookups = [];
  String? whatsAppLink;
  String? whatsAppLinkError;

  /// When set, the next "load more" page (one with an `after` cursor) fails.
  bool failNextLoadMore = false;

  @override
  Future<ListPage<ContactRequest>> fetchMyContactRequests({
    String? postId,
    String? status,
    int first = 20,
    String? after,
  }) async {
    calls.add('fetchMyContactRequests');
    return pageFor(myContactRequests.where((r) => status == null || r.status == status).toList(), first, after);
  }

  /// Serves [all] in pages of [first] with offset cursors, honouring
  /// [failNextLoadMore].
  ListPage<T> pageFor<T>(List<T> all, int first, String? after) {
    if (after != null && failNextLoadMore) {
      failNextLoadMore = false;
      return const ListPage(errorMessage: 'Network down');
    }
    final start = after == null ? 0 : int.parse(after);
    final end = (start + first).clamp(0, all.length);
    return ListPage(items: all.sublist(start, end), endCursor: '$end', hasNextPage: end < all.length);
  }

  @override
  Future<(String? link, String? errorMessage)> getWhatsAppLink(String requestId) async {
    calls.add('getWhatsAppLink');
    whatsAppLinkLookups.add(requestId);
    return (whatsAppLink, whatsAppLinkError);
  }

  // ── notifications ──────────────────────────────────────────────────────────
  List<AppNotification> notifications = [];
  PostDetail? postDetailResult;
  String? postDetailError;
  final List<String> readNotificationIds = [];

  /// Serves [notifications] in pages of `first`; the cursor is the index of
  /// the next item.
  @override
  Future<NotificationPage> fetchMyNotifications({int first = 30, String? after}) async {
    calls.add('fetchMyNotifications(${after ?? ''})');
    final start = after == null ? 0 : int.parse(after);
    final end = (start + first).clamp(0, notifications.length);
    return NotificationPage(
      notifications: notifications.sublist(start, end),
      unreadCount: notifications.where((n) => !n.isRead).length,
      endCursor: end < notifications.length ? '$end' : null,
      hasNextPage: end < notifications.length,
    );
  }

  int unreadCount = 0;

  @override
  Future<(int? count, String? errorMessage)> fetchMyUnreadNotificationCount() async => (unreadCount, null);

  @override
  Future<(bool success, String? errorMessage)> markNotificationRead(String notificationId) async {
    readNotificationIds.add(notificationId);
    return (true, null);
  }

  int markAllReadCalls = 0;
  String? markAllReadError;

  @override
  Future<(int? count, String? errorMessage)> markAllNotificationsRead() async {
    calls.add('markAllNotificationsRead');
    markAllReadCalls++;
    if (markAllReadError != null) return (null, markAllReadError);
    return (notifications.where((n) => !n.isRead).length, null);
  }

  @override
  Future<(PostDetail? post, String? errorMessage)> fetchPostDetail(String id) async {
    calls.add('fetchPostDetail($id)');
    return (postDetailResult, postDetailError);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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
  NotificationCenter? notificationCenter,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<LangProvider>.value(value: lang ?? LangProvider()),
      ChangeNotifierProvider<SafetyEvents>.value(value: events),
      Provider<GraphQLService>.value(value: graphql),
      ChangeNotifierProvider<NotificationCenter>.value(value: notificationCenter ?? NotificationCenter()),
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
