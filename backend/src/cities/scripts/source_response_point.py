"""Offline exact point lookup in manifest-pinned Nominatim/Overpass research responses."""
# Importable via importlib; filename is also a documented standalone maintenance helper.
from geo_offline import load
import re,json,gzip,html

def response_point(data, source):
    file = source['file']
    if file.startswith('/') or '..' in file.split('/'):
        raise ValueError('Invalid research source path')
    if source.get('selector') == 'wikidata':
        response=load(data/file)
        matches=[r for r in response['results']['bindings'] if r['item']['value'].endswith('/'+source['qid']) and r.get('coord',{}).get('value')==source['coordinate']]
        if not matches:raise ValueError('Recorded Wikidata coordinate absent')
        return list(map(float,re.fullmatch(r'Point\(([-0-9.]+) ([-0-9.]+)\)',source['coordinate']).groups()))
    if source.get('selector') == 'nextProject':
        raw=gzip.decompress((data/file).read_bytes()).decode('utf8')
        chunks=[]
        for match in re.finditer(r'self\.__next_f\.push\((\[.*?\])\)</script>',raw):
            try:
                array=json.loads(match[1])
                if len(array)>1 and isinstance(array[1],str):chunks.append(array[1])
            except ValueError:continue
        points=set()
        def walk(obj):
            if isinstance(obj,dict):
                if obj.get('PageUid')==source['pageUid'] and obj.get('PageTitle')==source['pageTitle'] and obj.get('Latitude') and obj.get('Longitude'):
                    points.add((float(obj['Longitude']),float(obj['Latitude'])))
                for value in obj.values():walk(value)
            elif isinstance(obj,list):
                for value in obj:walk(value)
        for line in ''.join(chunks).splitlines():
            try:walk(json.loads(line.split(':',1)[1]))
            except (ValueError,IndexError):continue
        if len(points)!=1:raise ValueError('Missing/ambiguous recorded named project coordinate '+file)
        return list(next(iter(points)))
    if source.get('selector') in {'jsonld','mapCentre'}:
        raw=gzip.decompress((data/file).read_bytes()).decode('utf8')
        points=set()
        if source['selector']=='mapCentre':
            for url in re.findall(r'<iframe[^>]+src=["\']([^"\']+)',raw):
                m=re.search(r'!2d([-0-9.]+)!3d([-0-9.]+)',url)
                if m:points.add((float(m[1]),float(m[2])))
        else:
            def walk(obj):
                if isinstance(obj,list):
                    for value in obj:yield from walk(value)
                elif isinstance(obj,dict):
                    yield obj
                    for value in obj.values():yield from walk(value)
            for snippet in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',raw,re.S):
                try:objects=walk(json.loads(html.unescape(snippet)))
                except ValueError:continue
                for obj in objects:
                    if obj.get('@type')==source['schemaType'] and obj.get('name')==source['schemaName']:
                        geo=obj.get('geo',{})
                        if geo.get('latitude') is not None and geo.get('longitude') is not None:
                            points.add((float(geo['longitude']),float(geo['latitude'])))
        if len(points)!=1:raise ValueError('Ambiguous/missing recorded HTML coordinate '+file)
        return list(next(iter(points)))
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
