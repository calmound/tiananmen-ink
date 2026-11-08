import { Group, Mesh } from 'three/webgpu';
import type { Point } from '../data/layout';
import type { HallPlan } from '../config/gates';
import { WALLS } from '../config/landmarks';
import type { CityData, Label } from './city';
import { terrainY } from './city';
import type { SceneMaterials, ValueKey } from './materials';
import { emptyBucket, grid, mergeSlot, type Bucket, type Slot, type V3 } from './kit/build';
import { buildHall } from './kit/hall';
import { KIT_DEFAULTS } from './kit/roof';

// Walls from OSM (barrier=wall / city_wall): the Forbidden City's battered city wall with
// parapets and four corner towers, the imperial red wall, and courtyard / park walls with a
// small tiled coping. Heights: see WALLS in config/landmarks.ts.

type Kind = 'palace' | 'imperial' | 'palaceCourt' | 'other';
const inPalace = (x: number, z: number) => Math.abs(x) < 410 && z < -20 && z > -1560;

/** Offsets either side of a polyline at each point (miter-free, like a road ribbon). */
function sides(line: Point[], half: number) {
  return line.map(([x, z], i) => {
    const [px, pz] = line[Math.max(0, i - 1)], [nx, nz] = line[Math.min(line.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    return { l: [x - dz * half, z + dx * half] as Point, r: [x + dz * half, z - dx * half] as Point };
  });
}
const along = (line: Point[]) => {
  let d = 0;
  return line.map((p, i) => (i ? (d += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1])) : 0));
};

/** A battered wall band: outer faces, top, and the rows are wound so normals face out. */
function band(out: Bucket, slot: Slot, topSlot: Slot, line: Point[], base: number, top: number, height: number, lift = 0) {
  const lower = sides(line, base / 2), upper = sides(line, top / 2);
  const ys = line.map(([x, z]) => terrainY(x, z) + lift);
  const at = (p: Point, y: number): V3 => [p[0], y, p[1]];
  const u = along(line);
  const row = (pick: (i: number) => V3) => line.map((_, i) => pick(i));
  const uv = (v: number) => u.map(x => [x, v] as [number, number]);
  const bl = row(i => at(lower[i].l, ys[i])), tl = row(i => at(upper[i].l, ys[i] + height));
  const br = row(i => at(lower[i].r, ys[i])), tr = row(i => at(upper[i].r, ys[i] + height));
  out[slot].push(grid([tl, bl], [uv(1), uv(0)]));
  out[slot].push(grid([br, tr], [uv(0), uv(1)]));
  out[topSlot].push(grid([tr, tl], [uv(0.275), uv(0.275)]));
  return { tl, tr, ys };
}

/** Two-slope tiled coping along a wall top. */
function coping(out: Bucket, line: Point[], width: number, y: number[], rise: number) {
  const s = sides(line, width / 2);
  const u = along(line);
  const ridge = line.map(([x, z], i) => [x, y[i] + rise, z] as V3);
  const l = s.map((p, i) => [p.l[0], y[i], p.l[1]] as V3), r = s.map((p, i) => [p.r[0], y[i], p.r[1]] as V3);
  const uv = (v: number) => u.map(x => [x, v] as [number, number]);
  out.roof.push(grid([ridge, l], [uv(0), uv(1)]));
  out.roof.push(grid([r, ridge], [uv(1), uv(0)]));
}

function cornerTowers(out: Bucket, walls: Point[][]) {
  const xs = walls.flat().map(p => p[0]), zs = walls.flat().map(p => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const base = WALLS.palace.height, ridge = WALLS.cornerTower.height;
  const H = ridge - base;
  // TODO(verify): the real 角楼 has a complex cross-shaped roof; two crossing 歇山 halls stand in for it.
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    const inset = WALLS.palace.top / 2;
    const x = cx + Math.sign(-cx) * inset, z = cz + Math.sign((z0 + z1) / 2 - cz) * inset;
    // TODO(verify): plan size of the towers.
    for (const [hx, hz] of [[9.5, 5.5], [5.5, 9.5]]) {
      const body = { cx: x, cz: z, hx, hz };
      const plan: HallPlan = { id: 'corner-tower', gate: 'tiananmen', roof: 'xieshan', bays: [3, 1], baseY: base, body,
        top: { outer: { ...body, hx: hx + 2.6, hz: hz + 2.6 }, eaveY: base + 0.42 * H, ridgeY: ridge }, notes: [] };
      buildHall(out, KIT_DEFAULTS, plan);
    }
  }
  return { x0, x1, z0, z1 };
}

export function createCityWalls(city: CityData, materials: SceneMaterials) {
  const root = new Group();
  root.name = 'walls';
  const out = emptyBucket();
  const counts: Record<Kind, number> = { palace: 0, imperial: 0, palaceCourt: 0, other: 0 };
  const palaceLines: Point[][] = [];
  for (const w of city.walls ?? []) {
    if (w.line.length < 2) continue;
    const mid = w.line[Math.floor(w.line.length / 2)];
    const kind: Kind = w.kind === 'palace' ? 'palace' : w.kind === 'imperial' ? 'imperial' : inPalace(mid[0], mid[1]) ? 'palaceCourt' : 'other';
    counts[kind]++;
    const d = WALLS[kind];
    // OSM wall heights under 2 m are not usable here (0.5 m on the palace walls, for example).
    const height = kind === 'other' || kind === 'palaceCourt' ? (w.h && w.h >= 2 ? w.h : d.height) : d.height;
    if (kind === 'palace') {
      palaceLines.push(w.line);
      band(out, 'platform', 'stone', w.line, d.base, d.top, height);
      // Parapets on both edges of the wall walk (crenellations are left to the ink lines).
      for (const offset of [-1, 1]) {
        const edge = sides(w.line, d.top / 2 - 0.35).map(s => offset < 0 ? s.l : s.r);
        band(out, 'platform', 'stone', edge, 0.7, 0.6, 1.5, height);
      }
    } else {
      const slot: Slot = kind === 'other' ? 'brick' : 'platform';
      const { ys } = band(out, slot, 'stone', w.line, d.base, d.top, height);
      coping(out, w.line, d.top + 0.8, ys.map(y => y + height), Math.max(0.35, d.top * 0.4));
    }
  }
  const palace = palaceLines.length ? cornerTowers(out, palaceLines) : null;
  const labels: Label[] = palace ? [[palace.x0, palace.z0], [palace.x1, palace.z0], [palace.x0, palace.z1], [palace.x1, palace.z1]]
    .map(([x, z], i) => ({ name: '角楼', tier: (i === 1 ? 2 : 3) as 2 | 3, position: [x, WALLS.cornerTower.height + 4, z] as V3, size: 22,
      info: { kind: '城墙角楼', height: WALLS.cornerTower.height, heightFrom: 'known' as const, source: WALLS.cornerTower.source } })) : [];
  for (const slot of Object.keys(out) as Slot[]) {
    const geometry = mergeSlot(out[slot]);
    if (!geometry) continue;
    const mesh = new Mesh(geometry, materials[slot as ValueKey]);
    mesh.name = `walls-${slot}`;
    mesh.userData = { slot };
    root.add(mesh);
  }
  return { root, counts, palace, labels };
}
