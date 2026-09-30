import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../config/firebase_options.dart';
import '../localization/lang_provider.dart';
import '../screens/notifications_panel.dart';
import '../utils/navigation.dart';
import '../utils/notification_routing.dart';
import 'graphql_service.dart';
import 'notification_center.dart';

/// Must be a top-level (or static) function, not a method — the platform
/// invokes it in a separate isolate for messages received while the app is
/// backgrounded or terminated. It only needs to (re-)initialize Firebase;
/// the OS displays the notification itself from the message's `notification`
/// block (see device-push-delivery-flutter-integration-contract.md §5), on
/// the [PushService.androidChannel] named in AndroidManifest.xml.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }
}

/// Registers this device for push (FCM), keeps the registration fresh on
/// token rotation, shows pushes that arrive while the app is open, routes a
/// notification tap to the right Post, and unregisters on sign-out. See
/// `docs/device-push-delivery-flutter-integration-contract.md` for the
/// backend contract this follows — one token/one owner, `data.type` +
/// `data.relatedPostId` for routing.
class PushService {
  /// High importance so notifications pop up as heads-up banners. Pushes
  /// that arrive in the background use it too, via the
  /// `default_notification_channel_id` meta-data in AndroidManifest.xml —
  /// keep the id in sync with it.
  static const androidChannel = AndroidNotificationChannel(
    'pupzy_activity',
    'Activity',
    description: 'Comments, contact requests, adoption updates and news about your posts',
    importance: Importance.high,
  );

  final _local = FlutterLocalNotificationsPlugin();
  final List<StreamSubscription<dynamic>> _subscriptions = [];
  GraphQLService? _graphql;
  NotificationCenter? _center;
  bool _initialized = false;
  bool _localReady = false;
  String? _registeredToken;

  /// Call once per authenticated session (e.g. from AppShell.initState).
  /// Requests notification permission, registers the current token, and
  /// wires tap/foreground/token-refresh handling. Push is opt-in: when the
  /// user declines, the in-app inbox and badge still work, and
  /// [ensureRegistered] picks the device up if they allow it later.
  Future<void> initialize(GraphQLService graphql, NotificationCenter center) async {
    if (_initialized) return;
    _initialized = true;
    _graphql = graphql;
    _center = center;

    await _initLocalNotifications();

    final messaging = FirebaseMessaging.instance;
    // iOS shows a banner for a push that arrives while the app is open only
    // when asked to; Android needs a local notification instead (below).
    await messaging.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);

    _subscriptions
      // Every sign-out path — Profile, Delete Account, an invalid session
      // found at launch — ends this session here, so the next account starts
      // clean and registers its own device.
      ..add(FirebaseAuth.instance.authStateChanges().listen((user) {
        if (user == null) _resetSession();
      }))
      ..add(messaging.onTokenRefresh.listen(_register))
      ..add(FirebaseMessaging.onMessage.listen(_onForegroundMessage))
      ..add(FirebaseMessaging.onMessageOpenedApp.listen((m) => _openFromData(m.data)));

    await _requestPermissionAndRegister();

    // The app was launched by tapping a push (terminated state) …
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) {
      _openFromData(initialMessage.data);
      return;
    }
    // … or by tapping a banner this app showed itself (Android only).
    if (!_localReady) return;
    final launch = await _local.getNotificationAppLaunchDetails();
    final payload = launch?.notificationResponse?.payload;
    if (launch?.didNotificationLaunchApp == true && payload != null) _openFromPayload(payload);
  }

  /// Whether the OS currently lets this app show notifications.
  Future<bool> hasPermission() async {
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    return _isAllowed(settings.authorizationStatus);
  }

  /// Asks for permission if it hasn't been decided yet and registers the
  /// device. Returns false when notifications are blocked for the app, in
  /// which case only the phone's settings can turn them back on.
  Future<bool> requestPermission() => _requestPermissionAndRegister();

  /// Call when the app returns to the foreground: registers the device if the
  /// user allowed notifications in the phone's settings meanwhile.
  Future<void> ensureRegistered() async {
    if (!_initialized || _registeredToken != null) return;
    if (await hasPermission()) await _registerCurrentToken();
  }

  /// Call before signing out (while still authenticated) so this device
  /// stops receiving push for the account that is leaving. The local
  /// session reset then follows automatically on sign-out.
  Future<void> unregisterCurrentDevice() async {
    final graphql = _graphql;
    if (graphql != null) {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await graphql.unregisterDevice(token);
    }
    await _resetSession();
  }

  /// Ends the push session on this device: stops listening, clears this
  /// account's notifications from the screen and the badge, and lets the
  /// next [initialize] start from scratch. Safe to call more than once.
  Future<void> _resetSession() async {
    final subscriptions = List.of(_subscriptions);
    _subscriptions.clear();
    for (final subscription in subscriptions) {
      await subscription.cancel();
    }
    if (_localReady) await _local.cancelAll();
    _center?.clear();
    _initialized = false;
    _registeredToken = null;
    _graphql = null;
    _center = null;
  }

  // ─── Registration ──────────────────────────────────────────────────────

  String get _platform => Platform.isIOS ? 'IOS' : 'ANDROID';

  bool _isAllowed(AuthorizationStatus status) =>
      status == AuthorizationStatus.authorized || status == AuthorizationStatus.provisional;

  Future<bool> _requestPermissionAndRegister() async {
    final settings = await FirebaseMessaging.instance.requestPermission(alert: true, badge: true, sound: true);
    if (!_isAllowed(settings.authorizationStatus)) return false;
    await _registerCurrentToken();
    return true;
  }

  Future<void> _registerCurrentToken() async {
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await _register(token);
  }

  Future<void> _register(String token) async {
    final graphql = _graphql;
    if (graphql == null) return;
    if (await graphql.registerDevice(token: token, platform: _platform)) _registeredToken = token;
  }

  // ─── Showing ───────────────────────────────────────────────────────────

  /// Android only: iOS shows foreground pushes itself, and leaving iOS to
  /// firebase_messaging alone keeps it the only notification-center delegate
  /// there, so its tap callbacks keep working.
  Future<void> _initLocalNotifications() async {
    if (_localReady || !Platform.isAndroid) return;
    await _local.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_stat_pupzy'),
      ),
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload != null) _openFromPayload(payload);
      },
    );
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(androidChannel);
    _localReady = true;
  }

  void _onForegroundMessage(RemoteMessage message) {
    final graphql = _graphql;
    if (graphql != null) _center?.pushArrived(graphql);

    // iOS already shows it (see setForegroundNotificationPresentationOptions).
    final notification = message.notification;
    if (!Platform.isAndroid || notification == null) return;
    final data = message.data;
    // Same grouping the backend uses for its collapse key: a newer alert
    // about the same thing replaces the older one instead of stacking.
    final target = data['relatedPostId'] ?? data['relatedCommentId'] ?? data['notificationId'];
    final groupKey = '${data['type']}:$target';
    _local.show(
      id: groupKey.hashCode & 0x7fffffff,
      title: notification.title,
      body: notification.body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          androidChannel.id,
          androidChannel.name,
          channelDescription: androidChannel.description,
          importance: Importance.high,
          priority: Priority.high,
          icon: 'ic_stat_pupzy',
          color: const Color(0xFFC4622D),
          styleInformation: BigTextStyleInformation(notification.body ?? ''),
        ),
      ),
      payload: jsonEncode(data),
    );
  }

  // ─── Tapping ───────────────────────────────────────────────────────────

  void _openFromPayload(String payload) {
    try {
      _openFromData(Map<String, dynamic>.from(jsonDecode(payload) as Map));
    } on FormatException {
      // Not one of ours — nothing to open.
    }
  }

  Future<void> _openFromData(Map<String, dynamic> data) async {
    final graphql = _graphql;
    final navigator = rootNavigatorKey.currentState;
    if (graphql == null || navigator == null) return;

    final notificationId = data['notificationId'] as String?;
    if (notificationId != null) {
      graphql.markNotificationRead(notificationId).then((_) => _center?.refresh(graphql));
    }

    final postId = data['relatedPostId'] as String?;
    if (postId == null) {
      // Nothing to open directly (e.g. an account-level notice) — show the
      // inbox so the tap still lands on the notification.
      showModalBottomSheet(
        context: navigator.context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => const NotificationsPanel(),
      );
      return;
    }
    await openNotificationTarget(
      navigator: navigator,
      graphql: graphql,
      type: data['type'] as String? ?? '',
      postId: postId,
      unavailableMessage: t(navigator.context, "This content isn't available.", 'هذا المحتوى غير متاح.'),
    );
  }
}
