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

  Finder notificationsRow() => find.ancestor(of: find.text('Notifications'), matching: find.byType(GestureDetector)).first;
  bool switchValue(WidgetTester tester) => tester.widget<Switch>(find.byType(Switch)).value;

  testWidgets('shows a switch, not an arrow, for notifications', (tester) async {
    await pumpSheet(tester);

    expect(find.byType(Switch), findsOneWidget);
    expect(switchValue(tester), isTrue);
    expect(find.descendant(of: notificationsRow(), matching: find.byIcon(Icons.chevron_right)), findsNothing);
  });

  testWidgets('tapping the row turns notifications off', (tester) async {
    await pumpSheet(tester);

    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();

    expect(graphql.saved, [false]);
    expect(switchValue(tester), isFalse);
    expect(push.permissionRequests, 0);
  });

  testWidgets('turning them on asks the phone for permission', (tester) async {
    graphql.notificationsEnabled = false;
    await pumpSheet(tester);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(graphql.saved, [true]);
    expect(switchValue(tester), isTrue);
    expect(push.permissionRequests, 1);
  });

  testWidgets('a failed save puts the switch back and says so', (tester) async {
    graphql.saveSucceeds = false;
    await pumpSheet(tester);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(switchValue(tester), isTrue);
    expect(toasts.messages, ['Could not update notifications. Try again.']);
  });
}
