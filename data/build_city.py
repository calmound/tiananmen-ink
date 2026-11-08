"""OSM city extract -> local metric city data for the map.

Usage:
  python3 build_city.py osm/axis-geometry.json osm/city-raw.json ../app/public/data/city.json [osm/city-walls.json]
  python3 build_city.py osm/axis-geometry.json osm/ring ../app/public/data/city.json     # whole 2nd Ring (tiles)
Same local frame as build_layout.py (metres, origin = Tiananmen outline centroid,
X east, Y up, Z south, rotated so the central axis runs along -Z). No lat/lon is written.
"""
import json, math, sys

import os
axis_src, city_src, out_path = sys.argv[1:4]
walls_src = sys.argv[4] if len(sys.argv) > 4 else None
RING_MODE = os.path.isdir(city_src)
R_LAT, R_LON = 110540.0, 111320.0
axis = {(e['type'], e['id']): e for e in json.load(open(axis_src))['elements']}

def centroid(geom):
    return sum(p['lat'] for p in geom) / len(geom), sum(p['lon'] for p in geom) / len(geom)

pts = []
for m in axis[('relation', 8847697)]['members']:
    if m['type'] == 'way' and 'geometry' in m: pts += m['geometry']
lat0, lon0 = centroid(pts)
k = math.cos(math.radians(lat0))
def raw(lat, lon): return ((lon - lon0) * R_LON * k, -(lat - lat0) * R_LAT)
wx, wz = raw(*centroid(axis[('way', 638156366)]['geometry']))
ang = math.atan2(wx, -wz)
C, S = math.cos(ang), math.sin(ang)
def loc(p):
    x, z = raw(p['lat'], p['lon'])
    return [round(x * C + z * S, 1), round(-x * S + z * C, 1)]

def area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2

def ring(geom):
    poly = [loc(p) for p in geom]
    if len(poly) > 1 and poly[0] == poly[-1]: poly = poly[:-1]
    return poly

def stitch(ways):
    """Join open outer ways of a multipolygon into closed rings."""
    pending = [w[:] for w in ways if len(w) > 1]
    rings = []
    while pending:
        chain = pending.pop(0)
        guard = 0
        while chain[0] != chain[-1] and guard < 500:
            guard += 1
            for i, w in enumerate(pending):
                if w[0] == chain[-1]: chain += w[1:]; pending.pop(i); break
                if w[-1] == chain[-1]: chain += w[::-1][1:]; pending.pop(i); break
            else: break
        if chain[0] == chain[-1] and len(chain) > 3: rings.append(chain[:-1])
    return rings

def outers(e):
    if e['type'] == 'way':
        return [ring(e['geometry'])] if 'geometry' in e and len(e['geometry']) > 3 else []
    ways = [[loc(p) for p in m['geometry']] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
    return stitch(ways)

def num(v):
    try: return float(str(v).replace('m', '').strip())
    except (TypeError, ValueError): return None

# Already modelled by the architecture kit (axis gates); their footprints are skipped.
KIT_IDS = {('relation', 8847697), ('way', 25097188), ('way', 638156366)}
# The three gates' outline extents in local metres (from axis-layout.json), with a small margin.
layout = json.load(open(axis_src.replace('osm/axis-geometry.json', 'axis-layout.json')))
kit_boxes = []
for parts in layout['gates'].values():
    xs = [v for p in parts for v in p['x']]; zs = [v for p in parts for v in p['z']]
    kit_boxes.append((min(xs) - 2, max(xs) + 2, min(zs) - 2, max(zs) + 2))
def in_kit(poly):
    cx = sum(p[0] for p in poly) / len(poly); cz = sum(p[1] for p in poly) / len(poly)
    return any(x0 <= cx <= x1 and z0 <= cz <= z1 for x0, x1, z0, z1 in kit_boxes)

# Step 1 of the map: Jingshan to Qianmen, out to the museum and the Great Hall on either side.
BOUNDS = (-800, 800, -2080, 1150)
def centre(poly): return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
def inside(poly):
    cx, cz = centre(poly)
    return BOUNDS[0] <= cx <= BOUNDS[1] and BOUNDS[2] <= cz <= BOUNDS[3]
# Restricted compound west of the palace (中南海): water only, no buildings or labels.
def restricted(poly):
    cx, cz = centre(poly)
    return cx < -650 and cz < 150

ROAD_WIDTH = {'trunk': 34, 'primary': 22, 'secondary': 15, 'tertiary': 11, 'unclassified': 7,
              'residential': 6, 'living_street': 5, 'pedestrian': 6}

out = {'bounds': BOUNDS, 'note': 'local metres; X east, Z south; axis along -Z; derived from OpenStreetMap (ODbL)',
       'buildings': [], 'roads': [], 'water': [], 'waterways': [], 'green': [], 'squares': [], 'skipped': {}}
skip = lambda reason: out['skipped'].__setitem__(reason, out['skipped'].get(reason, 0) + 1)
def load_elements():
    if not RING_MODE: return json.load(open(city_src))['elements']
    seen, elements = set(), []
    for name in sorted(os.listdir(city_src)):
        if not name.startswith('tile-'): continue
        for e in json.load(open(os.path.join(city_src, name)))['elements']:
            if (e['type'], e['id']) in seen: continue
            seen.add((e['type'], e['id'])); elements.append(e)
    return elements
ELEMENTS = load_elements()
WALL_ELEMENTS = [e for e in ELEMENTS if e.get('tags', {}).get('barrier') in ('wall', 'city_wall') or e.get('tags', {}).get('historic') == 'citywalls']
if RING_MODE:
    # Map extent = convex hull of the 2nd Ring Road; restricted compound = around 中海 / 南海.
    # The ring road comes with the tiles (trunk / motorway named …二环…).
    ring_pts = [loc(p) for e in ELEMENTS if '二环' in e.get('tags', {}).get('name', '') and 'highway' in e.get('tags', {})
                for p in e.get('geometry', [])]
    def hull(points):
        P = sorted(set(map(tuple, points)))
        cross = lambda o, a, b: (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
        lo, up = [], []
        for p in P:
            while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
            lo.append(p)
        for p in reversed(P):
            while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
            up.append(p)
        return lo[:-1] + up[:-1]
    RING = [list(p) for p in hull(ring_pts)]
    xs = [p[0] for p in RING]; zs = [p[1] for p in RING]
    BOUNDS = (round(min(xs)), round(max(xs)), round(min(zs)), round(max(zs)))
    def pip(pt, poly):
        x, z = pt; inside = False
        for i in range(len(poly)):
            (x1, z1), (x2, z2) = poly[i], poly[i - 1]
            if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1: inside = not inside
        return inside
    # Buildings on the ring road itself (德胜门箭楼, 永定门) sit just outside the hull: allow 160 m.
    rcx = sum(p[0] for p in RING) / len(RING); rcz = sum(p[1] for p in RING) / len(RING)
    def grow(p, d=160):
        x, z = p; dx, dz = x - rcx, z - rcz; L = math.hypot(dx, dz) or 1
        return [x + dx / L * d, z + dz / L * d]
    RING_MARGIN = [grow(p) for p in RING]
    BOUNDS = (round(min(p[0] for p in RING_MARGIN)), round(max(p[0] for p in RING_MARGIN)),
              round(min(p[1] for p in RING_MARGIN)), round(max(p[1] for p in RING_MARGIN)))
    def inside(poly): return pip(centre(poly), RING_MARGIN)
    lakes = [ring(e['geometry']) if e['type'] == 'way' else sum(outers(e), []) for e in ELEMENTS
             if e.get('tags', {}).get('name') in ('中海', '南海') and e.get('tags', {}).get('natural') == 'water']
    lake_pts = [p for l in lakes for p in l]
    RX0 = min(p[0] for p in lake_pts) - 170; RX1 = max(p[0] for p in lake_pts) + 60
    RZ0 = min(p[1] for p in lake_pts) + 20  # no margin north: 团城 / 北海 are public
    RZ1 = min(max(p[1] for p in lake_pts) + 60, 130)
    def restricted(poly):
        cx, cz = centre(poly)
        return RX0 <= cx <= RX1 and RZ0 <= cz <= RZ1
    print('ring bounds', BOUNDS, 'restricted box', round(RX0), round(RX1), round(RZ0), round(RZ1))
for e in ELEMENTS:
    t = e.get('tags', {})
    if 'building' in t:
        if (e['type'], e['id']) in KIT_IDS: skip('kit'); continue
        for poly in outers(e):
            if len(poly) < 3 or area(poly) < 6: skip('tiny'); continue
            if in_kit(poly): skip('kit-area'); continue
            if not inside(poly): skip('outside'); continue
            if restricted(poly): skip('restricted'); continue
            levels = num(t.get('building:levels'))
            out['buildings'].append({
                'id': e['id'], 'poly': poly, 'area': round(area(poly), 1),
                'name': t.get('name'), 'type': t.get('building'),
                'h': num(t.get('height')), 'levels': levels, 'min_h': num(t.get('min_height')),
                'roof': t.get('roof:shape'), 'historic': t.get('historic'), 'amenity': t.get('amenity'),
            })
    elif 'highway' in t and e['type'] == 'way' and 'geometry' in e:
        line = [loc(p) for p in e['geometry']]
        if not any(BOUNDS[0] - 300 <= x <= BOUNDS[1] + 300 and BOUNDS[2] - 300 <= z <= BOUNDS[3] + 300 for x, z in line): continue
        if RING_MODE and not any(pip(p, RING) for p in line): continue
        out['roads'].append({'cls': t['highway'], 'w': ROAD_WIDTH.get(t['highway'], 6), 'name': t.get('name'),
                             'line': line})
    elif t.get('natural') == 'water':
        for poly in outers(e):
            if RING_MODE and not inside(poly): continue
            out['water'].append({'name': t.get('name'), 'poly': poly})
    elif 'waterway' in t and e['type'] == 'way' and 'geometry' in e:
        if RING_MODE and not any(pip(p, RING) for p in [loc(q) for q in e['geometry']]): continue
        out['waterways'].append({'w': 8 if t['waterway'] in ('river', 'canal') else 3, 'line': [loc(p) for p in e['geometry']]})
    elif t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'forest'):
        for poly in outers(e):
            if not inside(poly) and (RING_MODE or area(poly) < 200000): continue
            out['green'].append({'name': t.get('name'), 'kind': t.get('leisure') or t.get('landuse'), 'poly': poly})
    elif t.get('place') == 'square':
        for poly in outers(e): out['squares'].append({'name': t.get('name'), 'poly': poly})

# Walls (barrier=wall / city_wall). The four sides of the Forbidden City and the imperial-city
# red wall are picked by way id; the rest are courtyard and park walls.
PALACE_WALLS = {638176319, 1341826250, 1341826249, 638252480}
IMPERIAL_WALLS = {637830346, 637959842, 638181589}
out['walls'] = []
if walls_src or RING_MODE:
    for e in (json.load(open(walls_src))['elements'] if walls_src else WALL_ELEMENTS):
        if e['type'] != 'way' or 'geometry' not in e: continue
        line = [loc(p) for p in e['geometry']]
        if not any(BOUNDS[0] - 50 <= x <= BOUNDS[1] + 50 and BOUNDS[2] - 50 <= z <= BOUNDS[3] + 50 for x, z in line): continue
        kind = 'palace' if e['id'] in PALACE_WALLS else 'imperial' if e['id'] in IMPERIAL_WALLS else 'other'
        if kind == 'other' and restricted(line): skip('restricted-wall'); continue
        if RING_MODE and kind == 'other' and not inside(line): continue
        t = e.get('tags', {})
        out['walls'].append({'id': e['id'], 'kind': kind, 'h': num(t.get('height')), 'line': line})

out['bounds'] = BOUNDS
if RING_MODE: out['ring'] = [[round(x, 1), round(z, 1)] for x, z in RING_MARGIN]  # hull + 160 m
json.dump(out, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print({k: len(v) for k, v in out.items() if isinstance(v, list)}, 'skipped', out['skipped'])
