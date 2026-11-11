#!/usr/bin/env python3
'Diagnostic only; samples the complete built-up evidence without shrinking extents.'

from pathlib import Path

import math, json, collections

from geo_offline import *

root = Path(__file__).resolve().parents[3]

out = root / 'output/neighbourhood-cities'

rows = [r for r in load(out / 'bulk-decisions.json') if r['decision'] == 'include']

points = [([r['point']['longitude'], r['point']['latitude']], r['sourceCode']) for r in rows]

points += [([r['longitude'], r['latitude']], r['sourceCode']) for r in load(root / 'src/cities/data/egypt-cities-catalog.json')['records'] if not r.get('districtSourceCode')]

scale = math.cos(math.radians(30.5))

def build(items, depth=0):
    if not items:
        return None
    axis = depth % 2
    items = sorted(items, key=lambda x: x[0][axis])
    mid = len(items) // 2
    return (items[mid], axis, build(items[:mid], depth + 1), build(items[mid + 1:], depth + 1))

tree = build([([p[0] * scale, p[1]], (p, code)) for p, code in points])

def nearest(p):
    target = [p[0] * scale, p[1]]
    best = [float('inf'), None]

    def visit(node):
        if node is None:
            return
        (xy, v), axis, left, right = node
        d = (xy[0] - target[0]) ** 2 + (xy[1] - target[1]) ** 2
        if d < best[0]:
            best[:] = [d, v]
        diff = target[axis] - xy[axis]
        visit(left if diff < 0 else right)
        if diff ** 2 < best[0]:
            visit(right if diff < 0 else left)
    visit(tree)
    q, code = best[1]
    return (distance(p, q), code)

counts = collections.Counter()

gaps = collections.defaultdict(list)

seen = collections.defaultdict(set)

for f in load(out / 'candidate-builtup.geojson.gz')['features']:
    s = Shape(f['geometry'])
    area = f['properties']['area']
    w, south, e, north = s.bounds
    step = 500 / 111195
    pts = []
    lat = south
    while lat <= north:
        dx = step / math.cos(math.radians(lat))
        lon = w
        while lon <= e:
            if s.covers([lon, lat]):
                pts.append([lon, lat])
            lon += dx
        lat += step
    if not pts:
        pts = [s.representative()]
    for p in pts:
        key = tuple((round(x, 7) for x in p))
        if key in seen[area]:
            continue
        seen[area].add(key)
        counts[area] += 1
        meters, code = nearest(p)
        if meters > 1500:
            gaps[area].append({'longitude': p[0], 'latitude': p[1], 'meters': round(meters, 1), 'nearest': code, 'evidence': f['properties']['evidence']})

for a in counts:
    gaps[a].sort(key=lambda g: -g['meters'])
    print(a, 'samples', counts[a], 'gaps', len(gaps[a]))
    print(json.dumps(gaps[a][:10], ensure_ascii=False))

save(out / 'grid-diagnostic.json', {'sampleCounts': dict(counts), 'gaps': dict(gaps)})
