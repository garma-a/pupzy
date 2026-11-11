"""Recorded named-city geometry supplements; no guessed points or buffers."""
from geo_offline import load, Shape, union_shapes, output, intersect, ctx, api, C

def source_shape(data, item):
    response=load(data/item['sourceFile'])
    identity=item['osmSourceCode'];kind,ident=identity.removeprefix('OSM:').split('/')
    obj=next(e for e in response['elements'] if e['type']==kind and e['id']==int(ident))
    if 'geometry' in obj:
        points=[[p['lon'],p['lat']] for p in obj['geometry']]
    else:
        nodes={e['id']:[e['lon'],e['lat']] for e in response['elements'] if e['type']=='node'}
        points=[nodes[n] for n in obj['nodes']]
    if points[0]!=points[-1]:raise ValueError('Supplement is not a closed source polygon')
    return Shape({'type':'Polygon','coordinates':[points]})

def apply_supplements(data,adm1,adm2):
    path=data/'boundary-supplements.json'
    if not path.exists():return adm1,adm2
    policy=load(path)
    if not policy['reviewed']:raise ValueError('Unreviewed boundary supplement')
    diff=api('GEOSDifference',C.c_void_p,C.c_void_p,C.c_void_p)
    full=union_shapes(adm1)
    for item in policy['items']:
        shape=source_shape(data,item)
        # Only fill an existing water/coast gap: never reassign existing land.
        extra=Shape(output(diff(ctx,shape.geom,full.geom)))
        adm1=[Shape(union_shapes([s,extra]).value,s.properties) if s.properties['adm1_pcode']==item['governorateCode'] else s for s in adm1]
        adm2=[Shape(union_shapes([s,extra]).value,s.properties) if s.properties['adm2_pcode']==item['districtSourceCode'] else s for s in adm2]
    return adm1,adm2
