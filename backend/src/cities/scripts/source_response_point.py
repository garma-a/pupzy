"""Offline exact point lookup in manifest-pinned Nominatim/Overpass research responses."""
# Importable via importlib; filename is also a documented standalone maintenance helper.
from geo_offline import load

def response_point(data, source):
    file = source['file']
    if file.startswith('/') or '..' in file.split('/'):
        raise ValueError('Invalid research source path')
    response = load(data / file)
    if isinstance(response, dict) and 'lookups' in response:
        lookups = [r for r in response['lookups'] if r['query'] == source['lookupQuery'] and (not source.get('area') or r['area'] == source['area'])]
        objects = [e for r in lookups for e in r['response']]
    elif isinstance(response, list):
        objects = response
    elif isinstance(response, dict) and 'elements' in response:
        objects = response['elements']
    else:
        objects = [response]
    identity = source['osmIdentity']
    matches = [e for e in objects if ('OSM:'+str(e.get('osm_type') or e.get('type'))+'/'+str(e.get('osm_id') or e.get('id'))) == identity]
    points = set()
    for element in matches:
        p = element.get('center', element)
        if p.get('lon') is not None and p.get('lat') is not None:
            points.add((float(p['lon']), float(p['lat'])))
    if len(points) != 1:
        raise ValueError('Research response point missing/ambiguous '+identity+' in '+file)
    return list(next(iter(points)))
