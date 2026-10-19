import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';
import '../utils/legal_markdown.dart';

/// The two legal documents the app carries, bundled under assets/legal/ by
/// legal/export_app_docs.py from the same sources as https://pupzy.net.
enum LegalDocumentKind {
  terms('terms', 'https://pupzy.net/terms/'),
  privacy('privacy', 'https://pupzy.net/privacy/');

  final String asset;
  final String websiteUrl;
  const LegalDocumentKind(this.asset, this.websiteUrl);

  String title(BuildContext context) => switch (this) {
        LegalDocumentKind.terms => t(context, 'Terms of Service', 'شروط الاستخدام'),
        LegalDocumentKind.privacy => t(context, 'Privacy Policy', 'سياسة الخصوصية'),
      };
}

Future<void> openLegalDocument(
  BuildContext context,
  LegalDocumentKind kind, {
  String? publishedVersion,
  String? websiteUrl,
}) =>
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => LegalDocumentScreen(kind: kind, publishedVersion: publishedVersion, websiteUrl: websiteUrl),
    ));

/// Reads the Terms of Service or Privacy Policy inside the app, in the
/// app's language: a contents list that jumps to each section, selectable
/// text, and links that open in the browser or mail app.
///
/// [publishedVersion] is the version the backend currently asks users to
/// accept. When it differs from the bundled copy (a newer version was
/// published after this build), the screen says so and offers the website,
/// which always has the current text.
class LegalDocumentScreen extends StatefulWidget {
  final LegalDocumentKind kind;
  final String? publishedVersion;
  final String? websiteUrl;

  const LegalDocumentScreen({super.key, required this.kind, this.publishedVersion, this.websiteUrl});

  @override
  State<LegalDocumentScreen> createState() => _LegalDocumentScreenState();
}

class _LegalDocumentScreenState extends State<LegalDocumentScreen> {
  LegalDocument? _document;
  Lang? _loadedLang;
  bool _failed = false;
  List<GlobalKey> _sectionKeys = const [];
  final List<TapGestureRecognizer> _recognizers = [];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reloads in the other language when the user switches it.
    final lang = Provider.of<LangProvider>(context).lang;
    if (lang != _loadedLang) {
      _loadedLang = lang;
      _load(lang);
    }
  }

  Future<void> _load(Lang lang) async {
    final code = lang == Lang.ar ? 'ar' : 'en';
    try {
      // Opened rarely, so not kept in the asset bundle's cache.
      final source = await DefaultAssetBundle.of(context).loadString('assets/legal/${widget.kind.asset}.$code.md', cache: false);
      if (!mounted || lang != _loadedLang) return;
      final document = parseLegalMarkdown(source);
      setState(() {
        _document = document;
        _failed = false;
        _sectionKeys = List.generate(document.sections.length, (_) => GlobalKey());
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  void dispose() {
    for (final r in _recognizers) {
      r.dispose();
    }
    super.dispose();
  }

  String get _websiteUrl {
    final base = widget.websiteUrl ?? widget.kind.websiteUrl;
    final uri = Uri.parse(base);
    return uri.replace(queryParameters: {...uri.queryParameters, 'lang': _loadedLang == Lang.ar ? 'ar' : 'en'}).toString();
  }

  Future<void> _open(String url) async {
    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(t(context, 'Could not open the link.', 'تعذر فتح الرابط.'))),
      );
    }
  }

  void _jumpTo(int section) {
    final target = _sectionKeys[section].currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 300), curve: Curves.easeOutCubic);
  }

  @override
  Widget build(BuildContext context) {
    // Rebuilding the spans each build replaces their recognizers.
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();
    final document = _document;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(widget.kind.title(context), style: Theme.of(context).textTheme.headlineMedium),
        actions: [
          IconButton(
            tooltip: t(context, 'Open on the website', 'فتح على الموقع'),
            icon: const Icon(Icons.open_in_new),
            onPressed: () => _open(_websiteUrl),
          ),
        ],
      ),
      body: _failed
          ? _message(t(context, 'Could not open this document.', 'تعذر فتح هذا المستند.'))
          : document == null
              ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
              : SelectionArea(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xxl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(document.title, style: Theme.of(context).textTheme.headlineSmall),
                        if (_isOutdated(document)) ...[
                          const SizedBox(height: AppSpacing.md),
                          _newerVersionNotice(),
                        ],
                        const SizedBox(height: AppSpacing.md),
                        for (final block in document.blocks.take(1)) _block(block),
                        if (document.sections.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.md),
                          _contents(document),
                        ],
                        for (final block in document.blocks.skip(1)) _block(block),
                      ],
                    ),
                  ),
                ),
    );
  }

  bool _isOutdated(LegalDocument document) {
    final published = widget.publishedVersion;
    return published != null && document.version != null && published != document.version;
  }

  Widget _message(String text) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: AppSpacing.md),
              OutlinedButton(onPressed: () => _open(_websiteUrl), child: Text(t(context, 'Open on the website', 'فتح على الموقع'))),
            ],
          ),
        ),
      );

  Widget _newerVersionNotice() => Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              t(
                context,
                'A newer version (${widget.publishedVersion}) has been published. Read the current text on the website.',
                'تم نشر نسخة أحدث (${widget.publishedVersion}). اقرأ النص الحالي على الموقع.',
              ),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton.icon(
              onPressed: () => _open(_websiteUrl),
              icon: const Icon(Icons.open_in_new, size: 16),
              label: Text(t(context, 'Open on the website', 'فتح على الموقع')),
            ),
          ],
        ),
      );

  Widget _contents(LegalDocument document) => Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.card),
          side: const BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: ExpansionTile(
          title: Text(t(context, 'Contents', 'المحتويات'), style: Theme.of(context).textTheme.titleMedium),
          shape: const Border(),
          collapsedShape: const Border(),
          iconColor: AppColors.primary,
          collapsedIconColor: AppColors.textMuted,
          childrenPadding: const EdgeInsets.only(bottom: AppSpacing.sm),
          children: [
            for (final (i, section) in document.sections.indexed)
              InkWell(
                onTap: () => _jumpTo(i),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 10),
                  child: Row(
                    children: [
                      Expanded(child: Text(section, style: Theme.of(context).textTheme.bodyMedium)),
                      const Icon(Icons.chevron_right, size: 18, color: AppColors.textMuted),
                    ],
                  ),
                ),
              ),
          ],
        ),
      );

  Widget _block(LegalBlock block) {
    final textTheme = Theme.of(context).textTheme;
    final body = textTheme.bodyMedium?.copyWith(height: 1.55, color: AppColors.textPrimary);
    return switch (block) {
      LegalHeading(level: 2, :final text, :final sectionIndex) => Padding(
          key: sectionIndex == null ? null : _sectionKeys[sectionIndex],
          padding: const EdgeInsets.only(top: AppSpacing.xl, bottom: AppSpacing.sm),
          child: Text(text, style: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
        ),
      LegalHeading(:final text) => Padding(
          padding: const EdgeInsets.only(top: AppSpacing.md, bottom: AppSpacing.xs),
          child: Text(text, style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ),
      LegalParagraph(:final runs) => Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Text.rich(TextSpan(style: body, children: _spans(runs))),
        ),
      LegalList list => Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: _list(list, body),
        ),
      LegalRule() => const Padding(
          padding: EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Divider(height: 1),
        ),
    };
  }

  Widget _list(LegalList list, TextStyle? style) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, item) in list.items.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 24,
                    child: Text(list.ordered ? '${i + 1}.' : '•', style: style?.copyWith(color: AppColors.textSecondary)),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text.rich(TextSpan(style: style, children: _spans(item.runs))),
                        if (item.children != null) ...[
                          const SizedBox(height: AppSpacing.xs),
                          _list(item.children!, style),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      );

  List<InlineSpan> _spans(List<LegalRun> runs) => [
        for (final run in runs)
          TextSpan(
            text: run.text,
            style: TextStyle(
              fontWeight: run.bold ? FontWeight.w700 : null,
              fontFamily: run.code ? 'monospace' : null,
              color: run.url != null ? AppColors.primary : null,
              decoration: run.url != null ? TextDecoration.underline : null,
            ),
            recognizer: run.url == null ? null : _tapOpens(run.url!),
          ),
      ];

  TapGestureRecognizer _tapOpens(String url) {
    final recognizer = TapGestureRecognizer()..onTap = () => _open(url);
    _recognizers.add(recognizer);
    return recognizer;
  }
}
