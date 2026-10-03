#!/usr/bin/env python3
"""Generates clean, professional PDF copies of the Pupzy Terms of Service.

Produces:
  - legal/Pupzy_Terms_of_Service_EN.pdf
  - legal/Pupzy_Terms_of_Service_AR.pdf
  - legal/Pupzy_Terms_of_Service_Bilingual.pdf
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Add legal folder to path to import build_site helpers
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_site

CHROME_CANDIDATES = [
    "google-chrome",
    "chromium-browser",
    "chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]


def find_chrome() -> str:
    for cmd in CHROME_CANDIDATES:
        path = shutil.which(cmd)
        if path:
            return path
    raise RuntimeError("Chrome or Chromium executable not found on the system.")


CSS_TEMPLATE = """
@page {
  size: A4 portrait;
  margin: 18mm 16mm 20mm 16mm;
}

@page :first {
  margin-top: 15mm;
  @top-left { content: none; }
  @top-right { content: none; }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  color: #24140b;
  background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 9.5pt;
  line-height: 1.55;
  text-rendering: optimizeLegibility;
}

/* RTL / Arabic typography */
[dir="rtl"], [lang="ar"] {
  direction: rtl;
  text-align: right;
  font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif;
  line-height: 1.85;
}

/* Document Header Banner */
.doc-header {
  border-bottom: 2px solid #c4622d;
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.brand-badge {
  display: inline-block;
  font-size: 13pt;
  font-weight: 800;
  color: #c4622d;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.doc-title {
  font-size: 20pt;
  font-weight: 700;
  color: #1a0f07;
  margin: 0 0 8px 0;
  line-height: 1.25;
}

.doc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 8.5pt;
  color: #6c5446;
  background: #fdf9f5;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid #f0e4db;
}

.doc-meta span {
  display: inline-block;
}

/* Headings */
h1 {
  display: none; /* Rendered in .doc-title */
}

h2 {
  font-size: 11.5pt;
  font-weight: 700;
  color: #c4622d;
  margin: 18px 0 6px 0;
  padding-bottom: 3px;
  border-bottom: 1px solid #ebdcd1;
  page-break-after: avoid;
  break-after: avoid;
}

h3 {
  font-size: 9.5pt;
  font-weight: 700;
  color: #2d1506;
  margin: 12px 0 4px 0;
  page-break-after: avoid;
  break-after: avoid;
}

p {
  margin: 0 0 7px 0;
  text-align: justify;
  orphans: 3;
  widows: 3;
}

ul, ol {
  margin: 0 0 7px 0;
  padding-left: 20px;
}

[dir="rtl"] ul, [dir="rtl"] ol {
  padding-left: 0;
  padding-right: 20px;
}

li {
  margin-bottom: 4px;
  orphans: 2;
  widows: 2;
}

strong {
  font-weight: 700;
  color: #1a0f07;
}

/* Links */
a {
  color: #9c4516;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Table of Contents - compact 2 column */
.toc {
  background: #fbf8f5;
  border: 1px solid #ebdcd1;
  border-radius: 6px;
  padding: 10px 14px;
  margin: 10px 0 16px 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

.toc summary {
  font-size: 9.5pt;
  font-weight: 700;
  color: #c4622d;
  cursor: pointer;
  margin-bottom: 6px;
  outline: none;
}

.toc ul {
  columns: 2;
  column-gap: 20px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc li {
  font-size: 8pt;
  margin-bottom: 3px;
  break-inside: avoid;
}

.toc a {
  text-decoration: none;
  color: #4b3224;
}

.toc a:hover {
  text-decoration: underline;
}

/* Placeholders (for fields still to be completed in site.config.json) */
mark.todo {
  background: #fff8e8;
  border-bottom: 1.5px dotted #c4622d;
  color: #8c4217;
  padding: 0 3px;
  border-radius: 2px;
  font-family: inherit;
  font-size: inherit;
  text-decoration: none;
}

hr {
  border: none;
  border-top: 1px solid #ebdcd1;
  margin: 14px 0;
}

.page-break {
  page-break-before: always;
  break-before: always;
}

.doc-footer {
  margin-top: 25px;
  padding-top: 10px;
  border-top: 1px solid #ebdcd1;
  font-size: 8pt;
  color: #8b6355;
  text-align: center;
}
"""


def clean_article_for_print(article_html: str, lang: str) -> str:
    # 1. Remove duplicate version / last updated / hr lines right below the TOC
    article_html = re.sub(
        r"<p><strong>(?:Version|الإصدار):</strong>[\s\S]*?</p>\s*<hr>",
        "",
        article_html,
        flags=re.IGNORECASE,
    )

    # 2. Sanitize anchor IDs to safe ASCII strings to prevent PDF name token warnings
    ids = list(dict.fromkeys(re.findall(r'id=[\"\']([a-zA-Z0-9_\-\u0600-\u06FF]+)[\"\']', article_html)))
    for i, old_id in enumerate(ids, 1):
        clean_id = f"{lang}-sec-{i}"
        article_html = article_html.replace(f'id="{old_id}"', f'id="{clean_id}"')
        article_html = article_html.replace(f'href="#{old_id}"', f'href="#{clean_id}"')

    return article_html


def render_html_page(title: str, body_html: str, lang: str, page_header_title: str) -> str:
    dir_attr = "rtl" if lang == "ar" else "ltr"
    version_label = 'الإصدار: <span dir="ltr">2026-09-27</span>' if lang == "ar" else "Version: 2026-09-27"
    updated_label = "آخر تحديث: 27 سبتمبر 2026" if lang == "ar" else "Last updated: 27 September 2026"
    jurisdiction = "جمهورية مصر العربية" if lang == "ar" else "Arab Republic of Egypt"
    page_counter_text = f"صفحة \" counter(page) \" من \" counter(pages);" if lang == "ar" else "Page \" counter(page) \" of \" counter(pages);"

    if lang == "ar":
        top_margin_css = f"""
        @page {{
          @top-right {{
            content: "{page_header_title}";
            font-size: 8pt;
            color: #8b6355;
            font-family: 'Noto Naskh Arabic', sans-serif;
          }}
          @top-left {{
            content: "الإصدار: 2026-09-27";
            font-size: 8pt;
            color: #8b6355;
            font-family: 'Noto Naskh Arabic', sans-serif;
          }}
          @bottom-center {{
            content: "{page_counter_text}";
            font-size: 8pt;
            color: #8b6355;
            font-family: 'Noto Naskh Arabic', sans-serif;
          }}
        }}
        """
    else:
        top_margin_css = f"""
        @page {{
          @top-left {{
            content: "{page_header_title}";
            font-size: 8pt;
            color: #8b6355;
          }}
          @top-right {{
            content: "Version: 2026-09-27";
            font-size: 8pt;
            color: #8b6355;
          }}
          @bottom-center {{
            content: "{page_counter_text}";
            font-size: 8pt;
            color: #8b6355;
          }}
        }}
        """

    return f"""<!doctype html>
<html lang="{lang}" dir="{dir_attr}">
<head>
  <meta charset="utf-8">
  <title>{title}</title>
  <style>
    {CSS_TEMPLATE}
    {top_margin_css}
  </style>
</head>
<body lang="{lang}" dir="{dir_attr}">
  <div class="doc-header">
    <div class="brand-badge">Pupzy · بابزي</div>
    <div class="doc-title">{title}</div>
    <div class="doc-meta">
      <span><strong>{version_label}</strong></span>
      <span>•</span>
      <span>{updated_label}</span>
      <span>•</span>
      <span>{jurisdiction}</span>
    </div>
  </div>
  <main>
    {body_html}
  </main>
  <div class="doc-footer">
    Pupzy Platform · {jurisdiction} · https://pupzy.net
  </div>
</body>
</html>
"""


def build_pdfs():
    chrome = find_chrome()
    config = build_site.load_config()

    # Read English source
    en_source = (HERE / "terms-of-service.en.md").read_text(encoding="utf-8")
    en_title, en_body, en_toc = build_site.markdown(en_source)
    en_article = build_site.document_article(en_title, en_body, en_toc, "en")
    en_filled = build_site.fill(en_article, config, "en")
    en_clean = clean_article_for_print(en_filled, "en")

    # Read Arabic source
    ar_source = (HERE / "terms-of-service.ar.md").read_text(encoding="utf-8")
    ar_title, ar_body, ar_toc = build_site.markdown(ar_source)
    ar_article = build_site.document_article(ar_title, ar_body, ar_toc, "ar")
    ar_filled = build_site.fill(ar_article, config, "ar")
    ar_clean = clean_article_for_print(ar_filled, "ar")

    out_en_html = HERE / "terms_en_print.html"
    out_ar_html = HERE / "terms_ar_print.html"
    out_bi_html = HERE / "terms_bilingual_print.html"

    pdf_en = HERE / "Pupzy_Terms_of_Service_EN.pdf"
    pdf_ar = HERE / "Pupzy_Terms_of_Service_AR.pdf"
    pdf_bi = HERE / "Pupzy_Terms_of_Service_Bilingual.pdf"

    # 1. English HTML
    html_en = render_html_page(
        "Pupzy Terms of Service",
        en_clean,
        "en",
        "Pupzy · Terms of Service",
    )
    out_en_html.write_text(html_en, encoding="utf-8")

    # 2. Arabic HTML
    html_ar = render_html_page(
        "شروط استخدام بابزي (Pupzy)",
        ar_clean,
        "ar",
        "بابزي · شروط الاستخدام",
    )
    out_ar_html.write_text(html_ar, encoding="utf-8")

    # 3. Bilingual HTML
    bilingual_body = f"""
    <div lang="en" dir="ltr">
      {en_clean}
    </div>
    <div class="page-break"></div>
    <div lang="ar" dir="rtl" style="margin-top: 20px;">
      <div class="doc-header">
        <div class="brand-badge">Pupzy · بابزي</div>
        <div class="doc-title">{ar_title}</div>
        <div class="doc-meta">
          <span><strong>الإصدار: <span dir="ltr">2026-09-27</span></strong></span>
          <span>•</span>
          <span>آخر تحديث: 27 سبتمبر 2026</span>
          <span>•</span>
          <span>جمهورية مصر العربية</span>
        </div>
      </div>
      {ar_clean}
    </div>
    """
    html_bi = render_html_page(
        "Pupzy Terms of Service / شروط استخدام بابزي",
        bilingual_body,
        "en",
        "Pupzy · Terms of Service / شروط الاستخدام",
    )
    out_bi_html.write_text(html_bi, encoding="utf-8")

    targets = [
        (out_en_html, pdf_en, "English Terms of Service"),
        (out_ar_html, pdf_ar, "Arabic Terms of Service"),
        (out_bi_html, pdf_bi, "Bilingual (EN + AR) Terms of Service"),
    ]

    for html_file, pdf_file, label in targets:
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_file}",
            str(html_file),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error generating {label}: {result.stderr}")
        else:
            size_kb = pdf_file.stat().st_size / 1024
            print(f"Generated {label} -> {pdf_file.name} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    build_pdfs()
