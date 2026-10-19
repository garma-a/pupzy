/// Parses the Terms of Service and Privacy Policy bundled under
/// assets/legal/ (written by legal/export_app_docs.py) into blocks the
/// in-app reader lays out.
///
/// It reads the same Markdown subset as the website build
/// (legal/build_site.py): a "# " title, "## " sections and "### "
/// subsections, paragraphs (a line ending in two spaces is a line break),
/// "- " and "1. " lists nested by two-space indents, "---" rules, and
/// **bold**, `code` and [text](url) inline. Unlike the website build, inline
/// formatting is applied after a paragraph's lines are joined, so bold text
/// that wraps onto a second source line still renders as bold.
library;

sealed class LegalBlock {
  const LegalBlock();
}

/// A "## " section (level 2, listed in the contents) or "### " subsection.
class LegalHeading extends LegalBlock {
  final int level;
  final String text;

  /// Index into [LegalDocument.sections] for level 2, otherwise null.
  final int? sectionIndex;
  const LegalHeading(this.level, this.text, this.sectionIndex);
}

class LegalParagraph extends LegalBlock {
  final List<LegalRun> runs;
  const LegalParagraph(this.runs);
}

class LegalList extends LegalBlock {
  final bool ordered;
  final List<LegalListItem> items;
  const LegalList(this.ordered, this.items);
}

class LegalListItem {
  final List<LegalRun> runs;
  final LegalList? children;
  const LegalListItem(this.runs, this.children);
}

class LegalRule extends LegalBlock {
  const LegalRule();
}

/// A stretch of inline text. [url] is set for links, including bare web
/// addresses (opened in the browser) and email addresses (mailto:).
class LegalRun {
  final String text;
  final bool bold;
  final bool code;
  final String? url;
  const LegalRun(this.text, {this.bold = false, this.code = false, this.url});
}

class LegalDocument {
  final String title;

  /// The version date at the top of the document (e.g. 2026-09-27), which
  /// the backend's TERMS_VERSION names when users accept it.
  final String? version;
  final List<LegalBlock> blocks;

  /// The "## " section titles, in order, for the contents list.
  final List<String> sections;
  const LegalDocument(this.title, this.version, this.blocks, this.sections);
}

final _listMarker = RegExp(r'^(-|\d+\.)\s');

LegalDocument parseLegalMarkdown(String source) {
  final text = source.replaceAll('\r\n', '\n').replaceAll(RegExp(r'<!--[\s\S]*?-->'), '');
  final queue = text.trim().split(RegExp(r'\n\s*\n'));
  var title = '';
  final blocks = <LegalBlock>[];
  final sections = <String>[];

  for (var i = 0; i < queue.length; i++) {
    final lines = queue[i].split('\n');
    final first = lines.first;
    final rest = lines.skip(1).join('\n').trim();
    if (first.startsWith('# ')) {
      title = first.substring(2).trim();
      if (rest.isNotEmpty) queue.insert(i + 1, rest);
      continue;
    }
    if (first.startsWith('## ') || first.startsWith('### ')) {
      final level = first.startsWith('## ') ? 2 : 3;
      final heading = first.substring(level + 1).trim();
      int? index;
      if (level == 2) {
        index = sections.length;
        sections.add(heading);
      }
      blocks.add(LegalHeading(level, heading, index));
      if (rest.isNotEmpty) blocks.add(_fragment(rest));
      continue;
    }
    if (queue[i].trim() == '---') {
      blocks.add(const LegalRule());
      continue;
    }
    blocks.add(_fragment(queue[i]));
  }

  final version = blocks
      .whereType<LegalParagraph>()
      .take(1)
      .map((p) => RegExp(r'\d{4}-\d{2}-\d{2}').firstMatch(p.runs.map((r) => r.text).join())?.group(0))
      .firstOrNull;
  return LegalDocument(title, version, blocks, sections);
}

LegalBlock _fragment(String block) {
  final lines = block.split('\n');
  if (_listMarker.hasMatch(lines.first)) return _list(lines);
  final buffer = StringBuffer();
  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];
    buffer.write(line.trim());
    if (i < lines.length - 1) buffer.write(line.endsWith('  ') ? '\n' : ' ');
  }
  return LegalParagraph(parseLegalInline(buffer.toString()));
}

LegalList _list(List<String> lines) {
  final ordered = RegExp(r'^\d+\.\s').hasMatch(lines.first.trimLeft());
  final items = <List<String>>[];
  for (final line in lines) {
    if (_listMarker.hasMatch(line)) {
      items.add([line.replaceFirst(RegExp(r'^(-|\d+\.)\s+'), '')]);
    } else if (items.isNotEmpty) {
      items.last.add(line.startsWith('  ') ? line.substring(2) : line.trim());
    }
  }
  return LegalList(ordered, [
    for (final item in items) _item(item),
  ]);
}

LegalListItem _item(List<String> parts) {
  final text = <String>[];
  final child = <String>[];
  for (final part in parts) {
    if (_listMarker.hasMatch(part) || child.isNotEmpty) {
      child.add(part);
    } else {
      text.add(part.trim());
    }
  }
  return LegalListItem(parseLegalInline(text.join(' ')), child.isEmpty ? null : _list(child));
}

final _inline = RegExp(
  r'\*\*(.+?)\*\*' // bold
  r'|`([^`]+)`' // code
  r'|\[([^\]]+)\]\(([^)\s]+)\)' // [text](url)
  r'|(https?://[^\s<>"]+)' // bare web address
  r'|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)', // email address
  dotAll: true,
);

/// Splits inline Markdown into runs. Bold may contain links and addresses.
List<LegalRun> parseLegalInline(String text, {bool bold = false}) {
  final runs = <LegalRun>[];
  var at = 0;
  for (final m in _inline.allMatches(text)) {
    if (m.start > at) runs.add(LegalRun(text.substring(at, m.start), bold: bold));
    if (m.group(1) != null) {
      runs.addAll(parseLegalInline(m.group(1)!, bold: true));
    } else if (m.group(2) != null) {
      runs.add(LegalRun(m.group(2)!, bold: bold, code: true));
    } else if (m.group(3) != null) {
      runs.add(LegalRun(m.group(3)!, bold: bold, url: m.group(4)));
    } else if (m.group(5) != null) {
      // A sentence's closing punctuation is not part of the address.
      final raw = m.group(5)!;
      final url = raw.replaceFirst(RegExp(r'[.,;:)]+$'), '');
      runs.add(LegalRun(url, bold: bold, url: url));
      if (url.length < raw.length) runs.add(LegalRun(raw.substring(url.length), bold: bold));
    } else {
      final email = m.group(6)!.replaceFirst(RegExp(r'\.+$'), '');
      runs.add(LegalRun(email, bold: bold, url: 'mailto:$email'));
      if (email.length < m.group(6)!.length) runs.add(LegalRun(m.group(6)!.substring(email.length), bold: bold));
    }
    at = m.end;
  }
  if (at < text.length) runs.add(LegalRun(text.substring(at), bold: bold));
  return runs;
}
