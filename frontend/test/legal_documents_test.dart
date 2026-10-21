import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pupzy/localization/lang_provider.dart';
import 'package:pupzy/models/terms_info.dart';
import 'package:pupzy/screens/legal_document_screen.dart';
import 'package:pupzy/services/safety_events.dart';
import 'package:pupzy/services/terms_gate.dart';
import 'package:pupzy/utils/legal_markdown.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'safety_test_support.dart';

class _TermsGraphQL extends FakeSafetyGraphQL {
  TermsInfo terms = TermsInfo(
    currentVersion: '2026-09-27',
    termsUrl: 'https://pupzy.net/terms/',
    acceptedVersion: '2026-09-27',
    acceptedAt: DateTime.utc(2026, 10, 1),
    ageConfirmedAt: DateTime.utc(2026, 10, 1),
    acceptanceRequired: false,
  );

  @override
  Future<TermsInfo?> fetchTerms() async => terms;

  @override
  Future<(TermsInfo?, String?, String?)> acceptTerms(String version) async {
    acceptedVersions.add(version);
    terms = TermsInfo(
      currentVersion: version,
      termsUrl: terms.termsUrl,
      acceptedVersion: version,
      acceptedAt: terms.acceptedVersion == version ? terms.acceptedAt : DateTime.now(),
      ageConfirmedAt: DateTime.now(),
      acceptanceRequired: false,
    );
    return (terms, null, null);
  }
}

void main() {
  group('legal Markdown', () {
    test('bold that wraps onto the next source line stays bold', () {
      final doc = parseLegalMarkdown('# T\n\nYou must be at least **18\nyears old** to use it.');
      final runs = (doc.blocks.single as LegalParagraph).runs;
      expect(runs.where((r) => r.bold).map((r) => r.text), ['18 years old']);
      expect(runs.map((r) => r.text).join(), 'You must be at least 18 years old to use it.');
    });

    test('sections, subsections, rules, version and line breaks', () {
      final doc = parseLegalMarkdown(
        '# Title\n\n**Version:** 2026-09-27  \n**Last updated:** 27 September 2026\n\n---\n\n'
        '## 1. First\n\nText.\n\n### 1.1 Sub\n\nMore.\n\n## 2. Second\nInline paragraph.',
      );
      expect(doc.title, 'Title');
      expect(doc.version, '2026-09-27');
      expect(doc.sections, ['1. First', '2. Second']);
      final meta = (doc.blocks.first as LegalParagraph).runs.map((r) => r.text).join();
      expect(meta, 'Version: 2026-09-27\nLast updated: 27 September 2026');
      expect(doc.blocks.whereType<LegalRule>(), hasLength(1));
      expect(doc.blocks.whereType<LegalHeading>().map((h) => (h.level, h.sectionIndex)), [(2, 0), (3, null), (2, 1)]);
    });

    test('lists nest by two-space indents', () {
      final doc = parseLegalMarkdown('# T\n\n- one\n  continued\n- two\n  - two a\n  - two b\n- three');
      final list = doc.blocks.single as LegalList;
      expect(list.ordered, isFalse);
      expect(list.items.map((i) => i.runs.map((r) => r.text).join()), ['one continued', 'two', 'three']);
      expect(list.items[1].children!.items.map((i) => i.runs.single.text), ['two a', 'two b']);
    });

    test('links, web addresses and email addresses open, without trailing punctuation', () {
      final runs = parseLegalInline('See [our policy](https://pupzy.net/privacy/), https://pupzy.net/terms/. Mail pupzy.eg@gmail.com.');
      final links = runs.where((r) => r.url != null).map((r) => (r.text, r.url));
      expect(links, [
        ('our policy', 'https://pupzy.net/privacy/'),
        ('https://pupzy.net/terms/', 'https://pupzy.net/terms/'),
        ('pupzy.eg@gmail.com', 'mailto:pupzy.eg@gmail.com'),
      ]);
      expect(runs.map((r) => r.text).join(), 'See our policy, https://pupzy.net/terms/. Mail pupzy.eg@gmail.com.');
    });
  });

  group('bundled documents', () {
    for (final name in ['terms', 'privacy']) {
      test('$name exists in English and Arabic, filled in and the same version', () {
        final en = parseLegalMarkdown(File('assets/legal/$name.en.md').readAsStringSync());
        final ar = parseLegalMarkdown(File('assets/legal/$name.ar.md').readAsStringSync());
        for (final file in ['en', 'ar']) {
          final raw = File('assets/legal/$name.$file.md').readAsStringSync();
          expect(raw, isNot(contains('{{')), reason: 'run python legal/export_app_docs.py');
          expect(raw, isNot(contains('<!--')));
        }
        expect(en.version, isNotNull);
        expect(ar.version, en.version);
        expect(ar.sections, hasLength(en.sections.length));
        expect(en.sections, isNotEmpty);
      });
    }
  });

  group('in-app reader', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    Future<void> pumpReader(WidgetTester tester, LegalDocumentKind kind, {String? published, LangProvider? lang}) async {
      tester.view.physicalSize = const Size(1080, 2340);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(safetyTestApp(
        graphql: _TermsGraphQL(),
        events: SafetyEvents(),
        lang: lang,
        child: LegalDocumentScreen(kind: kind, publishedVersion: published),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('shows the Terms with a contents list that jumps to a section', (tester) async {
      await pumpReader(tester, LegalDocumentKind.terms);
      expect(find.text('Pupzy Terms of Service'), findsOneWidget);
      expect(find.text('1. About these Terms'), findsWidgets);
      expect(find.textContaining('A newer version'), findsNothing);

      await tester.tap(find.text('Contents'));
      await tester.pumpAndSettle();
      final contactInContents = find.text('22. Contact us').first;
      await tester.ensureVisible(contactInContents);
      await tester.pumpAndSettle();
      await tester.tap(contactInContents);
      await tester.pumpAndSettle();
      // The section heading itself is now on screen.
      final heading = find.text('22. Contact us').last;
      expect(tester.getRect(heading).top, inInclusiveRange(0, 2340 / 3));
    });

    testWidgets('shows the Privacy Policy', (tester) async {
      await pumpReader(tester, LegalDocumentKind.privacy);
      expect(find.text('Pupzy Privacy Policy'), findsOneWidget);
    });

    testWidgets('reads in Arabic when the app is in Arabic', (tester) async {
      SharedPreferences.setMockInitialValues({'lang': 'ar'});
      final lang = LangProvider();
      await pumpReader(tester, LegalDocumentKind.terms, lang: lang);
      expect(lang.lang, Lang.ar);
      expect(find.text('شروط الاستخدام'), findsOneWidget);
      expect(find.textContaining('شروط استخدام بابزي'), findsOneWidget);
    });

    testWidgets('points to the website when a newer version is published', (tester) async {
      await pumpReader(tester, LegalDocumentKind.terms, published: '2027-01-01');
      expect(find.textContaining('A newer version (2027-01-01)'), findsOneWidget);
    });
  });

  group('Terms & Privacy sheet', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    for (final (label, title) in [('Terms of Service', 'Pupzy Terms of Service'), ('Privacy Policy', 'Pupzy Privacy Policy')]) {
      testWidgets('opens the $label inside the app', (tester) async {
        await tester.pumpWidget(safetyTestApp(
          graphql: _TermsGraphQL(),
          events: SafetyEvents(),
          child: Builder(builder: (context) => TextButton(onPressed: () => showTermsInfoSheet(context), child: const Text('open'))),
        ));
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        expect(find.text('You accepted the current Terms'), findsOneWidget);

        await tester.tap(find.text(label));
        await tester.pumpAndSettle();
        expect(find.byType(LegalDocumentScreen), findsOneWidget);
        expect(find.text(title), findsOneWidget);
      });
    }

    testWidgets('asks an account that accepted before age confirmation existed to confirm it is 18 or older', (tester) async {
      final graphql = _TermsGraphQL()
        ..terms = TermsInfo(
          currentVersion: '2026-09-27',
          termsUrl: 'https://pupzy.net/terms/',
          acceptedVersion: '2026-09-27',
          acceptedAt: DateTime.utc(2026, 10, 1),
          acceptanceRequired: true,
        );
      await tester.pumpWidget(safetyTestApp(
        graphql: graphql,
        events: SafetyEvents(),
        child: Builder(builder: (context) => TextButton(onPressed: () => showTermsInfoSheet(context), child: const Text('open'))),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Please confirm you are 18 or older'), findsOneWidget);
      expect(find.text('You accepted the current Terms'), findsNothing);

      final accept = find.widgetWithText(ElevatedButton, 'Accept current Terms');
      expect(tester.widget<ElevatedButton>(accept).onPressed, isNull);
      await tester.tap(find.text('I confirm I am 18 years of age or older'));
      await tester.pump();
      await tester.tap(accept);
      await tester.pumpAndSettle();

      expect(graphql.acceptedVersions, ['2026-09-27']);
      expect(find.text('You accepted the current Terms'), findsOneWidget);
      expect(find.text('I confirm I am 18 years of age or older'), findsNothing);
    });

    testWidgets('the acceptance prompt links both documents', (tester) async {
      await tester.pumpWidget(safetyTestApp(
        graphql: _TermsGraphQL(),
        events: SafetyEvents(),
        child: Builder(
          builder: (context) => TextButton(onPressed: () => presentTermsAcceptance(context, version: '2026-09-27'), child: const Text('open')),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Terms of Service'), findsOneWidget);
      expect(find.text('Privacy Policy'), findsOneWidget);

      await tester.tap(find.text('Privacy Policy'));
      await tester.pumpAndSettle();
      expect(find.text('Pupzy Privacy Policy'), findsOneWidget);
    });
  });
}
