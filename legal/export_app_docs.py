"""Copies the Terms of Service and Privacy Policy into the Flutter app.

    python legal/export_app_docs.py

The app shows both documents in its own reader, in English and Arabic, so they
can be read without leaving the app. This writes them to
frontend/assets/legal/<page>.<lang>.md from the same Markdown sources and
site.config.json values as the website (build_site.py), with the {{tokens}}
filled in and the editor comments removed. Run it whenever the documents or
their config change, together with build_site.py.

Standard library only. A value missing from the config is written as
[key] and listed, the same way the website build reports it.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import build_site as site

OUT = site.HERE.parent / 'frontend' / 'assets' / 'legal'

# (asset name, source file stem)
DOCUMENTS = [
    ('terms', 'terms-of-service'),
    ('privacy', 'privacy-policy'),
]


def export() -> int:
    config = site.load_config()
    missing: set[str] = set()

    def fill(text: str, lang: str) -> str:
        def sub(m: re.Match) -> str:
            v = site.value(config, m.group(1), lang)
            if not v:
                missing.add(m.group(1))
                return f'[{m.group(1)}]'
            return v

        return re.sub(r'\{\{(\w+)\}\}', sub, text)

    OUT.mkdir(parents=True, exist_ok=True)
    for name, stem in DOCUMENTS:
        for lang in ('en', 'ar'):
            source = (site.HERE / f'{stem}.{lang}.md').read_text(encoding='utf-8').replace('\r\n', '\n')
            source = re.sub(r'<!--[\s\S]*?-->\n*', '', source)
            target = OUT / f'{name}.{lang}.md'
            target.write_text(fill(source, lang).strip() + '\n', encoding='utf-8', newline='\n')
            print(f'wrote {target.relative_to(site.HERE.parent)}')

    if missing:
        print('Missing in site.config.json: ' + ', '.join(sorted(missing)))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(export())
