"""OSM axis geometry -> local axis-aligned layout.

Usage: python3 build_layout.py osm/axis-geometry.json axis-layout.json
Local frame: metres, origin = Tiananmen outline centroid, X east, Y up, Z south,
rotated so the central axis runs along -Z.
"""
import json, math, sys
src = sys.argv[1]
d = json.load(open(src))
els = {(e['type'], e['id']): e for e in d['elements']}
R_LAT, R_LON = 110540.0, 111320.0

def centroid(geom):
    xs = [p['lon'] for p in geom]; ys = [p['lat'] for p in geom]
    return sum(ys)/len(ys), sum(xs)/len(xs)

# origin: Tiananmen outline multipolygon outer ways
tam = els[('relation', 8847697)]
pts = []
for m in tam['members']:
    if m['type'] == 'way' and 'geometry' in m: pts += m['geometry']
lat0, lon0 = centroid(pts)
k = math.cos(math.radians(lat0))
def raw(lat, lon): return ((lon-lon0)*R_LON*k, -(lat-lat0)*R_LAT)   # x east, z south

# axis angle from Tiananmen centroid to Wumen centroid
wu = els[('way', 638156366)]
wx, wz = raw(*centroid(wu['geometry']))
ang = math.atan2(wx, -wz)   # angle of north direction from -z
def loc(lat, lon):
    x, z = raw(lat, lon)
    c, s = math.cos(ang), math.sin(ang)
    return (x*c + z*s, -x*s + z*c)
print('origin', round(lat0,6), round(lon0,6), 'axis rotation deg', round(math.degrees(ang),2))

def bbox(geom):
    P = [loc(p['lat'], p['lon']) for p in geom]
    xs=[p[0] for p in P]; zs=[p[1] for p in P]
    return min(xs), max(xs), min(zs), max(zs)

out = {'origin_note': 'local metres, origin = Tiananmen outline centroid, X east, Z south, rotated so the axis is -Z', 'axis_rotation_deg': round(math.degrees(ang),2), 'gates': {}, 'bridges': [], 'columns': []}
for rid, name in [(8847698,'tiananmen'), (8848564,'duanmen'), (8849989,'wumen')]:
    rel = els[('relation', rid)]; parts=[]
    for m in rel['members']:
        if m['type']=='way':
            w = els.get(('way', m['ref']))
            if not w or 'geometry' not in w: continue
            t = w.get('tags', {})
            x0,x1,z0,z1 = bbox(w['geometry'])
            poly = [[round(a,2) for a in loc(q['lat'], q['lon'])] for q in w['geometry']]
            parts.append({'role': m['role'], 'id': w['id'], 'poly': poly, 'x': [round(x0,1), round(x1,1)], 'z': [round(z0,1), round(z1,1)],
                          'w': round(x1-x0,1), 'd': round(z1-z0,1),
                          'min_h': float(t.get('min_height', 0)), 'h': float(t['height']) if 'height' in t else None,
                          'roof': t.get('roof:shape'),
                          'roof_dir': (round((float(t['roof:direction']) - math.degrees(ang)) % 360, 1) if 'roof:direction' in t else None),
                          'roof_orientation': t.get('roof:orientation'), 'roof_h': float(t['roof:height']) if 'roof:height' in t else None,
                          'material': t.get('building:material'), 'colour': t.get('building:colour')})
    if name == 'tiananmen':
        outer = []
        for m in tam['members']:
            if m['type'] == 'way' and 'geometry' in m: outer.append([[round(a,2) for a in loc(q['lat'], q['lon'])] for q in m['geometry']])
        allp = [p for ring in outer for p in ring]
        xs=[p[0] for p in allp]; zs=[p[1] for p in allp]
        parts.append({'role': 'platform', 'id': 8847697, 'rings': outer, 'x': [round(min(xs),1), round(max(xs),1)], 'z': [round(min(zs),1), round(max(zs),1)],
                      'w': round(max(xs)-min(xs),1), 'd': round(max(zs)-min(zs),1), 'min_h': 0.0, 'h': 13.0, 'h_estimated': True,
                      'roof': None, 'roof_h': None, 'material': 'brick', 'colour': 'firebrick', 'note': 'footprint from outline multipolygon; height copied from Duanmen platform, verify'})
    out['gates'][name] = parts
for wid in [29241072,29241106,29241112,29241129,523763741,41439019,41439020,41439021,41439022,41439023]:
    w = els.get(('way', wid))
    if not w: continue
    x0,x1,z0,z1 = bbox(w['geometry'])
    out['bridges'].append({'name': w['tags'].get('name'), 'x': round((x0+x1)/2,1), 'z': [round(z0,1), round(z1,1)], 'len': round(z1-z0,1)})
for nid in [6013096562,6013107811,6015523774,6015524394]:
    n = els[('node', nid)]; x,z = loc(n['lat'], n['lon'])
    out['columns'].append({'x': round(x,1), 'z': round(z,1), 'h': 11})
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)

for name, parts in out['gates'].items():
    print('==', name)
    for p in sorted(parts, key=lambda p: (p['min_h'], p['h'] or 0)):
        print(f"  {p['role']:7} w={p['w']:6} d={p['d']:6} x={p['x']} z={p['z']} h={p['min_h']}->{p['h']} roof={p['roof']} rh={p['roof_h']} {p['material'] or ''} {p['colour'] or ''}")
print('== bridges'); [print(' ', b) for b in sorted(out['bridges'], key=lambda b:(b['name'], b['x']))]
print('== columns'); [print(' ', c) for c in out['columns']]
