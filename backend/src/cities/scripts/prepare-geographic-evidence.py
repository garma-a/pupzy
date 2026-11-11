#!/usr/bin/env python3
'Deterministic GEOS clipping and P-code evidence; no network.'

from pathlib import Path

import hashlib, json, collections

from dataset_geography import *

root = Path(__file__).resolve().parents[3]

data = root / 'src/cities/data/neighbourhoods'

out = root / 'output/neighbourhood-cities'

out.mkdir(parents=True, exist_ok=True)

a1, a2, coverage = geography(data)
save(data/'reviewed-boundary-replacements.geojson.gz', {'type':'FeatureCollection','metadata':{'reviewed':True,'notes':'Only replaced coastal features; source OCHA geometry retained in its original file. See boundary-supplements.json.'},'features':[{'type':'Feature','properties':{**shape.properties,'ochaLevel':level},'geometry':shape.value} for level,shapes,code,key in [(1,a1,'EG11','adm1_pcode'),(2,a2,'EG1106','adm2_pcode')] for shape in shapes if shape.properties[key]==code]})

save(out / 'coverage-areas.geojson.gz', {'type': 'FeatureCollection', 'metadata': {'reviewed': True, 'notes': 'Coverage derived by scripts/dataset_geography.py from OCHA governorate/district unions, plus declared new-city expansion envelopes; Scope reviewed against the task: entire Cairo, Alexandria and Port Said governorates, specified urban districts and city-expansion envelopes; no gap-based exclusions.'}, 'features': [{'type': 'Feature', 'properties': {'area': a, 'evidence': 'dataset_geography.py coverage definition'}, 'geometry': s.value} for a, s in coverage.items()]})

adm3full = data / 'ocha-cod-ab/egy_admin3.geojson.gz'

source = adm3full if adm3full.exists() else data / 'ocha-cod-ab/egy_admin3-covered.geojson.gz'

adm3 = []

for f in load(source)['features']:
    p = f['properties']
    point = [p['center_lon'], p['center_lat']]
    region = next((a for a, s in coverage.items() if s.covers(point)), None)
    if region:
        f['properties']['coverageArea'] = region
        adm3.append(f)

save(data / 'ocha-cod-ab/egy_admin3-covered.geojson.gz', {'type': 'FeatureCollection', 'features': adm3})

features = []

stats = collections.Counter()

rejected = []

for area in REGIONS:
    seen = set()
    for e in load(data / (area + '-residential.json.gz'))['elements']:
        identity = f"OSM:{e['type']}/{e['id']}"
        if identity in seen:
            continue
        seen.add(identity)
        value = osm_geometry(e)
        if identity == 'OSM:relation/19575381':
            rings = [[[point['lon'], point['lat']] for point in member.get('geometry', [])] for member in e.get('members', []) if member.get('role') == 'inner']
            if len(rings) != 3 or not all(len(ring) >= 4 and ring[0] == ring[-1] for ring in rings):
                raise ValueError('Reviewed boundary-role correction no longer matches source')
            value = {'type':'MultiPolygon','coordinates':[[ring] for ring in rings]}

        if not value:
            rejected.append({'sourceCode': identity, 'reason': 'No complete polygon rings in Overpass response'})
            continue
        g = geometry(value)
        repaired = valid(ctx, g)
        if not repaired:
            rejected.append({'sourceCode': identity, 'reason': 'GEOS could not repair source polygon'})
            continue
        if prepared_intersects(ctx, coverage[area].prepared, repaired) != 1:
            continue
        clipped = intersect(ctx, repaired, coverage[area].geom)
        if not clipped:
            raise ValueError('Clipping failed ' + identity)
        if empty(ctx, clipped):
            continue
        poly = polygonal(output(clipped))
        if not poly:
            continue
        features.append({'type': 'Feature', 'properties': {'area': area, 'evidence': identity + ' landuse=residential clipped to coverage-areas', 'samplePoint': Shape(poly).representative(), 'osmSourceCode': identity, 'name': e.get('tags', {}).get('name', '')}, 'geometry': poly})
        stats[area] += 1

save(out / 'residential-clipped.geojson.gz', {'type': 'FeatureCollection', 'metadata': {'reviewed': True, 'notes': 'Complete residential polygons clipped to declared coverage; no gap-based shrinking. ADM3 remains City fill only, never sampled.'}, 'features': features})

save(out / 'geometry-rejected.json', rejected)

print('Residential polygons', dict(stats), 'covered ADM3', len(adm3), 'incomplete polygons', len(rejected))
