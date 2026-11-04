import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as image;
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/models/post.dart';
import 'package:pupzy/models/terms_info.dart';
import 'package:pupzy/screens/post_form_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'post_form_validation_test.dart' show FormGraphQL, OnePhotoPicker;
import 'safety_test_support.dart';

const _uploadError = 'Your photos could not be uploaded. Your post was not published. Please try again.';
const _serverError = 'At least one photo must upload successfully before publishing. Please upload a photo and try again.';
const _publicationError = 'Could not confirm publication. Please check My Posts before trying again.';

class _PhotoGraphQL extends FormGraphQL {
  bool missingTicket = false;
  bool throwTicket = false;
  bool throwPublication = false;
  int ticketCalls = 0;
  final List<List<String>> publications = [];

  @override
  Future<TermsInfo?> fetchTerms() async => null;

  @override
  Future<Map<String, dynamic>?> requestMediaUploadUrl({required String contentType, required int fileSizeBytes}) async {
    ticketCalls++;
    if (throwTicket) throw TimeoutException('Ticket request interrupted');
    if (missingTicket) return null;
    return {'mediaId': 'photo-$ticketCalls', 'uploadUrl': 'https://storage.test/photo-$ticketCalls'};
  }

  @override
  Future<(Map<String, dynamic>?, String?)> createMatingPost({
    required String cityId,
    required String petName,
    required String species,
    required String breed,
    required String gender,
    required int ageValue,
    required String ageUnit,
    required bool isPurebred,
    bool? hasPedigreeCertificate,
    bool? vaccinated,
    bool? dewormed,
    String? termsSummary,
    String? matingConditions,
    List<String>? mediaIds,
  }) async {
    publications.add(List.of(mediaIds ?? []));
    if (throwPublication) throw http.ClientException('Response interrupted');
    // A failed server response lets us verify the existing error display and
    // retained draft after a successful upload, without navigating elsewhere.
    return (null, _serverError);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory temporaryDirectory;
  late File photo;
  late ImagePickerPlatform originalPicker;
  late _PhotoGraphQL graphql;
  late Completer<void> finished;
  late List<String> notices;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    temporaryDirectory = Directory.systemTemp.createTempSync('pupzy-photo-publication-');
    photo = File('${temporaryDirectory.path}/photo.jpg')..writeAsBytesSync(image.encodeJpg(image.Image(width: 8, height: 8)));
    originalPicker = ImagePickerPlatform.instance;
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    graphql = _PhotoGraphQL();
    finished = Completer<void>();
    notices = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('PonnamKarthik/fluttertoast'),
      (call) async {
        if (call.method == 'showToast') {
          final message = call.arguments['msg'] as String;
          notices.add(message);
          if ([_uploadError, _serverError, _publicationError].contains(message) && !finished.isCompleted) {
            finished.complete();
          }
        }
        return true;
      },
    );
  });

  tearDown(() {
    ImagePickerPlatform.instance = originalPicker;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('PonnamKarthik/fluttertoast'),
      null,
    );
    temporaryDirectory.deleteSync(recursive: true);
  });

  Future<void> prepareForm(WidgetTester tester, {int photos = 1}) async {
    tester.view.physicalSize = const Size(2000, 3600);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      safetyTestApp(
        graphql: graphql,
        events: SafetyEvents(),
        child: const PostFormScreen(type: PostType.mating),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'e.g. Rex'), 'Duke');
    await tester.tap(find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, 'e.g. German Shepherd'), 'Golden Retriever');
    await tester.enterText(find.widgetWithText(TextField, 'e.g. 2 years'), '2 years');
    await tester.tap(find.text('Male').first);
    await tester.pump();
    await tester.ensureVisible(find.text('Search and select a city'));
    await tester.tap(find.text('Search and select a city'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Qasr Al-Nile').last);
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView).first, const Offset(0, 8000));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add pet photos'));
    await tester.pumpAndSettle();
    for (var i = 1; i < photos; i++) {
      await tester.tap(find.byIcon(Icons.add_a_photo_outlined));
      await tester.pumpAndSettle();
    }
    for (var i = 0; i < 12; i++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -600));
      await tester.pump();
    }
    expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Post Mating Listing')).onPressed, isNotNull);
  }

  Future<void> submit(WidgetTester tester, Future<http.Response> Function(http.Request) response) async {
    final button = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Post Mating Listing'));
    await tester.runAsync(
      () => http.runWithClient(() async {
        // Create the completion signal in runAsync's real zone, including on
        // retries; a fake-zone completer cannot drain while runAsync awaits it.
        finished = Completer<void>();
        button.onPressed!();
        await finished.future.timeout(
          const Duration(seconds: 5),
          onTimeout: () => throw StateError(
            'Submission did not finish: tickets=${graphql.ticketCalls}, publications=${graphql.publications}, notices=$notices',
          ),
        );
      }, () => MockClient(response)),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'upload failures must not become unhandled widget errors');
    expect(find.byType(PostFormScreen), findsOneWidget, reason: 'the draft remains open');
    expect(find.text('Duke'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing, reason: 'the submit spinner resets');
    expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Post Mating Listing')).onPressed, isNotNull);
  }

  testWidgets('a rejected upload ticket leaves the draft retryable and never creates a Post', (tester) async {
    graphql.missingTicket = true;
    await prepareForm(tester);
    await submit(tester, (_) async => http.Response('', 200));
    expect(graphql.publications, isEmpty);
    expect(notices, contains(_uploadError));
    graphql.missingTicket = false;
    await submit(tester, (_) async => http.Response('', 200));
    expect(graphql.publications, [
      ['photo-2'],
    ], reason: 'retry uses a new upload ticket and retains the selected photo');
  });

  testWidgets('an interrupted ticket request is handled without crashing', (tester) async {
    graphql.throwTicket = true;
    await prepareForm(tester);
    await submit(tester, (_) async => http.Response('', 200));
    expect(graphql.publications, isEmpty);
    expect(notices, contains(_uploadError));
  });

  testWidgets('storage rejecting the bytes never publishes a Post', (tester) async {
    await prepareForm(tester);
    await submit(tester, (_) async => http.Response('BadDigest', 400));
    expect(graphql.publications, isEmpty);
    expect(notices, contains(_uploadError));
  });

  testWidgets('a network error uploading bytes never publishes a Post', (tester) async {
    await prepareForm(tester);
    await submit(tester, (_) async => throw http.ClientException('connection lost'));
    expect(graphql.publications, isEmpty);
    expect(notices, contains(_uploadError));
  });

  testWidgets('a local photo that disappears is handled as an upload failure', (tester) async {
    await prepareForm(tester);
    photo.deleteSync();
    await submit(tester, (_) async => http.Response('', 200));
    expect(graphql.ticketCalls, 0);
    expect(graphql.publications, isEmpty);
    expect(notices, contains(_uploadError));
  });

  testWidgets('a server validation error is displayed and the form stays retryable', (tester) async {
    await prepareForm(tester);
    await submit(tester, (_) async => http.Response('', 200));
    expect(graphql.publications, [
      ['photo-1'],
    ]);
    expect(notices, contains(_serverError));
  });

  testWidgets('an interrupted create response shows recovery guidance without an automatic retry', (tester) async {
    graphql.throwPublication = true;
    await prepareForm(tester);
    await submit(tester, (_) async => http.Response('', 200));
    expect(graphql.publications, hasLength(1));
    expect(notices, contains(_publicationError));
  });

  testWidgets('partial upload success submits only uploaded photos and warns about the rest', (tester) async {
    await prepareForm(tester, photos: 2);
    var putCount = 0;
    await submit(tester, (_) async => http.Response('', ++putCount == 1 ? 400 : 200));
    expect(graphql.publications, [
      ['photo-2'],
    ]);
    expect(notices, contains('Some photos failed to upload. Only the uploaded photos will be included.'));
  });
}
