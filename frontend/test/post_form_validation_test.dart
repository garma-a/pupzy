import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/models/post.dart';
import 'package:pupzy/screens/post_form_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/yes_no_question.dart';

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

  testWidgets('Rescue Alert: the situation questions start unanswered and must all be answered', (tester) async {
    final photo = File('${Directory.systemTemp.path}/rescue-validation.jpg')..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    await pumpForm(tester, PostType.rescue, 'URGENT');

    Future<void> tapVisible(Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    await tapVisible(find.text('Add photos of the animal'));
    await tapVisible(find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, "Describe the animal's visible condition..."), 'Limping on its back leg');
    await tester.enterText(find.widgetWithText(TextField, 'e.g. Maadi area'), 'Maadi');
    await tapVisible(find.text("On-site — I'm with the animal"));

    final questions = find.byType(YesNoQuestion);
    expect(questions, findsNWidgets(4));
    for (final q in tester.widgetList<YesNoQuestion>(questions)) {
      expect(q.value, isNull, reason: '"${q.question}" must not be pre-answered');
    }
    expect(find.byIcon(Icons.check), findsNothing, reason: 'no answer looks chosen');

    expect((await submitButton(tester)).onPressed, isNull, reason: 'situation not answered');
    expect(find.text('Answer all 4 Situation check questions to post'), findsOneWidget);

    // Answering three of four is still not enough.
    for (var i = 0; i < 3; i++) {
      await tapVisible(find.descendant(of: questions.at(i), matching: find.text('No')));
    }
    expect((await submitButton(tester)).onPressed, isNull, reason: 'one question left');

    await tapVisible(find.descendant(of: questions.at(3), matching: find.text('Yes')));
    expect((await submitButton(tester)).onPressed, isNotNull);
    expect(find.text('Complete all required fields to post'), findsOneWidget);
  });

  testWidgets('Lost Pet: the situation questions start unanswered and must all be answered', (tester) async {
    final photo = File('${Directory.systemTemp.path}/lost-validation.jpg')..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    await pumpForm(tester, PostType.rescue, 'LOST');

    Future<void> tapVisible(Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    await tapVisible(find.text('Add photos of your pet'));
    await tapVisible(find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, 'e.g. Max'), 'Luna');
    await tapVisible(find.text('Select date'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'e.g. 7th Circle area'), 'Nasr City');
    await tester.enterText(
      find.widgetWithText(TextField, 'Describe when and how your pet went missing...'),
      'Slipped out of the gate last night',
    );
    await tester.pump();

    // The collar question is ordinary detail, not part of the situation
    // check: it keeps its default and is not required.
    final collar = find.byWidgetPredicate((w) => w is YesNoQuestion && w.question.contains('collar'));
    expect(tester.widget<YesNoQuestion>(collar).value, isFalse);
    final questions = find.byWidgetPredicate((w) => w is YesNoQuestion && !w.question.contains('collar'));
    expect(questions, findsNWidgets(3));
    for (final q in tester.widgetList<YesNoQuestion>(questions)) {
      expect(q.value, isNull, reason: '"${q.question}" must not be pre-answered');
    }
    expect((await submitButton(tester)).onPressed, isNull, reason: 'situation not answered');
    expect(find.text('Answer all 3 Situation check questions to post'), findsOneWidget);

    for (var i = 0; i < 2; i++) {
      await tapVisible(find.descendant(of: questions.at(i), matching: find.text('No')));
    }
    expect((await submitButton(tester)).onPressed, isNull, reason: 'one question left');

    await tapVisible(find.descendant(of: questions.at(2), matching: find.text('Yes')));
    expect((await submitButton(tester)).onPressed, isNotNull);
    expect(find.text('Complete all required fields to post'), findsOneWidget);
  });
}
