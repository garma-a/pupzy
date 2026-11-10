#!/usr/bin/env python3
'Independent acceptance vocabulary: manual knowledge + OCHA names, never catalog rows.'

from pathlib import Path

import re, collections, hashlib, json

from dataset_geography import load, save, geography, osm_point

root = Path(__file__).resolve().parents[3]

d = root / 'src/cities/data/neighbourhoods'

def norm(v):
    v = re.sub('[ؐ-ًؚ-ٰٟـ]', '', v).lower().strip().translate(str.maketrans('أإآٱةىؤئ', 'ااااهيوي'))
    return re.sub('\\s+', ' ', re.sub("[-'’]", '', re.sub('^(?:el|al)[ -]+|^ال', '', v)))

manual = load(d / 'independent-name-input.json')

translations = load(d / 'personal-review.json')['translations']

lex = {norm(a): b for a, b in translations.items()}

# Bilingual labels only translate an independently selected OCHA name; they do not select it.
for region in manual['areas']:
    for e in load(d / (region + '-places.json.gz'))['elements']:
        t = e.get('tags', {})
        a = t.get('name:ar')
        b = t.get('name:en')
        if a and b:
            lex.setdefault(norm(a), b)

areas = {a: [] for a in manual['areas']}

seen = {a: set() for a in areas}

def add(area, row):
    # Arabic joined/separated spellings and the explicitly reviewed city-prefix
    # variants below are one independent name, not extra minimum-count credit.
    equivalences = {
        'port-said-region': {
            norm('مدينة دمياط الجديدة').replace(' ', ''): 'دمياط الجديدة',
            norm('مدينه رأس البر').replace(' ', ''): 'رأس البر',
            norm('مدينه عزبه البرج').replace(' ', ''): 'عزبة البرج',
            norm('مبارك - شرق التفريعة').replace(' ', ''): 'شرق بورسعيد',
            norm('شرق التفريعة').replace(' ', ''): 'شرق بورسعيد',
        }
    }
    canonical = equivalences.get(area, {}).get(norm(row['arabic']).replace(' ', ''), row['arabic'])
    key = norm(canonical).replace(' ', '')
    if key in seen[area]:
        prior = next((r for r in areas[area] if norm(r['arabic']).replace(' ', '') == key))
        if norm(row['english']) != norm(prior['english']):
            prior['misspellings'].append(row['english'])
        if norm(row['arabic']) != norm(prior['arabic']):
            prior['misspellings'].append(row['arabic'])
        return
    seen[area].add(key)
    row['misspellings'] = row.get('misspellings', [])
    english = row['english']
    if english.startswith('El '):
        row['misspellings'].append('Al ' + english[3:])
    if english.startswith('Al '):
        row['misspellings'].append('El ' + english[3:])
    if 'Gaber' in english:
        row['misspellings'].append(english.replace('Gaber', 'Gabir'))
    if 'Mohandessin' in english:
        row['misspellings'].extend(['Mohandiseen', 'Mohandeseen'])
    row['misspellings'] = list(dict.fromkeys(row['misspellings']))
    areas[area].append(row)

for area, rows in manual['areas'].items():
    for row in rows:
        add(area, {**row, 'evidence': row.get('evidence', 'Independent task/knowledge checklist, individually screened 2026-11-09.')})

# Explicitly selected public vocabulary is reviewed as source input, never mined
# from candidate rows or filtered by whether a catalog match happens to exist.
public = load(d / 'research-names/public-checklist.json')
for area, rows in public['areas'].items():
    for row in rows:
        add(area, row)

for f in load(d / 'ocha-cod-ab/egy_admin3-covered.geojson.gz')['features']:
    p = f['properties']
    a = p['adm3_name1'].strip()
    area = p['coverageArea']
    b = lex.get(norm(a))
    if not b or re.search('شياخ|قسم (?:اول|أول|ثان|ثالث)|خارج|جزء من|^[\\d٠-٩]', a):
        continue
    add(area, {'english': b, 'arabic': a, 'misspellings': [], 'evidence': 'Independent OCHA ADM3 ' + p['adm3_pcode'] + ' Arabic label; reviewed bilingual transliteration.'})

# These selections use raw public reference sources, never catalog/decision output.
review = load(d / 'personal-review.json')
_, _, coverage = geography(d)
for feature in load(d / 'ocha-cod-ab/egy_populatedplaces.geojson.gz')['features']:
    props = feature['properties']
    approval = review.get('populatedPlaces',{}).get(props['featurename_en'].strip())
    point = feature['geometry']['coordinates']
    area = next((name for name,shape in coverage.items() if shape.covers(point)),None)
    if approval and area:
        add(area,{'english':approval['nameEnglish'],'arabic':approval['nameArabic'],'misspellings':[props['featurename_en'].strip()], 'evidence':'Independent OCHA populated places '+((props.get('pcode') or '').strip() or props['featurename_en'])+'; standard reviewed Arabic rendering.', 'sourceUrl':'https://data.humdata.org/dataset/cod-ab-egy'})

entities = {}
for binding in load(d / 'wikidata.json.gz')['results']['bindings']:
    q = binding['item']['value'].rsplit('/',1)[-1]
    record = entities.setdefault(q,{'en':set(),'ar':set(),'points':set()})
    for lang in ['en','ar']:
        if binding.get(lang):record[lang].add(binding[lang]['value'])
    match = re.match(r'Point\(([-\d.]+) ([-\d.]+)\)',binding.get('coord',{}).get('value',''))
    if match:record['points'].add((float(match[1]),float(match[2])))
for q,record in sorted(entities.items()):
    if 'WD:'+q in review.get('decisions',{}) or len(record['points']) != 1 or not record['en'] or not record['ar']:
        continue
    arabic = next((name for name in sorted(record['ar']) if re.match(r'^(?:حي|مدينة|قرية|عزبة|كفر)\s+',name)),None)
    if not arabic:continue
    point = next(iter(record['points']))
    area = next((name for name,shape in coverage.items() if shape.covers(point)),None)
    if area:
        original = sorted(record['en'])[0]
        # This raw label has an extraneous trailing ",l"; it is not a spelling variant.
        english = 'Central Business District' if q == 'Q118313607' else original
        add(area,{'english':english,'arabic':arabic,'misspellings':[], 'evidence':'Independent Wikidata locality label and coverage coordinate; original source snapshot, not candidate names.', 'sourceEnglish':original, 'sourceUrl':'https://www.wikidata.org/wiki/'+q})

# Alias variants are a single entry even when the original checklist repeated them.
special = {'6th of October': ['6 October', '6th October', 'السادس من اكتوبر', '٦ أكتوبر'], 'Sidi Gaber': ['Sidi Gabir'], 'Shubra El Kheima': ['Shobra El Kheima'], 'Fifth Settlement': ['Tagamoa', 'El Tagamoa'], 'Asafra': ['El Asafra']}

for rows in areas.values():
    for row in rows:
        row['misspellings'] = list(dict.fromkeys([*row['misspellings'], *special.get(row['english'], [])]))

signature = hashlib.sha256(json.dumps(areas,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
reviewed = review.get('independentNameReview',{}).get('areasSha256') == signature

save(d / 'independent-names.json', {'metadata': {'reviewed': reviewed, 'areasSha256': signature, 'compiledDate': '2026-11-10', 'minimums': manual['metadata'].get('minimums', {}), 'method': 'Manual task/knowledge input, raw OCHA ADM3/populated-place labels, explicit Wikidata locality labels, and individually selected Arabic/English Wikipedia city and governorate lists. Public URLs and compressed source pages retained in research-names. Script never reads catalog or decision output. Duplicate Arabic forms combined; variants do not count as names. Per-area minima are separately reviewed metadata, not inferred from catalog matches.'}, 'removed': manual['removed'], 'areas': areas})

print({a: len(r) for a, r in areas.items()})
