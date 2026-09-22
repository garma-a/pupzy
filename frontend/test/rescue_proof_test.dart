import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/rescue_proof.dart';
import 'package:pupzy/models/safety.dart';
import 'package:pupzy/screens/rescue_proof_form_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/rescue_proof_entry.dart';
import 'package:pupzy/widgets/rescue_proofs_owner_section.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

// A valid 1x1 PNG, so Image.memory has something real to decode.
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
XFile _photo(int n) => XFile.fromData(_png, name: 'p$n.png', mimeType: 'image/png');

void main() {
  late FakeSafetyGraphQL graphql;
  late SafetyEvents events;
  late ToastRecorder toasts;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    graphql = FakeSafetyGraphQL();
    events = SafetyEvents();
    toasts = ToastRecorder()..install();
  });

  tearDown(() => toasts.uninstall());

  void tallSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(800, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  group('model', () {
    test('parses a proof with photos and a submitter', () {
      final p = RescueProof.fromJson({
        'id': 'p1',
        'postId': 'post-1',
        'status': 'PENDING',
        'happenedAt': '2026-09-18T10:30:00.000Z',
        'areaName': 'Maadi',
        'condition': 'HEALTHY',
        'whereabouts': 'WITH_ME',
        'story': 'Took her home.',
        'respondedAt': null,
        'createdAt': '2026-09-18T12:00:00.000Z',
        'submitter': {'id': 'u1', 'fullName': 'Mona', 'fullNameArabic': null, 'profilePictureUrl': null},
        'media': [
          {'id': 'm1', 'publicUrl': 'https://x/1.jpg'},
        ],
      });
      expect(p.isPending, isTrue);
      expect(p.media.single.publicUrl, 'https://x/1.jpg');
      expect(p.submitter!.displayName(arabic: true), 'Mona', reason: 'falls back to the other language');
      expect(p.copyWith(status: 'CONFIRMED').isConfirmed, isTrue);
    });

    test('tolerates a deleted submitter', () {
      final p = RescueProof.fromJson({
        'id': 'p1',
        'postId': 'post-1',
        'status': 'CONFIRMED',
        'happenedAt': '2026-09-18T10:30:00.000Z',
        'areaName': 'Maadi',
        'condition': 'HEALTHY',
        'whereabouts': 'WITH_ME',
        'story': 'Took her home.',
        'createdAt': '2026-09-18T12:00:00.000Z',
        'submitter': null,
        'media': null,
      });
      expect(p.submitter, isNull);
      expect(p.media, isEmpty);
    });

    test('only RESCUE and LOST_PET posts accept a proof, and each closes to the right status', () {
      expect(ProofPostKind.forPost(postType: 'RESCUE'), ProofPostKind.rescue);
      expect(ProofPostKind.forPost(postType: 'LOST', lostReportType: 'LOST_PET'), ProofPostKind.foundPet);
      expect(ProofPostKind.forPost(postType: 'LOST', lostReportType: 'FOUND_STRAY'), isNull, reason: 'a found-stray report is the finder\'s own');
      expect(ProofPostKind.forPost(postType: 'LOST'), isNull);
      expect(ProofPostKind.forPost(postType: 'ADOPTION'), isNull);
      expect(ProofPostKind.rescue.closedStatus, 'RESOLVED');
      expect(ProofPostKind.foundPet.closedStatus, 'REUNITED');
    });
  });

  group('proof form', () {
    RescueProof? formResult;
    var pickCount = 0;

    Future<void> openForm(
      WidgetTester tester, {
      ProofPostKind kind = ProofPostKind.rescue,
      String? defaultArea,
      DateTime? initialHappenedAt,
      ProofPhotoUploader? uploader,
      LangProvider? lang,
    }) async {
      tallSurface(tester);
      formResult = null;
      pickCount = 0;
      await tester.pumpWidget(
        safetyTestApp(
          graphql: graphql,
          events: events,
          lang: lang,
          child: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                formResult = await Navigator.of(context).push<RescueProof>(
                  MaterialPageRoute(
                    builder: (_) => RescueProofFormScreen(
                      postId: 'post-1',
                      kind: kind,
                      defaultArea: defaultArea,
                      initialHappenedAt: initialHappenedAt,
                      photoPicker: (_) async => _photo(pickCount++),
                      photoUploader: uploader ?? (g, photos) async => [for (var i = 0; i < photos.length; i++) 'media-$i'],
                    ),
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }

    bool submitEnabled(WidgetTester tester) => tester.widget<ElevatedButton>(find.byKey(const Key('proofSubmitButton'))).onPressed != null;

    Future<void> addPhoto(WidgetTester tester) async {
      await tester.ensureVisible(find.byKey(const Key('proofAddPhoto')));
      await tester.tap(find.byKey(const Key('proofAddPhoto')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('proofPickGallery')));
      await tester.pumpAndSettle();
    }

    Future<void> tapKey(WidgetTester tester, String key) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.tap(find.byKey(Key(key)));
      await tester.pump();
    }

    Future<void> enter(WidgetTester tester, String key, String text) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.enterText(find.byKey(Key(key)), text);
      await tester.pump();
    }

    const goodStory = 'Found her under a car and took her to my place.';

    Future<void> fillEverything(WidgetTester tester, {bool area = true}) async {
      await addPhoto(tester);
      if (area) await enter(tester, 'proofAreaField', '  Maadi, Road 9  ');
      await tapKey(tester, 'proofCondition_HEALTHY');
      await tapKey(tester, 'proofWhereabouts_WITH_ME');
      await enter(tester, 'proofStoryField', '  $goodStory  ');
      await tapKey(tester, 'proofConsentCheckbox');
    }

    testWidgets('cannot be sent until every requirement is met', (tester) async {
      await openForm(tester);
      expect(submitEnabled(tester), isFalse);

      await addPhoto(tester);
      expect(submitEnabled(tester), isFalse, reason: 'still missing where/condition/story/consent');
      await enter(tester, 'proofAreaField', 'Maadi');
      await tapKey(tester, 'proofCondition_HEALTHY');
      await tapKey(tester, 'proofWhereabouts_AT_VET');
      expect(submitEnabled(tester), isFalse);

      await enter(tester, 'proofStoryField', 'too short');
      expect(submitEnabled(tester), isFalse);
      expect(find.textContaining('Write at least 20 characters'), findsOneWidget);

      await enter(tester, 'proofStoryField', goodStory);
      expect(submitEnabled(tester), isFalse, reason: 'consent to share WhatsApp is required');

      await tapKey(tester, 'proofConsentCheckbox');
      expect(submitEnabled(tester), isTrue);

      await tapKey(tester, 'proofRemovePhoto_0');
      expect(submitEnabled(tester), isFalse, reason: 'at least one photo is mandatory');
    });

    testWidgets('sends exactly what was entered, then closes and confirms', (tester) async {
      await openForm(tester);
      await fillEverything(tester);
      await addPhoto(tester); // a second photo
      expect(submitEnabled(tester), isTrue);

      await tapKey(tester, 'proofSubmitButton');
      await tester.pumpAndSettle();

      final sent = graphql.submittedProofs.single;
      expect(sent['postId'], 'post-1');
      expect(sent['mediaIds'], ['media-0', 'media-1']);
      expect(sent['areaName'], 'Maadi, Road 9', reason: 'trimmed');
      expect(sent['condition'], 'HEALTHY');
      expect(sent['whereabouts'], 'WITH_ME');
      expect(sent['story'], goodStory, reason: 'trimmed');
      expect(DateTime.now().difference(sent['happenedAt'] as DateTime).abs(), lessThan(const Duration(minutes: 1)));

      expect(formResult?.id, 'created');
      expect(toasts.messages, ['Sent to the owner for review']);
      expect(find.byKey(const Key('proofSubmitButton')), findsNothing, reason: 'the form closed');
    });

    testWidgets('a photo that fails to upload stops everything — nothing is sent', (tester) async {
      await openForm(tester, uploader: (g, photos) async => throw const ProofPhotoUploadException(2));
      await fillEverything(tester);
      await tapKey(tester, 'proofSubmitButton');
      await tester.pumpAndSettle();

      expect(graphql.submittedProofs, isEmpty, reason: 'a proof must never be sent with fewer photos than chosen');
      expect(toasts.messages.single, contains('Photo 2 failed to upload'));
      expect(find.byKey(const Key('proofSubmitButton')), findsOneWidget);
      expect(submitEnabled(tester), isTrue, reason: 'the user can retry');
    });

    testWidgets('a server rejection keeps the form open and shows the reason', (tester) async {
      graphql.proofFailure = const SafetyResult(ok: false, code: 'FORBIDDEN', message: 'You cannot submit a proof for your own post');
      await openForm(tester);
      await fillEverything(tester);
      await tapKey(tester, 'proofSubmitButton');
      await tester.pumpAndSettle();

      expect(toasts.messages, ['You cannot submit a proof for your own post']);
      expect(formResult, isNull);
      expect(find.byKey(const Key('proofSubmitButton')), findsOneWidget);
    });

    testWidgets('allows at most 4 photos and lets you remove one to add another', (tester) async {
      await openForm(tester);
      for (var i = 0; i < 4; i++) {
        await addPhoto(tester);
      }
      expect(find.byKey(const Key('proofPhoto_3')), findsOneWidget);
      expect(find.byKey(const Key('proofAddPhoto')), findsNothing);

      await tapKey(tester, 'proofRemovePhoto_1');
      expect(find.byKey(const Key('proofPhoto_3')), findsNothing);
      expect(find.byKey(const Key('proofAddPhoto')), findsOneWidget);
    });

    testWidgets('a time in the future is rejected', (tester) async {
      await openForm(tester, initialHappenedAt: DateTime.now().add(const Duration(hours: 2)));
      await fillEverything(tester);
      expect(find.text('That time is in the future.'), findsOneWidget);
      expect(submitEnabled(tester), isFalse);
    });

    testWidgets('pre-fills where with the post\'s own area', (tester) async {
      await openForm(tester, defaultArea: 'Zamalek');
      expect(tester.widget<TextField>(find.byKey(const Key('proofAreaField'))).controller!.text, 'Zamalek');
    });

    testWidgets('a finder sees finder wording, in Arabic when the app is Arabic', (tester) async {
      final lang = LangProvider();
      await lang.setLang(Lang.ar);
      await openForm(tester, kind: ProofPostKind.foundPet, lang: lang);

      expect(find.text('إثبات العثور'), findsOneWidget);
      expect(find.textContaining('متى وجدته'), findsOneWidget);
      expect(find.text('معي'), findsOneWidget, reason: 'whereabouts choices are localized');
      expect(find.textContaining('شارك رقم واتساب'), findsOneWidget);
      expect(find.text('Proof of finding'), findsNothing);
    });
  });

  group('rescuer entry button', () {
    final submitted = <RescueProof>[];

    Future<void> pumpEntry(
      WidgetTester tester, {
      List<RescueProof> myProofs = const [],
      bool postIsActive = true,
      ProofPostKind kind = ProofPostKind.rescue,
    }) async {
      submitted.clear();
      await tester.pumpWidget(
        safetyTestApp(
          graphql: graphql,
          events: events,
          child: RescueProofEntry(
            postId: 'post-1',
            kind: kind,
            defaultArea: 'Maadi',
            myProofs: myProofs,
            postIsActive: postIsActive,
            onSubmitted: submitted.add,
          ),
        ),
      );
    }

    String label(WidgetTester tester) => (tester.widget<OutlinedButton>(find.byKey(const Key('proofEntryButton'))).child as Text).data!;
    bool enabled(WidgetTester tester) => tester.widget<OutlinedButton>(find.byKey(const Key('proofEntryButton'))).onPressed != null;

    testWidgets('no proof yet: opens the form', (tester) async {
      await pumpEntry(tester);
      expect(find.text('I rescued this animal'), findsOneWidget);
      await tester.tap(find.byKey(const Key('proofEntryButton')));
      await tester.pumpAndSettle();
      expect(find.text('Proof of rescue'), findsOneWidget);
    });

    testWidgets('a finder sees "I found this pet"', (tester) async {
      await pumpEntry(tester, kind: ProofPostKind.foundPet);
      expect(find.text('I found this pet'), findsOneWidget);
    });

    testWidgets('pending: disabled and says it is waiting for the owner', (tester) async {
      await pumpEntry(tester, myProofs: [proof('a', status: 'PENDING')]);
      expect(label(tester), 'Proof sent — waiting for the owner ✓');
      expect(enabled(tester), isFalse);
    });

    testWidgets('confirmed: disabled thank-you, even after the post closed', (tester) async {
      await pumpEntry(tester, myProofs: [proof('a', status: 'CONFIRMED')], postIsActive: false);
      expect(label(tester), 'Confirmed ✓ — thank you!');
      expect(enabled(tester), isFalse);
    });

    testWidgets('rejected: explains and allows a new proof', (tester) async {
      await pumpEntry(tester, myProofs: [proof('a', status: 'REJECTED')]);
      expect(find.textContaining("wasn't accepted"), findsOneWidget);
      expect(enabled(tester), isTrue);
    });

    testWidgets('the newest proof decides the state', (tester) async {
      await pumpEntry(tester, myProofs: [
        proof('old', status: 'REJECTED', createdAt: DateTime.utc(2026, 9, 1)),
        proof('new', status: 'PENDING', createdAt: DateTime.utc(2026, 9, 10)),
      ]);
      expect(label(tester), 'Proof sent — waiting for the owner ✓');
    });

    testWidgets('a closed post without your confirmed proof shows nothing', (tester) async {
      await pumpEntry(tester, postIsActive: false);
      expect(find.byKey(const Key('proofEntryButton')), findsNothing);
      await pumpEntry(tester, myProofs: [proof('a', status: 'REJECTED')], postIsActive: false);
      expect(find.byKey(const Key('proofEntryButton')), findsNothing);
    });
  });

  group('owner review', () {
    final closed = <String>[];
    final opened = <String>[];
    var openResult = true;

    Future<void> pumpOwner(WidgetTester tester, {ProofPostKind kind = ProofPostKind.rescue, LangProvider? lang}) async {
      tallSurface(tester);
      closed.clear();
      opened.clear();
      openResult = true;
      await tester.pumpWidget(
        safetyTestApp(
          graphql: graphql,
          events: events,
          lang: lang,
          child: SingleChildScrollView(
            child: RescueProofsOwnerSection(
              postId: 'post-1',
              kind: kind,
              onPostClosed: closed.add,
              imageBuilder: (url, {width, height, fit = BoxFit.cover}) => Container(key: Key('img_$url'), width: width, height: height, color: Colors.grey),
              openLink: (url) async {
                opened.add(url);
                return openResult;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('shows nothing when there are no proofs', (tester) async {
      await pumpOwner(tester);
      expect(find.byType(Card), findsNothing);
      expect(find.textContaining('Proof of rescue'), findsNothing);
      expect(graphql.calls, ['fetchPostRescueProofs']);
    });

    testWidgets('lists a pending proof with its photos, facts and story', (tester) async {
      graphql.postProofs = [proof('p1')];
      await pumpOwner(tester);

      expect(find.text('Proof of rescue (1)'), findsOneWidget);
      expect(find.text('Mona'), findsOneWidget);
      expect(find.byKey(const Key('img_https://img.test/p1/0.jpg')), findsOneWidget);
      expect(find.byKey(const Key('img_https://img.test/p1/1.jpg')), findsOneWidget);
      expect(find.textContaining('Maadi, Road 9'), findsOneWidget);
      expect(find.textContaining('Healthy and safe'), findsOneWidget);
      expect(find.textContaining('With me'), findsOneWidget);
      expect(find.textContaining('Found her under a car'), findsOneWidget);
      expect(find.byKey(const Key('proofConfirm_p1')), findsOneWidget);
      expect(find.byKey(const Key('proofReject_p1')), findsOneWidget);
      expect(find.byKey(const Key('safetyMenuButton')), findsOneWidget, reason: 'the owner can report/block the submitter');
    });

    testWidgets('rejected and closed proofs are not shown to the owner', (tester) async {
      graphql.postProofs = [proof('a', status: 'REJECTED'), proof('b', status: 'CLOSED'), proof('c')];
      await pumpOwner(tester);
      expect(find.byKey(const Key('proofCard_a')), findsNothing);
      expect(find.byKey(const Key('proofCard_b')), findsNothing);
      expect(find.byKey(const Key('proofCard_c')), findsOneWidget);
    });

    testWidgets('a photo opens full screen and closes again', (tester) async {
      graphql.postProofs = [proof('p1')];
      await pumpOwner(tester);
      await tester.tap(find.byKey(const Key('proofPhoto_p1_1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('proofViewerClose')), findsOneWidget);
      await tester.tap(find.byKey(const Key('proofViewerClose')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('proofViewerClose')), findsNothing);
    });

    for (final (name, kind, status) in [
      ('rescue', ProofPostKind.rescue, 'RESOLVED'),
      ('found pet', ProofPostKind.foundPet, 'REUNITED'),
    ]) {
      testWidgets('confirming a $name proof closes the post as $status, refreshes feeds, and unlocks WhatsApp', (tester) async {
        graphql.postProofs = [proof('p1'), proof('p2', name: 'Sara', createdAt: DateTime.utc(2026, 9, 19))];
        await pumpOwner(tester, kind: kind);

        await tester.tap(find.byKey(const Key('proofConfirm_p1')));
        await tester.pumpAndSettle();
        expect(find.text('Confirm this proof?'), findsOneWidget);
        expect(find.textContaining('cannot be undone'), findsOneWidget);
        expect(find.textContaining("Mona's WhatsApp number will be shared with you"), findsOneWidget);
        expect(graphql.confirmedProofIds, isEmpty, reason: 'nothing happens before the owner confirms');

        await tester.tap(find.widgetWithText(TextButton, 'Confirm'));
        await tester.pumpAndSettle();

        expect(graphql.confirmedProofIds, ['p1']);
        expect(closed, [status]);
        expect(events.version, 1);
        expect(find.byKey(const Key('proofConfirmedBadge')), findsOneWidget);
        expect(find.byKey(const Key('proofContact_p1')), findsOneWidget);
        expect(find.byKey(const Key('proofConfirm_p1')), findsNothing);
        expect(find.byKey(const Key('proofCard_p2')), findsNothing, reason: 'the other pending proof closes with the post');
        expect(toasts.messages, ['Proof confirmed — your post is closed']);
      });
    }

    testWidgets('Cancel on the confirm dialog changes nothing', (tester) async {
      graphql.postProofs = [proof('p1')];
      await pumpOwner(tester);
      await tester.tap(find.byKey(const Key('proofConfirm_p1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(graphql.confirmedProofIds, isEmpty);
      expect(closed, isEmpty);
      expect(events.version, 0);
    });

    testWidgets('a failed confirm leaves the post open and shows the reason', (tester) async {
      graphql.postProofs = [proof('p1')];
      graphql.proofFailure = const SafetyResult(ok: false, code: 'VALIDATION_ERROR', message: 'This post is no longer active');
      await pumpOwner(tester);
      await tester.tap(find.byKey(const Key('proofConfirm_p1')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Confirm'));
      await tester.pumpAndSettle();

      expect(toasts.messages, ['This post is no longer active']);
      expect(closed, isEmpty);
      expect(events.version, 0);
      expect(find.byKey(const Key('proofConfirm_p1')), findsOneWidget);
    });

    testWidgets('rejecting removes only that proof and keeps the post open', (tester) async {
      graphql.postProofs = [proof('p1'), proof('p2', name: 'Sara', createdAt: DateTime.utc(2026, 9, 19))];
      await pumpOwner(tester);

      await tester.tap(find.byKey(const Key('proofReject_p1')));
      await tester.pumpAndSettle();
      expect(find.textContaining('will be told it was not accepted'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Reject'));
      await tester.pumpAndSettle();

      expect(graphql.rejectedProofIds, ['p1']);
      expect(find.byKey(const Key('proofCard_p1')), findsNothing);
      expect(find.byKey(const Key('proofCard_p2')), findsOneWidget);
      expect(closed, isEmpty, reason: 'rejecting never closes the post');
      expect(events.version, 0);
      expect(toasts.messages, ['Proof rejected']);
    });

    testWidgets('Contact on WhatsApp fetches the link for that proof and opens it', (tester) async {
      graphql.postProofs = [proof('p1', status: 'CONFIRMED')];
      graphql.whatsappLink = 'https://wa.me/201000000000';
      await pumpOwner(tester);

      await tester.tap(find.byKey(const Key('proofContact_p1')));
      await tester.pumpAndSettle();

      expect(graphql.whatsappLookups, ['p1']);
      expect(opened, ['https://wa.me/201000000000']);
    });

    testWidgets('a missing link shows the server reason; a WhatsApp that will not open says so', (tester) async {
      graphql.postProofs = [proof('p1', status: 'CONFIRMED')];
      graphql.whatsappError = 'Contact information is not available';
      await pumpOwner(tester);
      await tester.tap(find.byKey(const Key('proofContact_p1')));
      await tester.pumpAndSettle();
      expect(toasts.messages, ['Contact information is not available']);
      expect(opened, isEmpty);

      toasts.messages.clear();
      graphql.whatsappError = null;
      graphql.whatsappLink = 'https://wa.me/1';
      openResult = false;
      await tester.tap(find.byKey(const Key('proofContact_p1')));
      await tester.pumpAndSettle();
      expect(toasts.messages, ['Could not open WhatsApp']);
    });

    testWidgets('a deleted submitter shows a placeholder and offers no report/block', (tester) async {
      graphql.postProofs = [proof('p1', deletedSubmitter: true)];
      await pumpOwner(tester);
      expect(find.text('Deleted user'), findsOneWidget);
      expect(find.byKey(const Key('safetyMenuButton')), findsNothing);
    });

    testWidgets('renders in Arabic, with Arabic names and finder wording', (tester) async {
      final lang = LangProvider();
      await lang.setLang(Lang.ar);
      graphql.postProofs = [proof('p1')];
      await pumpOwner(tester, kind: ProofPostKind.foundPet, lang: lang);

      expect(find.text('إثبات العثور (1)'), findsOneWidget);
      expect(find.text('منى'), findsOneWidget);
      expect(find.text('رفض'), findsOneWidget);
      expect(find.text('تأكيد'), findsOneWidget);
      expect(find.text('Mona'), findsNothing);
    });
  });
}
