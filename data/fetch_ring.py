"""Fetch OSM data inside Beijing's 2nd Ring Road in tiles (Overpass API, ODbL).

Usage: python3 fetch_ring.py osm/ring
Writes ring-road.json and tile-<i>-<j>.json; existing tiles are skipped, so it can be re-run.
"""
import json, os, sys, time, urllib.parse, urllib.request

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
           'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
UA = 'case-study-ink-map/0.1 (local research; contact via repository owner)'
# 2nd Ring Road extent with a small margin.
S, W, N, E = 39.862, 116.340, 39.952, 116.448
ROWS, COLS = 3, 3

def run(query, path):
    if os.path.exists(path) and os.path.getsize(path) > 100:
        print('skip', path); return
    for attempt in range(12):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            data = urllib.parse.urlencode({'data': query}).encode()
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            json.loads(body)
            open(path, 'wb').write(body)
            print('ok', path, len(body), url); return
        except Exception as e:
            print('retry', path, url, str(e)[:80]); time.sleep(8 + attempt * 4)
    raise SystemExit(f'failed {path}')

run(f'[out:json][timeout:120];way["highway"]["name"~"二环"]({S - 0.01},{W - 0.01},{N + 0.01},{E + 0.01});out geom;', f'{OUT}/ring-road.json')
for i in range(ROWS):
    for j in range(COLS):
        s = S + (N - S) * i / ROWS; n = S + (N - S) * (i + 1) / ROWS
        w = W + (E - W) * j / COLS; e = W + (E - W) * (j + 1) / COLS
        b = f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'
        q = f'''[out:json][timeout:180];(
  way["building"]({b}); relation["building"]({b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|pedestrian|living_street)$"]({b});
  way["natural"="water"]({b}); relation["natural"="water"]({b}); way["waterway"]({b});
  way["leisure"~"^(park|garden)$"]({b}); relation["leisure"~"^(park|garden)$"]({b});
  way["landuse"~"^(grass|forest)$"]({b});
  way["place"="square"]({b}); relation["place"="square"]({b});
  way["barrier"~"^(wall|city_wall)$"]({b}); way["historic"="citywalls"]({b});
);out geom;'''
        run(q, f'{OUT}/tile-{i}-{j}.json')
