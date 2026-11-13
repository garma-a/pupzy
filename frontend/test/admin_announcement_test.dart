import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/app_notification.dart';
import 'package:pupzy/screens/notifications_panel.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

const _longBody =
    'The shelter in Smouha is open this Friday from 10 am to 4 pm for free vaccinations.\n'
    'Bring your pet in a carrier or on a leash, and its vaccination card if you have one.\n'
    'Volunteers will be there to help with transport for rescued animals. Thank you for helping the animals of Alexandria!';

AppNotification _announcement({String id = 'a1', bool isRead = false, String title = 'Free vaccination day', String body = _longBody}) =>
    AppNotification(
      id: id,
      type: 'ADMIN_ANNOUNCEMENT',
      title: title,
      body: body,
      relatedPostId: null,
      isRead: isRead,
      createdAt: DateTime.now().subtract(const Duration(hours: 2)),
    );

void main() {
  late FakeSafetyGraphQL graphql;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeSafetyGraphQL();
  });

  Future<void> pumpPanel(WidgetTester tester, {LangProvider? lang, String? openAnnouncementId}) async {
    tester.view.physicalSize = const Size(1000, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(
      graphql: graphql,
      events: SafetyEvents(),
      lang: lang,
      child: NotificationsPanel(openAnnouncementId: openAnnouncementId),
    ));
    await tester.pumpAndSettle();
  }

  Finder sheet() => find.byKey(const Key('announcementSheet'));

  testWidgets('an Announcement has the campaign icon', (tester) async {
    graphql.notifications = [_announcement()];
    await pumpPanel(tester);

    expect(find.byIcon(Icons.campaign_outlined), findsOneWidget);
  });

  testWidgets('tapping it marks it read and shows the full message, without opening a Post', (tester) async {
    graphql.notifications = [_announcement()];
    await pumpPanel(tester);

    await tester.tap(find.text('Free vaccination day'));
    await tester.pumpAndSettle();

    expect(sheet(), findsOneWidget);
    final body = tester.widget<SelectableText>(find.descendant(of: sheet(), matching: find.byType(SelectableText)).last);
    expect(body.data, _longBody, reason: 'the whole message, line breaks included, not the two-line preview');
    expect(find.descendant(of: sheet(), matching: find.text('Announcement')), findsOneWidget);
    expect(graphql.readNotificationIds, ['a1']);
    expect(graphql.calls.where((c) => c.startsWith('fetchPostDetail')), isEmpty, reason: 'an Announcement has no Post');

    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(sheet(), findsNothing);
  });

  testWidgets('an Arabic Announcement is laid out right to left', (tester) async {
    SharedPreferences.setMockInitialValues({'lang': 'ar'});
    final lang = LangProvider();
    await lang.setLang(Lang.ar);
    graphql.notifications = [_announcement(title: 'يوم تطعيم مجاني', body: 'الملجأ مفتوح يوم الجمعة.\nأحضروا حيواناتكم.')];
    await pumpPanel(tester, lang: lang);

    await tester.tap(find.text('يوم تطعيم مجاني'));
    await tester.pumpAndSettle();

    expect(find.descendant(of: sheet(), matching: find.text('إعلان')), findsOneWidget);
    final direction = Directionality.of(tester.element(find.descendant(of: sheet(), matching: find.byType(SelectableText)).last));
    expect(direction, TextDirection.rtl);
  });

  testWidgets('a tapped push opens the Announcement once the inbox loads, without marking it read again', (tester) async {
    graphql.notifications = [_announcement(id: 'other', title: 'Older news'), _announcement(id: 'a2')];
    await pumpPanel(tester, openAnnouncementId: 'a2');

    expect(sheet(), findsOneWidget);
    expect(find.descendant(of: sheet(), matching: find.text('Free vaccination day')), findsOneWidget);
    expect(graphql.readNotificationIds, isEmpty, reason: 'the push tap already marked it read');
  });

  testWidgets('a push for an unknown or non-Announcement id just shows the inbox', (tester) async {
    graphql.notifications = [_announcement(id: 'a3')];
    await pumpPanel(tester, openAnnouncementId: 'not-here');

    expect(sheet(), findsNothing);
    expect(find.text('Free vaccination day'), findsOneWidget);
  });
}
