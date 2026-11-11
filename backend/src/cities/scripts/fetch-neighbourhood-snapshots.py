#!/usr/bin/env python3
"""Explicit maintainer fetch. Run from backend/. Never used by runtime or tests."""
import datetime
import json
import gzip
import hashlib
from pathlib import Path
import urllib.parse
import urllib.request
from geo_offline import save

root = Path(__file__).resolve().parents[1]
manifest_path = root / 'data/neighbourhoods/source-manifest.json'
manifest = json.loads(manifest_path.read_text())
for entry in manifest['snapshots']:
    if 'query' not in entry:
        print('Retained OCHA source; fetch the documented HDX archive explicitly:', entry['path'])
        continue
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
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    destination.write_bytes(compressed)
    entry.update(retrievalDate=datetime.datetime.now(datetime.timezone.utc).isoformat(), status='fetched',
                 sha256=hashlib.sha256(compressed).hexdigest(),sizeBytes=len(compressed),
                 uncompressedSha256=hashlib.sha256(raw).hexdigest(),uncompressedSizeBytes=len(raw),
                 representation='Untouched raw response, deterministic gzip (mtime=0)')
    save(manifest_path, manifest)
    print(destination)
