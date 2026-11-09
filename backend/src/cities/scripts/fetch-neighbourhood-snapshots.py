#!/usr/bin/env python3
"""Explicit maintainer fetch. Run from backend/. Never used by runtime or tests."""
import datetime
import json
from pathlib import Path
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parents[1]
manifest_path = root / 'data/neighbourhoods/source-manifest.json'
manifest = json.loads(manifest_path.read_text())
for entry in manifest['snapshots']:
    query = Path(entry['query']).read_text()
    sparql = entry['query'].endswith('.sparql')
    body = urllib.parse.urlencode({'query' if sparql else 'data': query}).encode()
    request = urllib.request.Request(entry['endpoint'], data=body, headers={
        'User-Agent': 'PupzyCityCatalog/1.0 (offline reference data)',
        'Accept': 'application/sparql-results+json' if sparql else 'application/json',
    })
    with urllib.request.urlopen(request, timeout=1000) as response:
        raw = response.read()
    result = json.loads(raw)
    if 'remark' in result or (not sparql and 'elements' not in result) or (sparql and 'results' not in result):
        raise ValueError('Incomplete/failed upstream response: ' + entry['path'])
    destination = Path(entry['path'])
    destination.with_suffix('.raw.json').write_bytes(raw)
    entry.update(retrievalDate=datetime.datetime.now(datetime.timezone.utc).isoformat(), status='fetched')
    metadata = {key: entry[key] for key in ['retrievalDate', 'license', 'attribution']}
    metadata.update(queryFile=entry['query'], endpoint=entry['endpoint'])
    destination.write_text(json.dumps({'metadata': metadata, 'response': result}, ensure_ascii=False, indent=2) + '\n')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(destination)
