import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/models/post.dart';
import 'package:pupzy/screens/post_form_screen.dart';
import 'package:pupzy/services/safety_events.dart';

import 'safety_test_support.dart';

class FormGraphQL extends FakeSafetyGraphQL {
  @override
  Future<List<Map<String, dynamic>>> fetchCities() async => [
        {'id': 'c1', 'nameEnglish': 'Qasr Al-Nile', 'nameArabic': 'قصر النيل', 'governorate': 'Cairo'},
      ];
}

class OnePhotoPicker extends ImagePickerPlatform {
  OnePhotoPicker(this.path);
  final String path;
  @override
  Future<XFile?> getImageFromSource({required ImageSource source, ImagePickerOptions options = const ImagePickerOptions()}) async =>
      XFile(path, mimeType: 'image/jpeg');
}

void main() {
  Future<void> pumpForm(WidgetTester tester, PostType type, [String? category]) async {
    tester.view.physicalSize = const Size(2000, 3600);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(
      graphql: FormGraphQL(),
      events: SafetyEvents(),
      child: PostFormScreen(type: type, initialCategory: category),
    ));
    await tester.pumpAndSettle();
  }

  /// Scrolls the lazily built form to the end and returns its submit button.
  Future<ElevatedButton> submitButton(WidgetTester tester) async {
    final list = find.descendant(of: find.byType(PostFormScreen), matching: find.byType(ListView)).first;
    for (var i = 0; i < 12; i++) {
      await tester.drag(list, const Offset(0, -600));
      await tester.pump();
    }
    return tester.widgetList<ElevatedButton>(find.byType(ElevatedButton)).last;
  }

  for (final (name, type, category) in [
    ('Rescue Alert', PostType.rescue, 'URGENT'),
    ('Lost Pet', PostType.rescue, 'LOST'),
    ('Found a Pet', PostType.rescue, 'FOUND'),
    ('Adoption', PostType.adoption, null),
    ('Product', PostType.product, null),
    ('Find a Mate', PostType.mating, null),
  ]) {
    testWidgets('$name: an empty form cannot be submitted', (tester) async {
      await pumpForm(tester, type, category);
      expect((await submitButton(tester)).onPressed, isNull);
    });
  }

  testWidgets('Find a Mate needs a photo even when every other field is filled', (tester) async {
    final photo = File('${Directory.systemTemp.path}/form-validation.jpg')..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    await pumpForm(tester, PostType.mating);

    await tester.enterText(find.widgetWithText(TextField, 'e.g. Rex'), 'Duke');
    await tester.tap(find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, 'e.g. German Shepherd'), 'Golden Retriever');
    await tester.enterText(find.widgetWithText(TextField, 'e.g. 2 years'), '٣ سنوات'); // Arabic-Indic digits
    await tester.tap(find.text('Male').first);
    await tester.pump();
    await tester.ensureVisible(find.text('Search and select a city'));
    await tester.tap(find.text('Search and select a city'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Qasr Al-Nile').last);
    await tester.pumpAndSettle();
    expect((await submitButton(tester)).onPressed, isNull, reason: 'no photo yet');

    await tester.drag(find.byType(ListView).first, const Offset(0, 8000));
    await tester.pump();
    await tester.tap(find.text('Add pet photos'));
    await tester.pumpAndSettle();
    expect((await submitButton(tester)).onPressed, isNotNull);
  });
}
