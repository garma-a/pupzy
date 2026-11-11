'Small offline GEOS adapter. Uses the system GEOS library also required by PostGIS.\nNo pip dependencies, installs, network or coordinate guessing.\n'

import ctypes as C

import ctypes.util

import json

import math

import gzip

import subprocess

from pathlib import Path

geos_library = ctypes.util.find_library('geos_c')
if not geos_library:
    raise RuntimeError('Offline geography preprocessing requires the system GEOS C library; ordinary verification reads the committed geometry snapshots.')
lib = C.CDLL(geos_library)

def api(name, result, *args):
    fn = getattr(lib, name + '_r')
    fn.restype = result
    fn.argtypes = [C.c_void_p, *args]
    return fn

lib.GEOS_init_r.restype = C.c_void_p

ctx = lib.GEOS_init_r()

reader_new = api('GEOSGeoJSONReader_create', C.c_void_p)

read_geom = api('GEOSGeoJSONReader_readGeometry', C.c_void_p, C.c_void_p, C.c_char_p)

writer_new = api('GEOSGeoJSONWriter_create', C.c_void_p)

write_geom = api('GEOSGeoJSONWriter_writeGeometry', C.c_void_p, C.c_void_p, C.c_void_p, C.c_int)

free = api('GEOSFree', None, C.c_void_p)

reader = reader_new(ctx)

writer = writer_new(ctx)

prepare = api('GEOSPrepare', C.c_void_p, C.c_void_p)

prepared_covers = api('GEOSPreparedCovers', C.c_byte, C.c_void_p, C.c_void_p)

prepared_intersects = api('GEOSPreparedIntersects', C.c_byte, C.c_void_p, C.c_void_p)

intersect = api('GEOSIntersection', C.c_void_p, C.c_void_p, C.c_void_p)

union = api('GEOSUnion', C.c_void_p, C.c_void_p, C.c_void_p)

valid = api('GEOSMakeValid', C.c_void_p, C.c_void_p)

empty = api('GEOSisEmpty', C.c_byte, C.c_void_p)

point_on_surface = api('GEOSPointOnSurface', C.c_void_p, C.c_void_p)

centroid = api('GEOSGetCentroid', C.c_void_p, C.c_void_p)

area_fn = api('GEOSArea', C.c_int, C.c_void_p, C.POINTER(C.c_double))

destroy = api('GEOSGeom_destroy', None, C.c_void_p)

def load(path):
    path = Path(path)
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_text())

def save(path, value):
    path = Path(path)
    data = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    root = Path(__file__).resolve().parents[3]
    if path.suffix == '.json' and path.resolve().is_relative_to((root / 'src/cities/data').resolve()):
        data = subprocess.check_output(['node', str(root / 'node_modules/prettier/bin/prettier.cjs'), '--parser', 'json', '--config', str(root / '.prettierrc')], input=data)
    if path.exists():
        existing = gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes()
        if existing == data:
            return
    path.write_bytes(gzip.compress(data, compresslevel=9, mtime=0) if path.suffix == '.gz' else data)

def geometry(value):
    result = read_geom(ctx, reader, json.dumps(value, separators=(',', ':')).encode())
    if not result:
        raise ValueError('GEOS could not read geometry')
    return result

def output(g):
    ptr = write_geom(ctx, writer, g, 0)
    if not ptr:
        raise ValueError('GEOS serialization failed')
    result = json.loads(C.string_at(ptr))
    free(ctx, ptr)
    return result

def coords(value):
    if value and isinstance(value[0], (int, float)):
        yield value
    else:
        for child in value:
            yield from coords(child)

def bbox(value):
    points = list(coords(value['coordinates']))
    return [min((p[0] for p in points)), min((p[1] for p in points)), max((p[0] for p in points)), max((p[1] for p in points))]

class Shape:

    def __init__(self, value, properties=None):
        self.value = value
        self.geom = geometry(value)
        self.prepared = prepare(ctx, self.geom)
        self.bounds = bbox(value)
        self.properties = properties or {}

    def covers(self, p):
        x, y = p
        a, b, c, d = self.bounds
        if not (a - 1e-10 <= x <= c + 1e-10 and b - 1e-10 <= y <= d + 1e-10):
            return False
        point = geometry({'type': 'Point', 'coordinates': p})
        result = prepared_covers(ctx, self.prepared, point) == 1
        destroy(ctx, point)
        return result

    def representative(self):
        result = point_on_surface(ctx, self.geom)
        point = output(result)['coordinates']
        destroy(ctx, result)
        return point

    def center(self):
        result = centroid(ctx, self.geom)
        point = output(result)['coordinates']
        destroy(ctx, result)
        return point

def union_shapes(shapes):
    result = shapes[0].geom
    for shape in shapes[1:]:
        result = union(ctx, result, shape.geom)
        if not result:
            raise ValueError('Invalid polygon union')
    return Shape(output(result))

def rectangle(w, s, e, n):
    return Shape({'type': 'Polygon', 'coordinates': [[[w, s], [e, s], [e, n], [w, n], [w, s]]]})

def distance(a, b):
    x1, y1, x2, y2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((y2 - y1) / 2) ** 2 + math.cos(y1) * math.cos(y2) * math.sin((x2 - x1) / 2) ** 2
    return 6371008.8 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))

nearest_points = api('GEOSNearestPoints', C.c_void_p, C.c_void_p, C.c_void_p)

coord_x = api('GEOSCoordSeq_getX', C.c_int, C.c_void_p, C.c_uint, C.POINTER(C.c_double))

coord_y = api('GEOSCoordSeq_getY', C.c_int, C.c_void_p, C.c_uint, C.POINTER(C.c_double))

seq_destroy = api('GEOSCoordSeq_destroy', None, C.c_void_p)

def polygon_distance(point, shape):
    """Nearest edge in a local equirectangular metric, verified with great-circle metres.
    Same calculation as coverage.ts; never choose an edge using unscaled degree distance.
    """
    if shape.covers(point):
        return 0.0
    if not hasattr(shape, '_edges'):
        rings = shape.value['coordinates'] if shape.value['type'] == 'Polygon' else [r for p in shape.value['coordinates'] for r in p]
        shape._edges = [(a, b, b[0] - a[0], b[1] - a[1]) for ring in rings for a, b in zip(ring, ring[1:])]
    scale = math.cos(math.radians(point[1])) ** 2
    best = float('inf')
    for a, b, dx, dy in shape._edges:
        t = max(0, min(1, ((point[0] - a[0]) * dx * scale + (point[1] - a[1]) * dy) / (dx * dx * scale + dy * dy or 1)))
        candidate = [a[0] + t * dx, a[1] + t * dy]
        metric = ((point[0] - candidate[0]) ** 2 * scale + (point[1] - candidate[1]) ** 2) ** 0.5 * 111195
        if metric < best * 1.001:
            best = min(best, distance(point, candidate))
    return best

def polygonal(value):
    if value['type'] in ['Polygon', 'MultiPolygon']:
        return value
    polys = []
    for g in value.get('geometries', []):
        result = polygonal(g)
        if result:
            polys.extend([result['coordinates']] if result['type'] == 'Polygon' else result['coordinates'])
    return {'type': 'MultiPolygon', 'coordinates': polys} if polys else None

def osm_geometry(e):
    if e['type'] == 'way':
        ring = [[p['lon'], p['lat']] for p in e.get('geometry', []) if 'lon' in p]
        return {'type': 'Polygon', 'coordinates': [ring]} if len(ring) >= 4 and ring[0] == ring[-1] else None
    parts = {'outer': [], 'inner': []}
    for m in e.get('members', []):
        points = [[p['lon'], p['lat']] for p in m.get('geometry', []) if 'lon' in p]
        if len(points) > 1:
            parts['inner' if m.get('role') == 'inner' else 'outer'].append(points)

    def rings(lines):
        found = []
        while lines:
            ring = lines.pop()
            while ring[-1] != ring[0]:
                match = next(((i, p, rev) for i, p in enumerate(lines) for rev in [False, True] if (p[-1] if rev else p[0]) == ring[-1]), None)
                if not match:
                    break
                i, p, rev = match
                lines.pop(i)
                ring.extend((list(reversed(p)) if rev else p)[1:])
            if len(ring) >= 4 and ring[0] == ring[-1]:
                found.append(ring)
        return found
    outer = rings(parts['outer'])
    inner = rings(parts['inner'])
    polys = []
    for ring in outer:
        shape = Shape({'type': 'Polygon', 'coordinates': [ring]})
        holes = [h for h in inner if shape.covers(h[0])]
        polys.append([ring, *holes])
    return {'type': 'MultiPolygon', 'coordinates': polys} if polys else None

def nearest_polygon_point(point, shape):
    geom = geometry({'type': 'Point', 'coordinates': point})
    seq = nearest_points(ctx, geom, shape.geom)
    x = C.c_double()
    y = C.c_double()
    coord_x(ctx, seq, 1, C.byref(x))
    coord_y(ctx, seq, 1, C.byref(y))
    seq_destroy(ctx, seq)
    destroy(ctx, geom)
    return [x.value, y.value]
