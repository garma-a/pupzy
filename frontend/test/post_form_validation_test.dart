import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:pupzy/models/post.dart';
import 'package:pupzy/screens/post_form_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/theme/app_theme.dart';
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

const _tall = Size(1000, 1800);

/// A phone screen, so the form scrolls.
const _phone = Size(400, 800);

void main() {
  var screen = _tall;

  Future<void> pumpForm(WidgetTester tester, PostType type, [String? category, Size size = _tall]) async {
    screen = size;
    tester.view.physicalSize = size * 2;
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(safetyTestApp(
      graphql: FormGraphQL(),
      events: SafetyEvents(),
      child: PostFormScreen(type: type, initialCategory: category),
    ));
    await tester.pumpAndSettle();
  }

  Finder postButton() => find.byType(ElevatedButton).last;

  /// The Post button is always tappable; it is drawn at full colour only when
  /// every required field is filled in.
  bool ready(WidgetTester tester) {
    final color = tester.widget<ElevatedButton>(postButton()).style!.backgroundColor!.resolve({})!;
    return color.a == 1.0;
  }

  Future<void> tapPost(WidgetTester tester) async {
    await tester.ensureVisible(postButton());
    await tester.pumpAndSettle();
    await tester.tap(postButton());
    await tester.pumpAndSettle();
  }

  Future<void> tapVisible(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  bool onScreen(WidgetTester tester, Finder finder) {
    final rect = tester.getRect(finder);
    return rect.top >= 0 && rect.bottom <= screen.height;
  }

  for (final (name, type, category, missing) in [
    ('Rescue Alert', PostType.rescue, 'URGENT', 6),
    ('Lost Pet', PostType.rescue, 'LOST', 7),
    ('Found a Pet', PostType.rescue, 'FOUND', 6),
    ('Adoption', PostType.adoption, null, 4),
    ('Product', PostType.product, null, 7),
    ('Find a Mate', PostType.mating, null, 7),
  ]) {
    testWidgets('$name: Post on an empty form marks every missing field and scrolls to the first', (tester) async {
      await pumpForm(tester, type, category, _phone);
      expect(ready(tester), isFalse);
      expect(find.byIcon(Icons.error_outline), findsNothing, reason: 'nothing is red before Post is tapped');
      final form = tester.state<ScrollableState>(
        find.descendant(of: find.byType(PostFormScreen), matching: find.byType(Scrollable)).first,
      );

      await tester.ensureVisible(postButton());
      await tester.pumpAndSettle();
      final atButton = form.position.pixels;
      expect(atButton, greaterThan(0), reason: 'the form is taller than the screen');
      await tester.tap(postButton());
      await tester.pumpAndSettle();

      expect(form.position.pixels, lessThan(atButton), reason: 'scrolled back up');
      expect(find.byIcon(Icons.error_outline), findsNWidgets(missing));
      expect(find.text('Fill in the $missing fields marked in red above'), findsOneWidget);
      expect(find.text('Add at least one photo'), findsOneWidget);
      expect(onScreen(tester, find.text('Add at least one photo')), isTrue, reason: 'scrolled up to the photo box');
    });
  }

  testWidgets('a missing field label turns red, and back once it is filled in', (tester) async {
    await pumpForm(tester, PostType.adoption);
    Color? labelColor(String text) => tester.widget<Text>(find.text(text)).style?.color;

    expect(labelColor('Gender'), isNot(AppColors.critical));
    await tapPost(tester);
    expect(labelColor('Gender'), AppColors.critical);
    expect(find.text('Choose the gender'), findsOneWidget);

    await tapVisible(tester, find.text('Female'));
    expect(labelColor('Gender'), isNot(AppColors.critical));
    expect(find.text('Choose the gender'), findsNothing);
    expect(find.text('Fill in the 3 fields marked in red above'), findsOneWidget);
  });

  for (final (name, type, category) in [
    ('Rescue Alert', PostType.rescue, 'URGENT'),
    ('Lost Pet', PostType.rescue, 'LOST'),
    ('Found a Pet', PostType.rescue, 'FOUND'),
    ('Adoption', PostType.adoption, null),
    ('Find a Mate', PostType.mating, null),
  ]) {
    testWidgets('$name: species is Dog, Cat, Bird or Other', (tester) async {
      await pumpForm(tester, type, category);
      final list = find.descendant(of: find.byType(PostFormScreen), matching: find.byType(Scrollable)).first;
      await tester.scrollUntilVisible(find.text('Bird'), 300, scrollable: list);

      final row = find.ancestor(of: find.text('Bird'), matching: find.byType(Wrap)).first;
      final options = tester
          .widgetList<Text>(find.descendant(of: row, matching: find.byType(Text)))
          .map((text) => text.data)
          .toList();
      expect(options, ['Dog', 'Cat', 'Bird', 'Other']);
    });
  }

  testWidgets('Product: the category is Care, Food, Accessories or Other', (tester) async {
    await pumpForm(tester, PostType.product);
    final list = find.descendant(of: find.byType(PostFormScreen), matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(find.text('Accessories'), 300, scrollable: list);

    final row = find.ancestor(of: find.text('Accessories'), matching: find.byType(Wrap)).first;
    final options = tester
        .widgetList<Text>(find.descendant(of: row, matching: find.byType(Text)))
        .map((text) => text.data)
        .toList();
    expect(options, ['Care', 'Food', 'Accessories', 'Other']);
    for (final retired in ['Transport', 'Grooming', 'Medical Supplies']) {
      expect(find.text(retired), findsNothing);
    }
  });

  testWidgets('Product: a giveaway needs no price', (tester) async {
    await pumpForm(tester, PostType.product);
    await tapPost(tester);
    expect(find.text('Enter the price, or answer Yes if it is free'), findsOneWidget);

    final free = find.byWidgetPredicate((w) => w is YesNoQuestion && w.question.contains('free'));
    await tapVisible(tester, find.descendant(of: free, matching: find.text('Yes')));
    expect(find.text('Enter the price, or answer Yes if it is free'), findsNothing);
  });

  testWidgets('Find a Mate needs a photo even when every other field is filled', (tester) async {
    final photo = File('${Directory.systemTemp.path}/form-validation.jpg')..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    await pumpForm(tester, PostType.mating);

    await tester.enterText(find.widgetWithText(TextField, 'e.g. Rex'), 'Duke');
    await tapVisible(tester, find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, 'e.g. German Shepherd'), 'Golden Retriever');
    await tester.enterText(find.widgetWithText(TextField, 'e.g. 2 years'), '٣ سنوات'); // Arabic-Indic digits
    await tapVisible(tester, find.text('Male').first);
    await tapVisible(tester, find.text('Search and select a city'));
    await tester.tap(find.text('Qasr Al-Nile').last);
    await tester.pumpAndSettle();
    expect(ready(tester), isFalse, reason: 'no photo yet');

    await tapPost(tester);
    expect(find.byIcon(Icons.error_outline), findsOneWidget, reason: 'only the photo is missing');
    expect(find.text('Fill in the field marked in red above'), findsOneWidget);
    expect(onScreen(tester, find.text('Add at least one photo')), isTrue);

    await tapVisible(tester, find.text('Add pet photos'));
    expect(find.byIcon(Icons.error_outline), findsNothing);
    expect(find.text('Fill in the field marked in red above'), findsNothing);
    expect(ready(tester), isTrue);
  });

  testWidgets('Rescue Alert: the situation questions start unanswered and must all be answered', (tester) async {
    final photo = File('${Directory.systemTemp.path}/rescue-validation.jpg')..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    await pumpForm(tester, PostType.rescue, 'URGENT');

    await tapVisible(tester, find.text('Add photos of the animal'));
    await tapVisible(tester, find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, "Describe the animal's visible condition..."), 'Limping on its back leg');
    await tester.enterText(find.widgetWithText(TextField, 'e.g. Maadi area'), 'Maadi');
    await tapVisible(tester, find.text("On-site — I'm with the animal"));

    final questions = find.byType(YesNoQuestion);
    expect(questions, findsNWidgets(4));
    for (final q in tester.widgetList<YesNoQuestion>(questions)) {
      expect(q.value, isNull, reason: '"${q.question}" must not be pre-answered');
    }
    expect(find.byIcon(Icons.check), findsNothing, reason: 'no answer looks chosen');

    expect(ready(tester), isFalse, reason: 'situation not answered');
    expect(find.text('Answer all 4 Situation check questions to post'), findsOneWidget);

    await tapPost(tester);
    expect(find.text('Answer every question below'), findsOneWidget);
    expect(onScreen(tester, find.text('Answer every question below')), isTrue);
    for (final q in tester.widgetList<YesNoQuestion>(questions)) {
      expect(q.flagUnanswered, isTrue, reason: 'unanswered questions are red');
    }

    // Answering three of four is still not enough.
    for (var i = 0; i < 3; i++) {
      await tapVisible(tester, find.descendant(of: questions.at(i), matching: find.text('No')));
    }
    expect(ready(tester), isFalse, reason: 'one question left');
    expect(find.text('Answer every question below'), findsOneWidget);

    await tapVisible(tester, find.descendant(of: questions.at(3), matching: find.text('Yes')));
    expect(ready(tester), isTrue);
    expect(find.text('Answer every question below'), findsNothing);
    expect(find.text('Complete all required fields to post'), findsOneWidget);
  });

  testWidgets('Lost Pet: the situation questions start unanswered and must all be answered', (tester) async {
    final photo = File('${Directory.systemTemp.path}/lost-validation.jpg')..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    ImagePickerPlatform.instance = OnePhotoPicker(photo.path);
    await pumpForm(tester, PostType.rescue, 'LOST');

    await tapVisible(tester, find.text('Add photos of your pet'));
    await tapVisible(tester, find.text('Dog').first);
    await tester.enterText(find.widgetWithText(TextField, 'e.g. Max'), 'Luna');
    await tapVisible(tester, find.text('Select date'));
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
    expect(ready(tester), isFalse, reason: 'situation not answered');
    expect(find.text('Answer all 3 Situation check questions to post'), findsOneWidget);

    await tapPost(tester);
    expect(find.text('Answer every question below'), findsOneWidget);

    for (var i = 0; i < 2; i++) {
      await tapVisible(tester, find.descendant(of: questions.at(i), matching: find.text('No')));
    }
    expect(ready(tester), isFalse, reason: 'one question left');

    await tapVisible(tester, find.descendant(of: questions.at(2), matching: find.text('Yes')));
    expect(ready(tester), isTrue);
    expect(find.text('Answer every question below'), findsNothing);
    expect(find.text('Complete all required fields to post'), findsOneWidget);
  });
}
