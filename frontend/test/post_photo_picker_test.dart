import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/post_photo_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

/// A gallery that returns [galleryCount] new photos per pick and a camera
/// that returns one, or throws [error].
class _FakePicker extends ImagePickerPlatform {
  _FakePicker(this.dir);
  final Directory dir;
  int galleryCount = 1;
  PlatformException? error;
  int? lastLimit;
  ImageSource? lastSource;
  int singleGalleryPicks = 0;
  int _made = 0;

  XFile _photo() {
    final file = File('${dir.path}/photo_${_made++}.jpg')..writeAsBytesSync(image.encodeJpg(image.Image(width: 8, height: 8)));
    return XFile(file.path, mimeType: 'image/jpeg');
  }

  @override
  Future<XFile?> getImageFromSource({required ImageSource source, ImagePickerOptions options = const ImagePickerOptions()}) async {
    lastSource = source;
    if (source == ImageSource.gallery) singleGalleryPicks++;
    if (error != null) throw error!;
    return _photo();
  }

  @override
  Future<List<XFile>> getMultiImageWithOptions({MultiImagePickerOptions options = const MultiImagePickerOptions()}) async {
    lastSource = ImageSource.gallery;
    lastLimit = options.limit;
    if (error != null) throw error!;
    return [for (var i = 0; i < galleryCount; i++) _photo()];
  }
}

/// Holds the post's photos the way a post form does.
class _Host extends StatefulWidget {
  const _Host({required this.photos});
  final List<XFile> photos;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Padding(
      padding: const EdgeInsets.all(16),
      child: PostPhotoPicker(
        photos: widget.photos,
        title: 'Add photos of the item',
        subtitle: 'Up to 4 photos',
        onChanged: (photos) => setState(
          () => widget.photos
            ..clear()
            ..addAll(photos),
        ),
      ),
    ),
  );
}

void main() {
  late Directory dir;
  late _FakePicker picker;
  late ToastRecorder toasts;
  late ImagePickerPlatform original;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    dir = Directory.systemTemp.createTempSync('pupzy-photo-picker-');
    original = ImagePickerPlatform.instance;
    picker = _FakePicker(dir);
    ImagePickerPlatform.instance = picker;
    toasts = ToastRecorder()..install();
  });

  tearDown(() {
    toasts.uninstall();
    ImagePickerPlatform.instance = original;
    dir.deleteSync(recursive: true);
  });

  Future<List<XFile>> pumpPicker(WidgetTester tester, [List<XFile>? start]) async {
    final photos = start ?? <XFile>[];
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    // Windows can't delete a file that is still open: close the thumbnails
    // and let their reads finish before tearDown deletes [dir].
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      imageCache.clear();
      imageCache.clearLiveImages();
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump();
      }
    });
    await tester.pumpWidget(
      safetyTestApp(
        graphql: FakeSafetyGraphQL(),
        events: SafetyEvents(),
        child: _Host(photos: photos),
      ),
    );
    await tester.pumpAndSettle();
    return photos;
  }

  Future<void> choose(WidgetTester tester, String option, {Finder? from}) async {
    await tester.tap(from ?? find.byKey(const Key('addPostPhotos')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(option));
    await tester.pumpAndSettle();
  }

  List<String> names(List<XFile> photos) => photos.map((p) => p.path.split(RegExp(r'[\\/]')).last).toList();

  group('addPostPhotos', () {
    XFile f(String path) => XFile(path);

    test('appends, skips photos already in the post, and stops at four', () {
      final result = addPostPhotos([f('a'), f('b')], [f('b'), f('c'), f('d'), f('e'), f('f')]);
      expect(result.photos.map((p) => p.path), ['a', 'b', 'c', 'd']);
      expect(result.overLimit, 2);
    });

    test('a pick within the limit loses nothing', () {
      final result = addPostPhotos([], [f('a'), f('b')]);
      expect((result.photos.length, result.overLimit), (2, 0));
    });
  });

  testWidgets('the photo box offers the camera and the gallery', (tester) async {
    await pumpPicker(tester);
    await tester.tap(find.byKey(const Key('addPostPhotos')));
    await tester.pumpAndSettle();

    expect(find.text('Take a photo'), findsOneWidget);
    expect(find.text('Choose from gallery'), findsOneWidget);
    expect(find.text('Up to 4 photos at once'), findsOneWidget);
  });

  testWidgets('the camera adds one photo', (tester) async {
    final photos = await pumpPicker(tester);
    await choose(tester, 'Take a photo');

    expect(picker.lastSource, ImageSource.camera);
    expect(photos, hasLength(1));
    expect(find.text('Cover'), findsOneWidget);
  });

  testWidgets('the gallery adds several photos at once, limited to the free slots', (tester) async {
    picker.galleryCount = 3;
    final photos = await pumpPicker(tester);
    await choose(tester, 'Choose from gallery');

    expect(picker.lastLimit, 4);
    expect(photos, hasLength(3));
    expect(find.text('Cover'), findsOneWidget, reason: 'only the first photo is the cover');
    expect(find.text('Hold and drag to reorder · the first photo is the cover'), findsOneWidget);

    // One slot left: the gallery opens for a single photo (image_picker
    // turns a limit of 1 into a single pick).
    await choose(tester, 'Choose from gallery', from: find.byKey(const Key('addMorePostPhotos')));
    expect(picker.singleGalleryPicks, 1);
    expect(photos, hasLength(4));
    expect(find.byKey(const Key('addMorePostPhotos')), findsNothing, reason: 'no add tile at four photos');
  });

  testWidgets('a pick past four photos keeps the first ones and says so', (tester) async {
    picker.galleryCount = 6;
    final photos = await pumpPicker(tester);
    await choose(tester, 'Choose from gallery');

    expect(photos, hasLength(4));
    expect(toasts.messages, ['A post can have 4 photos: the first ones were added']);
  });

  testWidgets('× removes a photo', (tester) async {
    picker.galleryCount = 3;
    final photos = await pumpPicker(tester);
    await choose(tester, 'Choose from gallery');

    await tester.tap(find.bySemanticsLabel('Remove photo 2'));
    await tester.pumpAndSettle();
    expect(names(photos), ['photo_0.jpg', 'photo_2.jpg']);
  });

  testWidgets('tapping a photo can set it as the cover', (tester) async {
    picker.galleryCount = 3;
    final photos = await pumpPicker(tester);
    await choose(tester, 'Choose from gallery');

    await tester.tap(find.bySemanticsLabel('Photo 3'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Set as cover'));
    await tester.pumpAndSettle();
    expect(names(photos), ['photo_2.jpg', 'photo_0.jpg', 'photo_1.jpg']);
  });

  testWidgets('the cover has no "Set as cover" option, only Remove', (tester) async {
    final photos = await pumpPicker(tester);
    await choose(tester, 'Choose from gallery');

    await tester.tap(find.bySemanticsLabel('Photo 1, cover'));
    await tester.pumpAndSettle();
    expect(find.text('Set as cover'), findsNothing);
    await tester.tap(find.text('Remove photo'));
    await tester.pumpAndSettle();
    expect(photos, isEmpty);
    expect(find.byKey(const Key('addPostPhotos')), findsOneWidget, reason: 'back to the empty box');
  });

  testWidgets('hold and drag reorders the photos', (tester) async {
    picker.galleryCount = 3;
    final photos = await pumpPicker(tester);
    await choose(tester, 'Choose from gallery');

    final last = tester.getCenter(find.bySemanticsLabel('Photo 3'));
    final first = tester.getCenter(find.bySemanticsLabel('Photo 1, cover'));
    final gesture = await tester.startGesture(last, kind: PointerDeviceKind.touch);
    await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
    // Move gradually, as a finger does, to just before the first photo.
    final target = first - const Offset(60, 0);
    for (var i = 1; i <= 20; i++) {
      await gesture.moveTo(Offset.lerp(last, target, i / 20)!);
      await tester.pump(const Duration(milliseconds: 16));
    }
    await tester.pump(const Duration(milliseconds: 300));
    await gesture.up();
    await tester.pumpAndSettle();

    expect(names(photos).first, 'photo_2.jpg', reason: 'the dragged photo is now the cover');
    expect(photos, hasLength(3));
  });

  testWidgets('a denied camera explains how to allow it', (tester) async {
    picker.error = PlatformException(code: 'camera_access_denied');
    final photos = await pumpPicker(tester);
    await choose(tester, 'Take a photo');

    expect(photos, isEmpty);
    expect(toasts.messages, ["Allow camera access for Pupzy in your phone's settings"]);
  });

  testWidgets('a camera that fails for another reason says so', (tester) async {
    picker.error = PlatformException(code: 'no_available_camera');
    await pumpPicker(tester);
    await choose(tester, 'Take a photo');

    expect(toasts.messages, ["Couldn't open the camera"]);
  });
}
