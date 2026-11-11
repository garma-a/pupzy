#!/usr/bin/env python3
'Independent WD landmarks + OCHA geometry. Does not read the City catalog or its points.'

from pathlib import Path

import re, collections, json, hashlib

from dataset_geography import *

root = Path(__file__).resolve().parents[3]

d = root / 'src/cities/data/neighbourhoods'

a1, a2, coverage = geography(d)

rows = {}

for r in load(d / 'wikidata.json.gz')['results']['bindings']:
    q = r['item']['value'].split('/')[-1]
    if q not in rows:
        rows[q] = {'id': q, 'en': set(), 'ar': set(), 'points': set()}
    for lang in ['en', 'ar']:
        if r.get(lang):
            rows[q][lang].add(r[lang]['value'])
    m = re.match('Point\\(([-\\d.]+) ([-\\d.]+)\\)', r.get('coord', {}).get('value', ''))
    if m:
        rows[q]['points'].add((float(m[1]), float(m[2])))

used_qids = {a.get('wikidata') or a.get('sourceResponse',{}).get('qid') for a in load(d / 'personal-review.json').get('additions', [])}
selection=load(d/'gps-selection.json') if (d/'gps-selection.json').exists() else None

areas = {}

for area in REGIONS:
    choices = []
    for q, v in rows.items():
        if q in used_qids or len(v['points']) != 1 or re.search('^HMS |^SS |^USS ', next(iter(sorted(v['en'])), '')):
            continue
        name = next(iter(sorted(v['en'] or v['ar'])), '')
        text = ' '.join(v['en'] | v['ar'])
        if not re.search('station|university|hospital|stadium|square|mosque|museum|church|airport|مستشفى|مستشفيات|جامع|مسجد|ميدان|محطة|متحف|استاد|ملعب|كنيسة|مطار', text, re.I):
            continue
        if re.search('riot|stampede|disaster|battle|siege|bombing|strike|coup|حادث|احداث|أحداث|حصار|معركة', text, re.I):
            continue
        if re.search('مسجد\\s*\\d|^(?:mosque|masjed)\\s*\\d|مصلي|مصلى|صلاة|sewage|treatment plant', name, re.I):
            continue
        p = list(next(iter(v['points'])))
        if not coverage[area].covers(p):
            continue
        gov = locate(p, a1, 'adm1_pcode')
        containing = next((s for s in a2 if s.covers(p)), None)
        if not containing or containing.properties['adm2_pcode'].endswith('00'):
            continue
        choices.append({'q': q, 'name': name, 'point': p, 'parent': containing, 'priority': 0 if int(q[1:]) < 100000000 else 1})
    selected = []
    for i in range(30):
        available = [r for r in choices if r not in selected]
        established = [r for r in available if r['priority'] == 0]
        if i < 10 and established:
            available = established
        if not available:
            raise ValueError('Fewer than 30 independently named landmarks for ' + area)
        if selection:
            qid=selection['areas'][area][i]
            pick=next((r for r in choices if r['q']==qid),None)
            if not pick:raise ValueError('Frozen independent fixture is not eligible '+qid)
        elif not selected:
            pick = min(available, key=lambda r: (r['priority'], int(r['q'][1:])))
        else:
            pick = max(available, key=lambda r: (min((distance(r['point'], x['point']) for x in selected)), -r['priority'], -int(r['q'][1:])))
        selected.append(pick)
    output = []
    for r in selected:
        p = r['point']
        parent = r['parent']
        code = parent.properties['adm2_pcode']
        adjacent = []
        for other in a2:
            oc = other.properties['adm2_pcode']
            if oc == code or oc.endswith('00'):
                continue
            if prepared_intersects(ctx, parent.prepared, other.geom) == 1:
                near = polygon_distance(p, other)
                if near <= 1500:
                    adjacent.append({'sourceCode': oc, 'reason': f'Landmark is {near:.0f} m from this genuinely adjacent OCHA district; representative-point nearest recognition may cross the shared boundary.'})
        for approval in load(d / 'personal-review.json').get('gpsAdjacentReview', {}).get(r['q'], []):
            other = next(s for s in a2 if s.properties['adm2_pcode'] == approval['sourceCode'])
            if approval['sourceCode'] == code or approval['sourceCode'].endswith('00') or prepared_intersects(ctx, parent.prepared, other.geom) != 1:
                raise ValueError('Reviewed GPS neighbour is not genuinely adjacent: '+r['q'])
            if not approval['reason'].strip():
                raise ValueError('Missing reviewed adjacency reason')
            if not any(a['sourceCode'] == approval['sourceCode'] for a in adjacent):
                adjacent.append(dict(approval))
        output.append({'latitude': p[1], 'longitude': p[0], 'name': r['name'], 'expectedDistrictSourceCode': code, 'acceptableAdjacentDistricts': adjacent, 'acceptableSourceCodes': [], 'evidence': r['q'] + ' P625, committed Wikidata snapshot; containing OCHA ADM2 polygon ' + code})
    areas[area] = output

signature = hashlib.sha256(json.dumps(areas, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

reviewed = load(d / 'personal-review.json').get('gpsReview', {}).get('areasSha256') == signature

save(d / 'gps-checks.json', {'metadata': {'reviewed': reviewed, **(load(d / 'gps-failure-review.json') if (d / 'gps-failure-review.json').exists() else {}), 'notes': '30 spatially spread named Wikidata landmarks per region; expected districts determined solely from OCHA polygons. No catalog points or nearest answers read. Individual fixture review is recorded by exact areas digest in personal-review.json; changed inputs invalidate signoff.', 'selection': 'Deterministic farthest-point sampling among named non-event landmarks; QIDs used as City coordinate sources excluded; name-only corroborating landmarks may remain when City coordinates derive independently from OSM geometry.'}, 'areas': areas})

print('GPS fixtures', {a: len(r) for a, r in areas.items()})
