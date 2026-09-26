import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/utils/post_status_labels.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<String Function(String, {String? postType})> labels(WidgetTester tester, {Lang lang = Lang.en}) async {
    final provider = LangProvider();
    await provider.setLang(lang);
    late BuildContext captured;
    await tester.pumpWidget(safetyTestApp(
      graphql: FakeSafetyGraphQL(),
      events: SafetyEvents(),
      lang: provider,
      child: Builder(builder: (context) {
        captured = context;
        return const SizedBox();
      }),
    ));
    return (status, {postType}) => postOutcomeLabel(captured, status, postType: postType);
  }

  testWidgets('a resolved RESCUE reads Rescued; other resolved posts read Resolved', (tester) async {
    final label = await labels(tester);
    expect(label('RESOLVED', postType: 'RESCUE'), 'Rescued');
    expect(label('RESOLVED', postType: 'LOST'), 'Resolved');
    expect(label('RESOLVED', postType: 'MATING'), 'Resolved');
  });

  testWidgets('Animal deceased has its own label and is never Rescued', (tester) async {
    final label = await labels(tester);
    expect(label('ANIMAL_DECEASED', postType: 'RESCUE'), 'Animal deceased');
  });

  testWidgets('an unknown status reads Closed, never the raw API value', (tester) async {
    final label = await labels(tester);
    expect(label('SOMETHING_NEW', postType: 'RESCUE'), 'Closed');
  });

  testWidgets('Arabic labels', (tester) async {
    final label = await labels(tester, lang: Lang.ar);
    expect(label('ANIMAL_DECEASED', postType: 'RESCUE'), 'وفاة الحيوان');
    expect(label('RESOLVED', postType: 'RESCUE'), 'تم الإنقاذ');
    expect(label('SOMETHING_NEW'), 'مغلق');
  });
}
