#!/usr/bin/env python3
"""Check every included coordinate against its recorded raw source, without network access."""
from pathlib import Path
import re
from geo_offline import load, save, Shape, distance, osm_geometry
from dataset_geography import REGIONS, osm_point

root = Path(__file__).resolve().parents[3]
data = root / 'src/cities/data/neighbourhoods'
rows = [r for r in load(data / 'reviewed-decisions.json.gz') if r['decision'] == 'include']
osm = {f"OSM:{e['type']}/{e['id']}": e for area in REGIONS for kind in ['places', 'hamlets'] for e in load(data / (area + '-' + kind + '.json.gz'))['elements']}
adm3 = {f['properties']['adm3_pcode']: f['properties'] for f in load(data / 'ocha-cod-ab/egy_admin3-covered.geojson.gz')['features']}
populated = load(data / 'ocha-cod-ab/egy_populatedplaces.geojson.gz')['features']
residential = {f"OSM:{e['type']}/{e['id']}": e for area in REGIONS for e in load(data / (area + '-residential.json.gz'))['elements']}
wd = {}
for record in load(data / 'wikidata.json.gz')['results']['bindings']:
    match = re.match(r'Point\(([-\d.]+) ([-\d.]+)\)', record.get('coord', {}).get('value', ''))
    if match:
        wd.setdefault(record['item']['value'].rsplit('/', 1)[-1], set()).add((float(match[1]), float(match[2])))

counts = {'exactPoint': 0, 'sourceGeometry': 0, 'documentedCoastalCorrection': 0}
errors = []
for row in rows:
    try:
        code = row['sourceCode']
        point = (row['point']['longitude'], row['point']['latitude'])
        provenance = row['provenance']
        source = provenance.get('coordinateSource', {})
        if code.startswith('OSM:'):
            expected = {tuple(osm_point(osm[code]))}
            assert provenance['osmPlaceType'] == osm[code].get('tags', {}).get('place', 'residential'), 'Original place tag changed'
        elif code.startswith('PUPZY:adm3-'):
            props = adm3[provenance['adm3SourceCode']]
            expected = {(props['center_lon'], props['center_lat'])}
        elif source.get('kind') == 'OCHA populated places':
            matches = [f for f in populated if (f['properties'].get('pcode') or '').strip() == source['id'] or f['properties']['featurename_en'].strip() == source['id']]
            assert len(matches) == 1, 'Ambiguous populated-place source'
            expected = {tuple(matches[0]['geometry']['coordinates'])}
        elif source.get('kind') == 'OSM residential geometry':
            shape = Shape(osm_geometry(residential[source['id']]))
            expected = {tuple(shape.representative())}
            landmark = wd[provenance['nameEvidenceWikidata']]
            assert len(landmark) == 1 and shape.covers(list(next(iter(landmark)))), 'Name landmark does not corroborate polygon'
            assert point in expected, 'Geometry-derived point changed'
            counts['sourceGeometry'] += 1
            continue
        else:
            expected = wd[source.get('id') or code.removeprefix('WD:')]
        if provenance.get('originalSourcePoint'):
            original = tuple(provenance['originalSourcePoint'])
            assert original in expected, 'Coastal original is not a raw source coordinate'
            assert code == 'PUPZY:stanley', 'Unreviewed coordinate correction'
            assert abs(distance(original, point) - provenance['coordinateCorrectionMeters']) <= .02
            assert provenance['coordinateCorrectionMeters'] <= 500
            counts['documentedCoastalCorrection'] += 1
        else:
            assert point in expected, 'Point is not present in the declared raw source'
            counts['exactPoint'] += 1
    except (AssertionError, KeyError, TypeError) as error:
        errors.append({'sourceCode': row['sourceCode'], 'error': str(error)})
result = {'passed': not errors, 'rows': len(rows), 'counts': counts, 'errors': errors}
out = root / 'output/neighbourhood-cities'
out.mkdir(parents=True, exist_ok=True)
save(out / 'source-point-integrity.json', result)
print(result)
raise SystemExit(0 if result['passed'] else 1)
