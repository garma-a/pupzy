import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../config/firebase_options.dart';
import '../screens/adoption_detail_screen.dart';
import '../screens/mating_detail_screen.dart';
import '../screens/product_detail_screen.dart';
import '../screens/rescue_detail_screen.dart';
import '../utils/navigation.dart';
import 'graphql_service.dart';

/// Must be a top-level (or static) function, not a method — the platform
/// invokes it in a separate isolate for messages received while the app is
/// backgrounded or terminated. It only needs to (re-)initialize Firebase;
/// the OS displays the notification itself from the message's `notification`
/// block (see device-push-delivery-flutter-integration-contract.md §5) —
/// this app has no local-notifications plugin to do custom rendering.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }
}

/// Registers this device for push (FCM), keeps the registration fresh on
/// token rotation, routes a notification tap to the right Post's detail
/// screen, and unregisters on sign-out. See
/// `docs/device-push-delivery-flutter-integration-contract.md` for the
/// backend contract this follows — one token/one owner, `data.type` +
/// `data.relatedPostId` for routing.
class PushService {
  GraphQLService? _graphql;
  bool _initialized = false;

  /// Call once per authenticated session (e.g. from AppShell.initState).
  /// Requests notification permission, registers the current token, and
  /// wires tap/foreground/token-refresh handling. Silently does nothing if
  /// the user declines permission — push is opt-in, not required.
  Future<void> initialize(GraphQLService graphql) async {
    if (_initialized) return;
    _initialized = true;
    _graphql = graphql;

    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;

    final token = await messaging.getToken();
    if (token != null) await graphql.registerDevice(token: token, platform: _platform);

    messaging.onTokenRefresh.listen((newToken) {
      _graphql?.registerDevice(token: newToken, platform: _platform);
    });

    // Foreground messages aren't auto-displayed by the OS. Without a
    // local-notifications plugin this app can only surface a lightweight
    // in-app toast rather than a real heads-up banner.
    FirebaseMessaging.onMessage.listen((message) {
      final title = message.notification?.title;
      if (title != null) Fluttertoast.showToast(msg: title);
    });

    FirebaseMessaging.onMessageOpenedApp.listen(_routeToNotification);
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) _routeToNotification(initialMessage);
  }

  String get _platform => Platform.isIOS ? 'IOS' : 'ANDROID';

  /// Call on sign-out so this device stops receiving push for the account
  /// that just signed out.
  Future<void> unregisterCurrentDevice() async {
    final graphql = _graphql;
    if (graphql == null) return;
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await graphql.unregisterDevice(token);
    _initialized = false;
    _graphql = null;
  }

  Future<void> _routeToNotification(RemoteMessage message) async {
    final graphql = _graphql;
    final postId = message.data['relatedPostId'] as String?;
    if (graphql == null || postId == null) return;
    final navigator = rootNavigatorKey.currentState;
    if (navigator == null) return;
    final (post, _) = await graphql.fetchPostDetail(postId);
    if (post == null) return;
    final Widget screen = switch (post.postType) {
      'ADOPTION' => AdoptionDetailScreen(postId: postId),
      'PRODUCT' => ProductDetailScreen(postId: postId),
      'MATING' => MatingDetailScreen(postId: postId),
      _ => RescueDetailScreen(postId: postId),
    };
    navigator.push(MaterialPageRoute(builder: (_) => screen));
  }
}
