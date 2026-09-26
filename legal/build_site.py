"""Builds the public legal & support website from the Markdown sources.

    python legal/build_site.py

Reads the English and Arabic Markdown pages in this folder, fills in the
values from site.config.json, and writes a static site to legal/site/ that
can be uploaded as-is to any web host (every page is a folder with an
index.html, so the URLs are /terms/, /privacy/, ...).

Standard library only. Values missing from the config are highlighted on the
pages and listed when the build finishes, so an unfinished page is never
mistaken for a finished one.
"""

from __future__ import annotations

import datetime
import html
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'site'

# slug, source file stem, nav label (en, ar), one-line description (en, ar)
PAGES = [
    ('terms', 'terms-of-service', ('Terms of Service', 'شروط الاستخدام'),
     ('The rules for using Pupzy.', 'قواعد استخدام بابزي.')),
    ('privacy', 'privacy-policy', ('Privacy Policy', 'سياسة الخصوصية'),
     ('What data we collect and how we use it.', 'البيانات التي نجمعها وكيف نستخدمها.')),
    ('delete-account', 'delete-account', ('Delete your account', 'حذف الحساب'),
     ('How to delete your account and data.', 'كيفية حذف حسابك وبياناتك.')),
    ('support', 'support', ('Support', 'الدعم'),
     ('Contact us, report a problem, common questions.', 'تواصل معنا، أبلغ عن مشكلة، أسئلة شائعة.')),
    ('child-safety', 'child-safety', ('Child safety', 'سلامة الأطفال'),
     ('Our standards against child abuse and exploitation.', 'معاييرنا ضد إساءة معاملة الأطفال واستغلالهم.')),
]

URL_KEYS = {
    'terms_url': 'terms',
    'privacy_url': 'privacy',
    'delete_account_url': 'delete-account',
    'support_url': 'support',
    'child_safety_url': 'child-safety',
}

missing: set[str] = set()


# ─── Config ─────────────────────────────────────────────────────────────────

def load_config() -> dict:
    config = json.loads((HERE / 'site.config.json').read_text(encoding='utf-8'))
    base = config.get('site_base_url', '').rstrip('/')
    for key, slug in URL_KEYS.items():
        config[key] = f'{base}/{slug}/' if base else ''
    return config


def value(config: dict, key: str, lang: str) -> str:
    raw = config.get(key, '')
    if isinstance(raw, dict):
        raw = raw.get(lang) or raw.get('en') or ''
    return str(raw).strip()


def fill(fragment: str, config: dict, lang: str) -> str:
    """Replaces {{key}} tokens in rendered HTML. Inside attributes the raw
    value is used; in text a missing value becomes a visible highlight."""

    def in_attribute(match: re.Match) -> str:
        def sub(m: re.Match) -> str:
            v = value(config, m.group(1), lang)
            if not v:
                missing.add(m.group(1))
            return html.escape(v, quote=True) if v else f'TODO-{m.group(1)}'
        return match.group(1) + '="' + re.sub(r'\{\{(\w+)\}\}', sub, match.group(2)) + '"'

    fragment = re.sub(r'(href|src)="([^"]*)"', in_attribute, fragment)

    def in_text(m: re.Match) -> str:
        key = m.group(1)
        v = value(config, key, lang)
        if not v:
            missing.add(key)
            return f'<mark class="todo" title="Set {key} in site.config.json">[{key}]</mark>'
        if '@' in v and ' ' not in v:
            return f'<a href="mailto:{html.escape(v, quote=True)}">{html.escape(v)}</a>'
        if v.startswith(('http://', 'https://')):
            return f'<a href="{html.escape(v, quote=True)}">{html.escape(v)}</a>'
        return html.escape(v)

    return re.sub(r'\{\{(\w+)\}\}', in_text, fragment)


# ─── Markdown (the subset these documents use) ──────────────────────────────

def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', text)
    return text


def slugify(text: str, used: set[str]) -> str:
    base = re.sub(r'[^\w؀-ۿ]+', '-', text.lower()).strip('-') or 'section'
    slug, n = base, 2
    while slug in used:
        slug, n = f'{base}-{n}', n + 1
    used.add(slug)
    return slug


def render_list(lines: list[str]) -> str:
    """Renders "- " / "1. " items; lines indented two more spaces nest."""
    ordered = bool(re.match(r'\d+\.\s', lines[0].lstrip()))
    tag = 'ol' if ordered else 'ul'
    items: list[list[str]] = []
    for line in lines:
        if re.match(r'(-|\d+\.)\s', line):
            items.append([re.sub(r'^(-|\d+\.)\s+', '', line)])
        else:
            items[-1].append(line[2:] if line.startswith('  ') else line.strip())
    out = [f'<{tag}>']
    for item in items:
        text_lines, child = [], []
        for part in item:
            if re.match(r'(-|\d+\.)\s', part) or child:
                child.append(part)
            else:
                text_lines.append(part.strip())
        body = inline(' '.join(text_lines))
        if child:
            body += render_list(child)
        out.append(f'<li>{body}</li>')
    out.append(f'</{tag}>')
    return ''.join(out)


def markdown(source: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Returns (title, body html, [(anchor, h2 text)])."""
    source = re.sub(r'<!--[\s\S]*?-->', '', source.replace('\r\n', '\n'))
    blocks = re.split(r'\n\s*\n', source.strip())
    title, parts, toc, used = '', [], [], set()
    for block in blocks:
        lines = block.split('\n')
        first = lines[0]
        if first.startswith('# '):
            title = first[2:].strip()
            rest = '\n'.join(lines[1:]).strip()
            if rest:
                blocks.insert(blocks.index(block) + 1, rest)
            continue
        if first.startswith('## ') or first.startswith('### '):
            level = 2 if first.startswith('## ') else 3
            text = first[level + 1:].strip()
            anchor = slugify(text, used)
            if level == 2:
                toc.append((anchor, text))
            parts.append(f'<h{level} id="{anchor}">{inline(text)}</h{level}>')
            rest = '\n'.join(lines[1:]).strip()
            if rest:
                parts.append(markdown_fragment(rest))
            continue
        if block.strip() == '---':
            parts.append('<hr>')
            continue
        parts.append(markdown_fragment(block))
    return title, '\n'.join(parts), toc


def markdown_fragment(block: str) -> str:
    lines = block.split('\n')
    if re.match(r'(-|\d+\.)\s', lines[0]):
        return render_list(lines)
    rendered = []
    for i, line in enumerate(lines):
        hard_break = line.endswith('  ') and i < len(lines) - 1
        rendered.append(inline(line.strip()) + ('<br>' if hard_break else ''))
    text = ''
    for i, part in enumerate(rendered):
        text += part if part.endswith('<br>') or i == len(rendered) - 1 else part + ' '
    return f'<p>{text}</p>'


# ─── Page template ──────────────────────────────────────────────────────────

def nav(prefix: str, current: str, lang: str) -> str:
    links = []
    for slug, _stem, labels, _desc in PAGES:
        label = labels[0] if lang == 'en' else labels[1]
        attr = ' aria-current="page"' if slug == current else ''
        links.append(f'<a href="{prefix}{slug}/"{attr}>{html.escape(label)}</a>')
    return ''.join(links)


def page(prefix: str, current: str, titles: dict, articles: dict, config: dict) -> str:
    year = datetime.date.today().year
    sections = []
    for lang in ('en', 'ar'):
        direction = 'rtl' if lang == 'ar' else 'ltr'
        entity = fill('{{legal_entity_name}}', config, lang)
        footer_note = 'All rights reserved.' if lang == 'en' else 'جميع الحقوق محفوظة.'
        sections.append(f'''
    <div class="lang-block" lang="{lang}" dir="{direction}" data-lang="{lang}">
      <nav class="site-nav" aria-label="{'Pages' if lang == 'en' else 'الصفحات'}">{nav(prefix, current, lang)}</nav>
      <main>{articles[lang]}</main>
      <footer class="site-footer">© {year} {entity}. {footer_note}</footer>
    </div>''')
    return f'''<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(titles['en'])} · Pupzy</title>
  <meta name="description" content="{html.escape(titles['en'])} — {html.escape(titles['ar'])}">
  <link rel="stylesheet" href="{prefix}assets/site.css">
  <script src="{prefix}assets/site.js"></script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="{prefix}">Pupzy</a>
    <div class="lang-switch" role="group" aria-label="Language / اللغة">
      <button type="button" data-set-lang="en" lang="en">English</button>
      <button type="button" data-set-lang="ar" lang="ar">العربية</button>
    </div>
  </header>
  {''.join(sections)}
</body>
</html>
'''


def document_article(title: str, body: str, toc: list[tuple[str, str]], lang: str) -> str:
    toc_html = ''
    if len(toc) > 3:
        heading = 'Contents' if lang == 'en' else 'المحتويات'
        items = ''.join(f'<li><a href="#{a}">{inline(t)}</a></li>' for a, t in toc)
        # Headings carry their own numbers, so the list itself is unnumbered.
        toc_html = f'<details class="toc" open><summary>{heading}</summary><ul>{items}</ul></details>'
    # Anchors must be unique across the two language blocks on one page.
    body = re.sub(r'id="([^"]+)"', lambda m: f'id="{lang}-{m.group(1)}"', body)
    toc_html = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{lang}-{m.group(1)}"', toc_html)
    return f'<article><h1>{inline(title)}</h1>{toc_html}{body}</article>'


def build() -> int:
    config = load_config()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'assets').mkdir(parents=True)
    for asset in ('site.css', 'site.js'):
        shutil.copy(HERE / 'site_assets' / asset, OUT / 'assets' / asset)

    for slug, stem, _labels, _desc in PAGES:
        titles, articles = {}, {}
        for lang in ('en', 'ar'):
            title, body, toc = markdown((HERE / f'{stem}.{lang}.md').read_text(encoding='utf-8'))
            titles[lang] = title
            articles[lang] = fill(document_article(title, body, toc, lang), config, lang)
        (OUT / slug).mkdir()
        (OUT / slug / 'index.html').write_text(page('../', slug, titles, articles, config), encoding='utf-8')

    # Home: a short index of every page.
    articles = {}
    for lang, i in (('en', 0), ('ar', 1)):
        heading = 'Pupzy — legal &amp; support' if lang == 'en' else 'بابزي — الشروط والدعم'
        cards = ''.join(
            f'<a class="card" href="{slug}/"><strong>{html.escape(labels[i])}</strong><span>{html.escape(desc[i])}</span></a>'
            for slug, _stem, labels, desc in PAGES
        )
        articles[lang] = f'<article><h1>{heading}</h1><div class="cards">{cards}</div></article>'
    home_titles = {'en': 'Legal & support', 'ar': 'الشروط والدعم'}
    (OUT / 'index.html').write_text(page('', '', home_titles, articles, config), encoding='utf-8')

    print(f'Built {len(PAGES) + 1} pages into {OUT}')
    if missing:
        print('\nStill to fill in site.config.json (highlighted on the pages):')
        for key in sorted(missing):
            print(f'  - {key}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(build())
