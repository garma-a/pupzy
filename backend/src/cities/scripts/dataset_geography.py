'Coverage membership is administrative geography, never the Overpass fetch boxes.'

from geo_offline import *

REGIONS = ['greater-cairo', 'alexandria', 'port-said-region']

def geography(data):
    adm1 = [Shape(f['geometry'], f['properties']) for f in load(data / 'ocha-cod-ab/egy_admin1.geojson.gz')['features']]
    adm2 = [Shape(f['geometry'], f['properties']) for f in load(data / 'ocha-cod-ab/egy_admin2.geojson.gz')['features']]
    by1 = {s.properties['adm1_pcode']: s for s in adm1}
    by2 = {s.properties['adm2_pcode']: s for s in adm2}
    cairo_codes = ['EG2101', 'EG2102', 'EG2103', 'EG2104', 'EG2105', 'EG2106', 'EG2107', 'EG2108', 'EG2109', 'EG2113', 'EG2116', 'EG2117', 'EG2118', 'EG2119', 'EG2120', 'EG2121', 'EG1403', 'EG1406', 'EG1407', 'EG1409', 'EG1410', 'EG1412', 'EG1413', 'EG1400', 'EG1309', 'EG1321']
    west = rectangle(30.65, 29.75, 31.16, 30.16)
    october_zayed = Shape(output(intersect(ctx, west.geom, by1['EG21'].geom)))
    ramadan = rectangle(31.65, 30.18, 31.87, 30.4)
    ramadan = Shape(output(intersect(ctx, ramadan.geom, by1['EG13'].geom)))
    alex_coast = rectangle(28.85, 30.6, 29.6, 31.15)
    alex_coast = Shape(output(intersect(ctx, alex_coast.geom, by1['EG33'].geom)))
    coverage = {'greater-cairo': union_shapes([by1['EG01'], *[by2[c] for c in cairo_codes], october_zayed, ramadan]), 'alexandria': union_shapes([by1['EG02'], by2['EG1811'], by2['EG1812'], alex_coast]), 'port-said-region': union_shapes([by1['EG03'], *[by2[c] for c in ['EG1901', 'EG1902', 'EG1903', 'EG1904', 'EG1101', 'EG1102', 'EG1105', 'EG1106', 'EG1108', 'EG1109']]])}
    return (adm1, adm2, coverage)

def locate(point, shapes, key):
    return next((s.properties[key] for s in shapes if s.covers(point)), None)

def osm_point(e):
    if 'lat' in e:
        return [e['lon'], e['lat']]
    if 'center' in e:
        return [e['center']['lon'], e['center']['lat']]
    return None
