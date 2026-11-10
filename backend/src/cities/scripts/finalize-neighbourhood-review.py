#!/usr/bin/env python3
'Materialize source-backed, audited rules as a candidate. Publication gates remain mandatory.'

from pathlib import Path

import hashlib, collections, json

from geo_offline import load, save

root = Path(__file__).resolve().parents[3]

d = root / 'src/cities/data/neighbourhoods'

out = root / 'output/neighbourhood-cities'

review = load(d / 'personal-review.json')

def review_signature():
    material = {'snapshots': load(d / 'source-manifest.json')['snapshots'], 'editorial': {k: review.get(k) for k in ['decisions', 'translations', 'englishArabic', 'additions', 'aliasReview', 'geometryCorrections', 'cityContexts', 'identityMerges', 'residentialComplexes', 'nameOverrides', 'areaLandmarks', 'preferredSourceCodes', 'populatedPlaces', 'populatedPlacesExcluded', 'districtIdentityMerges', 'districtNames', 'adm3HabitationEvidence']}, 'rules': {}}
    for name in ['build-reviewed-dataset.py', 'dataset_geography.py', 'geo_offline.py', 'prepare-geographic-evidence.py']:
        material['rules'][name] = hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

if review.get('reviewedInputSha256') != review_signature():
    raise ValueError('Sources/rules/editorial decisions changed: personal review signoff must be renewed; refusing automatic promotion')

if review.get('reviewedDecisionsSha256') != hashlib.sha256((out / 'bulk-decisions.json').read_bytes()).hexdigest():
    raise ValueError('Decision output changed: renew audit signoff before finalization')

if not review.get('thirdSampleReview') or not review.get('auditFiles'):
    raise ValueError('Missing personal audit record')

for file in ['name-and-parent-residue.json', 'adm3-name-residue.json']:
    if load(out / file):
        raise ValueError('Unresolved residue: ' + file)

rows = load(out / 'bulk-decisions.json')

for row in rows:
    if 'unresolved' in row['rule'] or 'beyond-40km' in row['rule']:
        raise ValueError('Unresolved decision ' + row['sourceCode'])
    row['reviewed'] = True
    row['notes'] = row['notes'].replace('sample review not yet signed off.', 'bulk-rule audit recorded in personal-review.json.').replace('individual name/sample review pending.', 'curated names and rule sample audit recorded in personal-review.json.').replace('source-based name/sample review pending.', 'source-name/rule audit recorded in personal-review.json.')
    row.setdefault('provenance', {})['reviewBasis'] = 'Deterministic rule ' + row['rule'] + '; personal-review.json residue, merges, disambiguations, curated-name and random-sample audit, 2026-11-09/10.'

file = d / 'reviewed-decisions.json.gz'

save(file, rows)

old = load(d / 'reviewed-overrides.json')

manifest = load(d / 'source-manifest.json')

paths = ['neighbourhoods/' + a + '-' + group + '.json.gz' for a in ['greater-cairo', 'alexandria', 'port-said-region'] for group in ['places', 'hamlets']]

# Every raw source is pinned in the candidate; future source mutations fail closed.
digests = {s['path'].split('src/cities/data/')[1]: s['sha256'] for s in manifest['snapshots']}

digests['neighbourhoods/reviewed-decisions.json.gz'] = hashlib.sha256(file.read_bytes()).hexdigest()

overpass = {'metadata': {'retrievalDate': max(s['retrievalDate'][:10] for s in manifest['snapshots'] if s['license'] == 'ODbL 1.0'), 'license': 'ODbL 1.0', 'attribution': '© OpenStreetMap contributors', 'queryFile': 'src/cities/scripts/*-places.overpass and *-hamlets.overpass; exact per-file metadata in source-manifest.json'}, 'response': {'elements': []}}

wd = {'metadata': {'retrievalDate': '2026-11-09', 'license': 'CC0', 'attribution': 'Wikidata contributors', 'queryFile': 'src/cities/scripts/neighbourhoods.sparql'}, 'response': {'results': {'bindings': []}}}

save(d / 'reviewed-overrides.json', {'districtEdits': load(out / 'district-edits.json'), 'decisions': [], 'decisionsFile': 'neighbourhoods/reviewed-decisions.json.gz', 'overpassFiles': paths, 'wikidataFile': 'neighbourhoods/wikidata.json.gz', 'sourceDigests': digests, 'overpass': overpass, 'wikidata': wd})

built = load(out / 'candidate-builtup.geojson.gz')

built['metadata'] = {'reviewed': True, 'notes': 'Complete clipped OSM residential polygons plus every ADM3 unit with residential/populated-place/named-OSM habitation evidence. Full extents retained; review does not assert that the 1.5 km gate passes.'}

save(d / 'builtup-evidence.geojson.gz', built)

# Final review tables; audit digests and errors are recorded separately in personal-review.json.
for name in ['identity-review', 'merge-review', 'curated-name-review', 'starter-review', 'number-name-review']:
    save(d / (name + '.json.gz'), load(out / (name + '.json')))

exceptions = [r for r in rows if r['decision'] == 'include' and r['provenance'].get('parentRule', '').startswith('zemam-out')]

save(d / 'zemam-out-exceptions.json.gz', [{k: r[k] for k in ['sourceCode', 'nameEnglish', 'nameArabic', 'districtSourceCode', 'point', 'provenance']} for r in exceptions])

print('Candidate includes', sum((r['decision'] == 'include' for r in rows)), 'merges', sum((r['decision'] == 'merge' for r in rows)), 'exceptions', dict(collections.Counter((r['provenance']['parentRule'] for r in exceptions))))
