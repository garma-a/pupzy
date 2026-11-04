import 'package:firebase_auth/firebase_auth.dart' show User;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/contact_request.dart';
import 'package:pupzy/models/list_page.dart';
import 'package:pupzy/screens/profile_screen.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/graphql_service.dart';
import 'package:pupzy/services/push_service.dart';
import 'package:pupzy/widgets/pill_toggle.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

/// Only what the profile sheet needs for the notifications row.
class _FakeProfileGraphQL implements GraphQLService {
  bool notificationsEnabled = true;
  bool saveSucceeds = true;
  final List<bool> saved = [];

  @override
  Future<Map<String, dynamic>?> fetchMe() async => {
        'id': 'u1',
        'fullName': 'Mona',
        'email': 'mona@example.test',
        'notificationsEnabled': notificationsEnabled,
      };

  @override
  Future<ListPage<ContactRequest>> fetchMyContactRequests({String? postId, String? status, int first = 20, String? after}) async =>
      const ListPage();

  @override
  Future<bool> updateMyNotificationPreferences(bool notificationsEnabled) async {
    saved.add(notificationsEnabled);
    return saveSucceeds;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// No one is signed in to Firebase here; the sheet only reads the user.
class _FakeAuth extends ChangeNotifier implements AuthService {
  @override
  User? get currentUser => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakePush implements PushService {
  int permissionRequests = 0;

  @override
  Future<bool> requestPermission() async {
    permissionRequests++;
    return true;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _FakeProfileGraphQL graphql;
  late _FakePush push;
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = _FakeProfileGraphQL();
    push = _FakePush();
    toasts = ToastRecorder()..install();
  });

  tearDown(() => toasts.uninstall());

  Future<void> pumpSheet(WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<LangProvider>.value(value: LangProvider()),
        Provider<GraphQLService>.value(value: graphql),
        Provider<PushService>.value(value: push),
        ChangeNotifierProvider<AuthService>.value(value: _FakeAuth()),
      ],
      child: const MaterialApp(home: Scaffold(body: ProfileSheet())),
    ));
    await tester.pumpAndSettle();
  }

  Finder toggle() => find.ancestor(of: find.byKey(const Key('notificationsTogglePill')), matching: find.byType(PillToggle));
  bool isOn(WidgetTester tester) => tester.widget<PillToggle>(toggle()).firstSelected;

  testWidgets('notifications use the same On/Off pill as the language row', (tester) async {
    await pumpSheet(tester);

    expect(find.byType(PillToggle), findsNWidgets(2), reason: 'language and notifications');
    expect(find.descendant(of: toggle(), matching: find.text('On')), findsOneWidget);
    expect(find.descendant(of: toggle(), matching: find.text('Off')), findsOneWidget);
    expect(isOn(tester), isTrue);
  });

  testWidgets('tapping Off turns notifications off', (tester) async {
    await pumpSheet(tester);

    await tester.tap(find.text('Off'));
    await tester.pumpAndSettle();

    expect(graphql.saved, [false]);
    expect(isOn(tester), isFalse);
    expect(push.permissionRequests, 0);
  });

  testWidgets('turning them on asks the phone for permission', (tester) async {
    graphql.notificationsEnabled = false;
    await pumpSheet(tester);

    await tester.tap(find.text('On'));
    await tester.pumpAndSettle();

    expect(graphql.saved, [true]);
    expect(isOn(tester), isTrue);
    expect(push.permissionRequests, 1);
  });

  testWidgets('a failed save puts the toggle back and says so', (tester) async {
    graphql.saveSucceeds = false;
    await pumpSheet(tester);

    await tester.tap(find.text('Off'));
    await tester.pumpAndSettle();

    expect(isOn(tester), isTrue);
    expect(toasts.messages, ['Could not update notifications. Try again.']);
  });

  testWidgets('tapping the option already selected changes nothing', (tester) async {
    await pumpSheet(tester);

    await tester.tap(find.text('On'));
    await tester.pumpAndSettle();

    expect(graphql.saved, isEmpty);
    expect(isOn(tester), isTrue);
  });
}
