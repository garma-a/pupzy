import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/screens/post_form_screen.dart';

import 'support.dart';

/// Opens + → Find a Mate and fills every required field through the real
/// form (photo from [picker], Arabic age, city picker). Returns the submit
/// button, already scrolled into view and enabled.
Future<Finder> openAndFillMatingForm(
  WidgetTester tester, {
  required FakeImagePicker picker,
  required String breed,
  Future<void> Function(WidgetTester, String)? shoot,
}) async {
    await tester.tap(find.byIcon(Icons.add).last);
    await pumpUntil(tester, find.text('Find a Mate'));
    await tester.tap(find.text('Find a Mate'));
    await pumpUntil(tester, find.text('Add pet photos'), reason: 'Find a Mate form did not open');
    if (shoot != null) await shoot(tester, 'mate-02-empty-form');
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
    expect(picker.picks, greaterThan(0));
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
    if (shoot != null) await shoot(tester, 'mate-03-filled-form');
    expect(tester.widget<ElevatedButton>(submit).onPressed, isNotNull, reason: 'every required field is filled, including the Arabic age');
  return submit;
}
