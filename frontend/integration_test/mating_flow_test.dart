import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:integration_test/integration_test.dart';
import 'package:pupzy/screens/post_form_screen.dart';
import 'package:pupzy/widgets/top_bar.dart';

import 'support.dart';

/// Find a Mate, end to end on a device against the local rig
/// (AUDIT/e2e-rig): the owner creates a listing through the real form with a
/// GPS-tagged photo and an Arabic age, sees owner controls; a viewer sees it
/// and requests contact; the blocked account never sees it; the owner deletes
/// it and it leaves the feed.
const _api = 'http://10.0.2.2:8080/graphql';

Future<Map<String, dynamic>> _gql(String query, [Map<String, Object?> variables = const {}]) async {
  final token = await FirebaseAuth.instance.currentUser!.getIdToken();
  final res = await http.post(
    Uri.parse(_api),
    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
    body: jsonEncode({'query': query, 'variables': variables}),
  );
  return jsonDecode(res.body) as Map<String, dynamic>;
}

Future<void> _openMatchingTab(WidgetTester tester) async {
  await tester.tap(find.text('Adopt').last);
  await pumpUntil(tester, find.text('Matching'));
  await tester.tap(find.text('Matching'));
  await tester.pump(const Duration(seconds: 2));
}

Future<void> _signOut(WidgetTester tester) async {
  // The profile sheet opens from the avatar in the top bar.
  await tester.tap(find.descendant(of: find.byType(PupzyTopBar), matching: find.byType(CircleAvatar)).first);
  await pumpUntil(tester, find.text('Sign Out'));
  await tester.ensureVisible(find.text('Sign Out'));
  await tester.tap(find.text('Sign Out'));
  await pumpUntil(tester, find.text('Welcome to Pupzy'), timeout: const Duration(seconds: 30));
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final shoot = Shooter(binding);
  final breed = 'Audit Retriever ${DateTime.now().millisecondsSinceEpoch % 100000}';
  final title = '$breed • Male for mating';

  testWidgets('Find a Mate: owner, viewer, blocked and delete', (tester) async {
    final picker = FakeImagePicker();
    ImagePickerPlatform.instance = picker;
    // A phone photo taken at a home in Zamalek — this exact spot must never go public.
    picker.queue.add(await writeTestJpeg('mate-gps', gps: (30.0626, 31.2197)));

    await launchApp();
    await signIn(tester, ownerEmail);
    await tester.pump(const Duration(seconds: 6));
    await shoot(tester, 'mate-01-owner-home');

    // ── Owner creates the listing through the real form ─────────────────────
    await tester.tap(find.byIcon(Icons.add).last);
    await pumpUntil(tester, find.text('Find a Mate'));
    await tester.tap(find.text('Find a Mate'));
    await pumpUntil(tester, find.text('Add pet photos'), reason: 'Find a Mate form did not open');
    await shoot(tester, 'mate-02-empty-form');
    // The form is a lazily built list: lower fields exist only once scrolled to.
    final formList = find.descendant(of: find.byType(PostFormScreen), matching: find.byType(ListView)).first;
    Future<void> reveal(Finder f) async {
      // Scroll back to the top, then down until [f] is built and on screen.
      await tester.drag(formList, const Offset(0, 4000));
      await tester.pump(const Duration(milliseconds: 300));
      for (var i = 0; i < 40 && f.hitTestable().evaluate().isEmpty; i++) {
        await tester.drag(formList, const Offset(0, -250));
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(f.hitTestable(), findsWidgets, reason: 'could not scroll $f into view');
    }
    final submit = find.widgetWithText(ElevatedButton, 'Post Mating Listing');
    await reveal(submit);
    expect(tester.widget<ElevatedButton>(submit).onPressed, isNull, reason: 'an empty form must not be submittable');
    await reveal(find.text('Add pet photos'));

    await tester.tap(find.text('Add pet photos'));
    await tester.pump(const Duration(seconds: 1));
    expect(picker.picks, 1);
    await reveal(find.widgetWithText(TextField, 'e.g. Rex'));
    await tester.enterText(find.widgetWithText(TextField, 'e.g. Rex'), 'Duke');
    await reveal(find.text('Dog').first);
    await tester.tap(find.text('Dog').first);
    await reveal(find.widgetWithText(TextField, 'e.g. German Shepherd'));
    await tester.enterText(find.widgetWithText(TextField, 'e.g. German Shepherd'), breed);
    // The form's own Arabic example — unparseable before the age-parser fix.
    await reveal(find.widgetWithText(TextField, 'e.g. 2 years'));
    await tester.enterText(find.widgetWithText(TextField, 'e.g. 2 years'), 'سنتان');
    await hideKeyboard(tester);
    await reveal(find.text('Male').first);
    await tester.tap(find.text('Male').first);
    await tester.pump();

    final cityField = find.text('Search and select a city');
    await reveal(cityField);
    await tester.tap(cityField);
    await pumpUntil(tester, find.text("Select your pet's city"));
    await tester.enterText(find.byType(TextField).last, 'Qasr');
    await pumpUntil(tester, find.text('Qasr Al-Nile'));
    await tester.tap(find.text('Qasr Al-Nile').last);
    await tester.pump(const Duration(seconds: 1));

    await reveal(submit);
    await tester.pump();
    await shoot(tester, 'mate-03-filled-form');
    expect(tester.widget<ElevatedButton>(submit).onPressed, isNotNull, reason: 'every required field is filled, including the Arabic age');
    await tester.tap(submit);
    // The button turns into a spinner while uploading; success pops the form.
    await pumpUntilGone(tester, find.byType(PostFormScreen), timeout: const Duration(seconds: 60));
    await tester.pump(const Duration(seconds: 1));

    // ── It appears in the Matching feed, with owner controls on detail ──────
    await _openMatchingTab(tester);
    await pumpUntil(tester, find.text(title), timeout: const Duration(seconds: 20), reason: 'new listing missing from the Matching feed');
    await tester.pump(const Duration(seconds: 4));
    await shoot(tester, 'mate-04-owner-feed');
    await tester.tap(find.text(title));
    await pumpUntil(tester, find.text('Mark Resolved'), timeout: const Duration(seconds: 20), reason: 'owner controls missing on own listing');
    expect(find.text('Contact Owner'), findsNothing, reason: 'an owner must not be offered to contact themselves');
    await tester.pump(const Duration(seconds: 3));
    await shoot(tester, 'mate-05-owner-detail');

    // Remember the listing and its public photo for the checks below.
    final mine = await _gql(r'query { myPosts(postType: MATING, first: 20) { edges { node { id title media { publicUrl } } } } }');
    final node = (mine['data']['myPosts']['edges'] as List).map((e) => e['node']).firstWhere((n) => n['title'] == title);
    final postId = node['id'] as String;
    final photoUrl = (node['media'] as List).first['publicUrl'] as String;

    await tester.pageBack();
    await tester.pump(const Duration(seconds: 1));
    await _signOut(tester);

    // ── Viewer sees it and asks to be put in touch ──────────────────────────
    await signIn(tester, viewerEmail);
    await _openMatchingTab(tester);
    await pumpUntil(tester, find.text(title), timeout: const Duration(seconds: 20), reason: 'viewer cannot see the listing');
    await tester.tap(find.text(title));
    await pumpUntil(tester, find.text('Contact Owner'), timeout: const Duration(seconds: 20));
    expect(find.text('Mark Resolved'), findsNothing, reason: 'viewers must not see owner controls');
    expect(find.text('Delete'), findsNothing);
    await tester.pump(const Duration(seconds: 3));
    await shoot(tester, 'mate-06-viewer-detail');
    await tester.tap(find.text('Contact Owner'));
    await pumpUntil(tester, find.text('Send a contact request'));
    await tester.enterText(find.widgetWithText(TextField, 'Write your message...'), 'Hi! My female is also a Golden Retriever — interested?');
    await hideKeyboard(tester);
    await tester.tap(find.text('Send Request'));
    await tester.pump(const Duration(seconds: 4));
    await shoot(tester, 'mate-06b-after-send');
    debugPrint('AFTER_SEND texts: ${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).whereType<String>().where((t) => t.length < 60).join(' | ')}');
    await pumpUntil(tester, find.text('Request Sent ✓'), timeout: const Duration(seconds: 20));
    await shoot(tester, 'mate-07-viewer-requested');
    await tester.pageBack();
    await tester.pump(const Duration(seconds: 1));
    await _signOut(tester);

    // ── The account the owner blocked never sees it ─────────────────────────
    await signIn(tester, blockedEmail);
    await _openMatchingTab(tester);
    await tester.pump(const Duration(seconds: 5));
    expect(find.text(title), findsNothing, reason: 'blocked account can see the owner\'s listing');
    await shoot(tester, 'mate-08-blocked-feed');
    await _signOut(tester);

    // ── Owner deletes it; it leaves the feed ────────────────────────────────
    await signIn(tester, ownerEmail);
    await _openMatchingTab(tester);
    await pumpUntil(tester, find.text(title), timeout: const Duration(seconds: 20));
    await tester.tap(find.text(title));
    await pumpUntil(tester, find.text('Delete'));
    await tester.tap(find.text('Delete').last);
    await pumpUntil(tester, find.text('Delete post?'));
    await tester.tap(find.widgetWithText(TextButton, 'Delete').last);
    await pumpUntilGone(tester, find.text('Mark Resolved'), timeout: const Duration(seconds: 20));
    await _openMatchingTab(tester);
    await tester.pump(const Duration(seconds: 4));
    expect(find.text(title), findsNothing, reason: 'deleted listing still in the feed');
    final gone = await _gql(r'query($p: ID!) { post(id: $p) { id } }', {'p': postId});
    expect(gone['data']['post'], isNull);

    // ── Privacy: does the published photo still carry the home's GPS? ───────
    final published = await http.get(Uri.parse(photoUrl.replaceFirst('localhost', '127.0.0.1')));
    final decoded = img.decodeJpg(published.bodyBytes);
    final gps = decoded?.exif.gpsIfd;
    final leaked = gps != null && gps.gpsLatitude != null;
    debugPrint('PHOTO_GPS_LEAK=$leaked lat=${gps?.gpsLatitude} lng=${gps?.gpsLongitude} bytes=${published.bodyBytes.length}');
    expect(leaked, isFalse, reason: 'the published photo exposes the GPS position it was taken at (finding F-08)');
  });
}
