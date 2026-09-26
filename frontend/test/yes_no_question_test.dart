import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/widgets/yes_no_question.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<List<bool>> pump(
    WidgetTester tester, {
    bool? value = false,
    LangProvider? lang,
    double textScale = 1,
    String? helper,
  }) async {
    final answers = <bool>[];
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      safetyTestApp(
        graphql: FakeSafetyGraphQL(),
        events: SafetyEvents(),
        lang: lang,
        child: MediaQuery(
          data: MediaQueryData(size: const Size(360, 800), textScaler: TextScaler.linear(textScale)),
          child: StatefulBuilder(
            builder: (context, setState) => YesNoQuestion(
              question: 'Is it vaccinated?',
              helper: helper,
              value: value,
              onChanged: (v) => setState(() {
                answers.add(v);
                value = v;
              }),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return answers;
  }

  testWidgets('both answers are written on the control', (tester) async {
    await pump(tester);
    expect(find.text('Is it vaccinated?'), findsOneWidget);
    expect(find.text('Yes'), findsOneWidget);
    expect(find.text('No'), findsOneWidget);
  });

  testWidgets('tapping an answer selects it; tapping it again changes nothing', (tester) async {
    final answers = await pump(tester);

    await tester.tap(find.text('Yes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Yes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('No'));
    await tester.pumpAndSettle();

    expect(answers, [true, false]);
  });

  testWidgets('the chosen answer is marked with a tick, not only colour', (tester) async {
    await pump(tester, value: true);
    final tick = find.byIcon(Icons.check);
    expect(tick, findsOneWidget);
    expect(find.ancestor(of: tick, matching: find.byType(Row)).first, isNotNull);
    expect(
      tester.getCenter(tick).dx,
      lessThan(tester.getCenter(find.text('Yes')).dx),
      reason: 'the tick sits inside the Yes button',
    );
  });

  testWidgets('screen readers hear which answer is selected', (tester) async {
    final handle = tester.ensureSemantics();
    await pump(tester, value: false);

    expect(
      tester.getSemantics(find.text('No')),
      matchesSemantics(
        label: 'No',
        isButton: true,
        hasSelectedState: true,
        isSelected: true,
        isInMutuallyExclusiveGroup: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
      ),
    );
    expect(
      tester.getSemantics(find.text('Yes')),
      matchesSemantics(
        label: 'Yes',
        isButton: true,
        hasSelectedState: true,
        isSelected: false,
        isInMutuallyExclusiveGroup: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
      ),
    );
    handle.dispose();
  });

  testWidgets('answers are in Arabic when the app is', (tester) async {
    final lang = LangProvider();
    await lang.setLang(Lang.ar);
    await pump(tester, lang: lang);
    expect(find.text('نعم'), findsOneWidget);
    expect(find.text('لا'), findsOneWidget);
  });

  testWidgets('short questions keep the answers on the same line', (tester) async {
    await pump(tester);
    expect(
      (tester.getCenter(find.text('Yes')).dy - tester.getCenter(find.text('Is it vaccinated?')).dy).abs(),
      lessThan(4),
    );
  });

  testWidgets('at large text sizes the answers move under the question', (tester) async {
    await pump(tester, textScale: 1.6, helper: 'Any vaccine in the last year');
    expect(
      tester.getTopLeft(find.text('Yes')).dy,
      greaterThan(tester.getBottomLeft(find.text('Is it vaccinated?')).dy),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('an unanswered question shows neither answer as chosen', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await pump(tester, value: null);

    expect(find.byIcon(Icons.check), findsNothing);
    expect(
      tester.getSemantics(find.text('Yes')),
      matchesSemantics(
        label: 'Yes',
        isButton: true,
        hasSelectedState: true,
        isSelected: false,
        isInMutuallyExclusiveGroup: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
      ),
    );
    expect(
      tester.getSemantics(find.text('No')),
      matchesSemantics(
        label: 'No',
        isButton: true,
        hasSelectedState: true,
        isSelected: false,
        isInMutuallyExclusiveGroup: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
      ),
    );
    expect(find.bySemanticsLabel('Is it vaccinated?'), findsWidgets);

    await tester.tap(find.text('No'));
    await tester.pumpAndSettle();
    expect(answers, [false], reason: 'either answer can be the first one');
    handle.dispose();
  });
}
