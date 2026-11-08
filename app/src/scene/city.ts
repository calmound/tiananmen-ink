import {
  CircleGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, PlaneGeometry, SphereGeometry, type BufferGeometry, type MeshBasicNodeMaterial,
} from 'three/webgpu';
import { attribute, float, positionLocal, uniformArray } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AXIS_X, layout, type Point } from '../data/layout';
import type { HallPlan, Rect, RoofType } from '../config/gates';
import { AREAS, JINGSHAN, LANDMARKS, type LandmarkSpec } from '../config/landmarks';
import type { SceneMaterials, ValueKey } from './materials';
import { beam, emptyBucket, grid, mergeSlot, type Bucket, type Slot, type V3 } from './kit/build';
import { box, buildHall } from './kit/hall';
import { cap, walls } from './kit/platform';
import { buildRoof, KIT_DEFAULTS, LITE_STYLE } from './kit/roof';

// The map's city layer (OSM, ODbL): ordinary roofs are generated from footprints,
// landmarks use the architecture kit, and every item is grouped into 400 m tiles.

export interface CityBuilding {
  id: number; poly: Point[]; area: number; name: string | null; type: string | null;
  h: number | null; levels: number | null; min_h: number | null; roof: string | null;
}
export interface CityData {
  bounds: [number, number, number, number];
  buildings: CityBuilding[];
  roads: { cls: string; w: number; name: string | null; line: Point[] }[];
  water: { name: string | null; poly: Point[] }[];
  waterways: { w: number; line: Point[] }[];
  green: { name: string | null; kind: string; poly: Point[] }[];
  squares: { name: string | null; poly: Point[] }[];
  walls?: { id: number; kind: 'palace' | 'imperial' | 'other'; h: number | null; line: Point[] }[];
  /** 2nd Ring outline (convex hull of the ring road), when the data covers the whole ring. */
  ring?: Point[];
}

/** What the info card may show: only measured, mapped or clearly-marked estimated facts. */
export interface LabelInfo {
  kind: string;
  height?: number;
  /** 'known' = published figure (with source), 'osm' = OpenStreetMap tag, 'estimate' = our rule / placeholder. */
  heightFrom?: 'known' | 'osm' | 'estimate';
  source?: string;
  /** Footprint of the oriented bounding rectangle, metres. */
  footprint?: [number, number];
}
export interface Label { name: string; tier: 1 | 2 | 3; position: V3; size: number; info?: LabelInfo }

const KIND_NAMES: Record<string, string> = { hall: '宫殿建筑', gate: '城楼', modern: '现代建筑', monument: '纪念碑', dome: '现代建筑', stupa: '佛塔' };

const TILE = 400;
/** Tree cards are cheap instances (4 vertices each); the budget is shared out over the parks by area. */
export const TREE_BUDGET = 32000;
/** Thickness of the sandbox plinth in metres (a drawing choice: ~3 % of its width, so it reads as a model). */
export const PLINTH_DEPTH = 300;

// ── geometry helpers ─────────────────────────────────────────────────────
export function centroid(poly: Point[]): Point {
  return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
}
function hull(points: Point[]) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** Minimum-area oriented rectangle: centre, half sizes (a ≥ b) and the long axis angle in the x–z plane. */
export function orientedRect(poly: Point[]) {
  const h = hull(poly);
  let best = { area: Infinity, cx: 0, cz: 0, a: 0, b: 0, angle: 0 };
  for (let i = 0; i < h.length; i++) {
    const [x0, z0] = h[i], [x1, z1] = h[(i + 1) % h.length];
    const angle = Math.atan2(z1 - z0, x1 - x0);
    const c = Math.cos(angle), s = Math.sin(angle);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of h) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = { area, cx: uc * c - vc * s, cz: uc * s + vc * c,
        a: (long ? u1 - u0 : v1 - v0) / 2, b: (long ? v1 - v0 : u1 - u0) / 2, angle: long ? angle : angle + Math.PI / 2 };
    }
  }
  return best;
}
export const polygonArea = (poly: Point[]) => Math.abs(poly.reduce((s, [x0, z0], i) => {
  const [x1, z1] = poly[(i + 1) % poly.length]; return s + x0 * z1 - x1 * z0;
}, 0)) / 2;
export function pointInPolygon([x, z]: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** 景山: a smooth placeholder hill (TODO(verify)). */
export function terrainY(x: number, z: number) {
  const d = Math.hypot(x - JINGSHAN.centre[0], z - JINGSHAN.centre[1]) / JINGSHAN.radius;
  return d >= 1 ? 0 : JINGSHAN.height * 0.5 * (1 + Math.cos(Math.PI * d));
}

function ribbon(line: Point[], width: number, y: number) {
  const half = width / 2;
  const left: V3[] = [], right: V3[] = [];
  line.forEach(([x, z], i) => {
    const [px, pz] = line[Math.max(0, i - 1)], [nx, nz] = line[Math.min(line.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    left.push([x - dz * half, y, z + dx * half]);
    right.push([x + dz * half, y, z - dx * half]);
  });
  const uv = (row: V3[], v: number) => row.map((_, i) => [i, v] as [number, number]);
  return grid([left, right], [uv(left, 0), uv(right, 1)], [0, 1, 0]);
}

// ── classification ───────────────────────────────────────────────────────
const MODERN_NAME = /大会堂|宾馆|博物馆|美术馆|展览馆|纪念堂|剧院|大厦|医院|中学|学校|办公|号楼|教学|门诊|住院|科研|商业|中心|书店|派出所|办事处|新馆|公安部|常委会|饭店|酒店|银行/;
const OLD_NAME = /[殿宫门楼亭阁堂馆斋坛庙寺轩房所台]$/;
const MODERN_TYPES = new Set(['hospital', 'school', 'university', 'commercial', 'retail', 'apartments', 'office', 'hotel', 'industrial', 'train_station']);

const UNTAGGED = (b: CityBuilding) => !b.levels && !b.h && (!b.type || ['yes', 'house', 'residential', 'roof', 'bungalow', 'gate', 'gatehouse', 'guardhouse', 'temple', 'palace'].includes(b.type));
/** How much of its oriented bounding rectangle a footprint fills (1 = a plain rectangle). */
const fillOf = (b: CityBuilding, r = orientedRect(b.poly)) => b.area / Math.max(1e-6, 4 * r.a * r.b);

function isTraditional(b: CityBuilding, [cx, cz]: Point) {
  if (b.roof && ['hipped', 'gabled', 'pyramidal'].includes(b.roof)) return true;
  if (b.name && MODERN_NAME.test(b.name)) return false;
  if (b.type && MODERN_TYPES.has(b.type)) return false;
  if ((b.levels ?? 0) >= 4 || (b.h ?? 0) >= 15) return false;
  if (b.name && OLD_NAME.test(b.name)) return true;
  // Central area north of Chang'an Avenue (palace, temples) defaults to old; elsewhere only
  // small untagged houses (hutong courtyards) do.
  const central = Math.abs(cx) < 800 && cz > -2100;
  if (central && cz < 40) return true;
  if (!UNTAGGED(b)) return false;
  if (b.area < 420) return true;
  // A whole courtyard house mapped as one L/U-shaped outline: mid-sized, untagged, far from
  // rectangular. TODO(verify): a rule of thumb, not survey data.
  return b.area < 2500 && fillOf(b) < 0.65;
}

type ORect = ReturnType<typeof orientedRect>;

/**
 * Split an irregular footprint (courtyard L / U shapes) into a few rectangles, each to carry
 * its own roof: rasterise in the footprint's own frame, then take the largest filled rectangle
 * again and again. Rectangles thinner than `minSide` metres are not roofs.
 */
function rectangles(poly: Point[], frame: ORect, cell = 1.5, minSide = 2.8, max = 8): ORect[] {
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle);
  const local = poly.map(([x, z]) => { const dx = x - frame.cx, dz = z - frame.cz; return [dx * c + dz * s, -dx * s + dz * c] as Point; });
  const nu = Math.ceil(2 * frame.a / cell), nv = Math.ceil(2 * frame.b / cell);
  if (nu * nv > 8000 || nu < 2 || nv < 2) return [];
  const filled = new Uint8Array(nu * nv);
  let total = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const on = pointInPolygon([-frame.a + (i + 0.5) * cell, -frame.b + (j + 0.5) * cell], local) ? 1 : 0;
    filled[j * nu + i] = on; total += on;
  }
  const minCells = Math.ceil(minSide / cell);
  const heights = new Int32Array(nu + 1);
  const result: ORect[] = [];
  let covered = 0;
  for (let n = 0; n < max && covered < total * 0.92; n++) {
    let best = { area: 0, i0: 0, i1: 0, j0: 0, j1: 0 };
    heights.fill(0);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) heights[i] = filled[j * nu + i] ? heights[i] + 1 : 0;
      const stack: number[] = [];
      for (let i = 0; i <= nu; i++) {
        const h = i < nu ? heights[i] : 0;
        while (stack.length && heights[stack[stack.length - 1]] >= h) {
          const hh = heights[stack.pop()!];
          const left = stack.length ? stack[stack.length - 1] + 1 : 0;
          const w = i - left;
          if (w >= minCells && hh >= minCells && w * hh > best.area) best = { area: w * hh, i0: left, i1: i, j0: j - hh + 1, j1: j + 1 };
        }
        stack.push(i);
      }
    }
    if (best.area * cell * cell < 14) break;
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) filled[j * nu + i] = 0;
    covered += best.area;
    const uc = -frame.a + (best.i0 + best.i1) / 2 * cell, vc = -frame.b + (best.j0 + best.j1) / 2 * cell;
    const hu = (best.i1 - best.i0) * cell / 2, hv = (best.j1 - best.j0) * cell / 2;
    result.push({ area: 4 * hu * hv, cx: frame.cx + uc * c - vc * s, cz: frame.cz + uc * s + vc * c,
      a: Math.max(hu, hv), b: Math.min(hu, hv), angle: hu >= hv ? frame.angle : frame.angle + Math.PI / 2 });
  }
  return result;
}

/**
 * A plain gabled house (硬山) in very few triangles, for the far level of detail: walls up to the
 * eave, gable ends, two slopes with a small overhang, and optionally a dark ridge.
 */
function gableHouse(out: Bucket, wallSlot: Slot, r: ORect, y0: number, eave: number, ridge: number, ridgeBeam = false) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  const P = (u: number, y: number, v: number): V3 => [r.cx + u * c - v * s, y, r.cz + u * s + v * c];
  const dir = (u: number, y: number, v: number): V3 => [u * c - v * s, y, u * s + v * c];
  const { a, b } = r;
  const sides: [number, number, number, number, number, number][] = [[-a, b, a, b, 0, 1], [a, -b, -a, -b, 0, -1], [a, b, a, -b, 1, 0], [-a, -b, -a, b, -1, 0]];
  for (const [u0, v0, u1, v1, nu, nv] of sides) {
    const len = Math.hypot(u1 - u0, v1 - v0);
    out[wallSlot].push(grid([[P(u0, y0, v0), P(u1, y0, v1)], [P(u0, eave, v0), P(u1, eave, v1)]],
      [[[0, 0], [len, 0]], [[0, eave - y0], [len, eave - y0]]], dir(nu, 0, nv)));
  }
  for (const side of [-1, 1]) {
    const u = side * a;
    out[wallSlot].push(grid([[P(u, eave, -b), P(u, eave, b)], [P(u, ridge, 0), P(u, ridge, 0)]],
      [[[0, 0], [2 * b, 0]], [[b, ridge - eave], [b, ridge - eave]]], dir(side, 0, 0)));
  }
  const overhang = Math.min(0.8, 0.2 + b * 0.1), k = (ridge - eave) / b, ue = a + overhang * 0.6;
  for (const side of [-1, 1]) {
    const v = side * (b + overhang), y = eave - overhang * k, slant = Math.hypot(b + overhang, ridge - y);
    out.roof.push(grid([[P(-ue, y, v), P(ue, y, v)], [P(-ue, ridge, 0), P(ue, ridge, 0)]],
      [[[0, 0], [2 * ue, 0]], [[0, slant], [2 * ue, slant]]], dir(0, 1, side)));
  }
  if (ridgeBeam) {
    const g = beam(P(-ue, ridge, 0), P(ue, ridge, 0), 0.45, 0.5, 0.1);
    if (g) out.ridge.push(g);
  }
}

/** Heights for one roofed part of a building, from that part's own depth. */
const partHeights = (b: CityBuilding, r: ORect) => traditionalHeights(b, r.b);

const roofOf = (b: CityBuilding, a: number, bHalf: number): RoofType => {
  if (b.roof === 'pyramidal' || (b.name?.endsWith('亭') && a / bHalf < 1.4)) return 'cuanjian';
  if (b.roof === 'gabled') return 'yingshan';
  if (b.roof === 'hipped') return 'wudian';
  if (b.name && /[殿宫门阁]$/.test(b.name) && b.area > 300) return 'xieshan';
  return 'yingshan';
};

// TODO(verify): heights without OSM tags follow these rules; they are estimates, not survey data.
function traditionalHeights(b: CityBuilding, halfDepth: number) {
  const ridge = b.h ?? Math.min(24, 3.4 + 0.6 * 2 * halfDepth);
  const roofRise = Math.min(ridge * 0.42, Math.max(1.6, halfDepth * 0.55));
  return { eave: Math.max(2.4, ridge - roofRise), ridge };
}
const modernHeight = (b: CityBuilding) => b.h ?? (b.levels ? b.levels * 3.3 : b.area > 3000 ? 15 : b.area > 800 ? 10 : 7);

// ── builders ─────────────────────────────────────────────────────────────
function prism(out: Bucket, slot: Slot, poly: Point[], y0: number, y1: number, roofSlot: Slot | null) {
  walls(out[slot], poly, poly, y0, y1, 1);
  if (roofSlot) out[roofSlot].push(cap(poly, y1, [], 0.275));
}

function ordinary(out: Bucket, b: CityBuilding, palace: boolean) {
  const c = centroid(b.poly);
  const ground = terrainY(c[0], c[1]);
  if (!isTraditional(b, c)) {
    prism(out, 'modern', b.poly, ground, ground + modernHeight(b), 'roof');
    return;
  }
  const rect = orientedRect(b.poly);
  const { eave } = traditionalHeights(b, rect.b);
  const wallSlot: Slot = palace ? 'platform' : 'brick';
  const fill = fillOf(b, rect);
  if (fill < 0.72 || rect.b < 1.5) {
    // Large irregular outlines in the palace are terraces (e.g. the three-tier base of the
    // great halls), not halls: keep them low and in stone. TODO(verify) the 8 m cap.
    if (palace && b.area > 2500 && !b.h) { prism(out, 'stone', b.poly, ground, ground + Math.min(8, eave), 'roof'); return; }
    // Courtyard-shaped or irregular: one roof per rectangular wing, over low walls and a flat
    // fill for whatever the wings do not cover.
    const parts = rectangles(b.poly, rect);
    if (!parts.length) { prism(out, wallSlot, b.poly, ground, ground + eave, 'roof'); return; }
    const low = Math.min(...parts.map(p => partHeights(b, p).eave));
    prism(out, wallSlot, b.poly, ground, ground + low - 0.4, 'roof');
    for (const p of parts) kitRoof(out, b, p, ground, wallSlot);
    return;
  }
  walls(out[wallSlot], b.poly, b.poly, ground, ground + eave - LITE_STYLE.eaveThickness, 1);
  kitRoof(out, b, rect, ground, null);
}

/** A kit roof (LITE style) over one oriented rectangle; `wallSlot` adds the rectangle's own walls. */
function kitRoof(out: Bucket, b: CityBuilding, rect: ORect, ground: number, wallSlot: Slot | null) {
  const { eave, ridge } = partHeights(b, rect);
  if (wallSlot) {
    const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
    const corners: Point[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
      [rect.cx + u * rect.a * c - v * rect.b * s, rect.cz + u * rect.a * s + v * rect.b * c]);
    walls(out[wallSlot], corners, corners, ground, ground + eave - LITE_STYLE.eaveThickness, 1);
  }
  const overhang = Math.min(1.2, 0.25 + rect.b * 0.12);
  const outer: Rect = { cx: 0, cz: 0, hx: rect.a + overhang, hz: rect.b + overhang };
  const body: Rect = { cx: 0, cz: 0, hx: rect.a, hz: rect.b };
  const marks = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
  // buildRoof works centred; it is placed at the rect centre and yawed onto the long axis.
  buildRoof(out, LITE_STYLE, roofOf(b, rect.a, rect.b), outer, body, ground + eave, ground + ridge, -rect.angle);
  for (const [slot, list] of Object.entries(out) as [Slot, BufferGeometry[]][]) {
    for (let i = marks[slot]; i < list.length; i++) list[i].translate(rect.cx, 0, rect.cz);
  }
}

/** Published figure > OSM height tag (if plausible) > placeholder > levels / area estimate. */
export function landmarkHeight(b: CityBuilding, spec: LandmarkSpec) {
  if (spec.known) return spec.known.height;
  if (b.h && b.h > (spec.base ?? 0) + 6) return b.h;
  return spec.ridge ?? (spec.kind === 'modern' || spec.kind === 'dome' ? modernHeight(b) : 18);
}

function landmark(out: Bucket, b: CityBuilding, spec: LandmarkSpec, notes: string[]) {
  const c = centroid(b.poly);
  const ground = terrainY(c[0], c[1]);
  const rect = orientedRect(b.poly);
  if (spec.kind === 'modern') {
    const h = landmarkHeight(b, spec);
    if (!spec.known && !b.h && spec.ridge) notes.push(`${spec.name}：OSM 无高度，按占位 ${spec.ridge} 米`);
    prism(out, 'modern', b.poly, ground, ground + h, 'roof');
    return;
  }
  if (spec.kind === 'monument') {
    const h = b.h ?? 38;
    const terrace = { cx: rect.cx, cz: rect.cz, hx: rect.a * 0.9, hz: rect.b * 0.9 };
    out.stone.push(box(terrace, ground, ground + 1.2), box({ ...terrace, hx: terrace.hx * 0.6, hz: terrace.hz * 0.6 }, ground + 1.2, ground + 2.6));
    const shaft = { cx: rect.cx, cz: rect.cz, hx: 3, hz: 3 };
    out.stone.push(box({ ...shaft, hx: 6, hz: 6 }, ground + 2.6, ground + 8), box(shaft, ground + 8, ground + h - 3));
    buildRoof(out, { ...KIT_DEFAULTS, ornaments: false, cornerLift: 0.3 }, 'wudian', { ...shaft, hx: 3.8, hz: 3.4 }, shaft, ground + h - 3, ground + h);
    return;
  }
  if (spec.kind === 'stupa') {
    // TODO(verify): bottle-shaped stupa on a square base, proportions are schematic.
    const h = b.h ?? spec.ridge ?? 36;
    const r = Math.min(rect.a, rect.b);
    out.stone.push(box({ cx: rect.cx, cz: rect.cz, hx: r * 0.9, hz: r * 0.9 }, ground, ground + h * 0.18));
    const body = new SphereGeometry(r * 0.62, 24, 14).scale(1, 0.85, 1).translate(rect.cx, ground + h * 0.36, rect.cz);
    const spire = new CylinderGeometry(r * 0.08, r * 0.28, h * 0.42, 16).translate(rect.cx, ground + h * 0.72, rect.cz);
    out.stone.push(body, spire, new SphereGeometry(r * 0.16, 12, 8).translate(rect.cx, ground + h * 0.95, rect.cz));
    return;
  }
  if (spec.kind === 'dome') {
    const h = b.h ?? 46;
    const dome = new SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(rect.a, h, rect.b).rotateY(-rect.angle).translate(rect.cx, ground, rect.cz);
    out.modern.push(dome);
    return;
  }
  // Halls and gates: the kit, axis-aligned (palace buildings follow the axis in this frame).
  const turned = Math.abs(Math.sin(rect.angle)) > 0.5;
  const fp: Rect = { cx: rect.cx, cz: rect.cz, hx: turned ? rect.b : rect.a, hz: turned ? rect.a : rect.b };
  const base = ground + (spec.known?.base ?? spec.base ?? 1.5);
  const ridge = ground + landmarkHeight(b, spec);
  if (!spec.known && !b.h) notes.push(`${spec.name}：OSM 无高度，屋脊按占位 ${spec.ridge} 米，台基 ${spec.base} 米`);
  const inset = (r: Rect, d: number): Rect => ({ ...r, hx: Math.max(1.5, r.hx - d), hz: Math.max(1.5, r.hz - d) });
  const grow = (r: Rect, d: number): Rect => ({ ...r, hx: r.hx + d, hz: r.hz + d });
  let body: Rect;
  if (spec.kind === 'gate') {
    out.platform.push(box(fp, ground, base));
    body = { ...fp, hx: fp.hx * 0.62, hz: fp.hz * 0.55 };
  } else {
    if ((spec.base ?? 0) > 1) out.stone.push(box(grow(fp, 4), ground, base));
    body = inset(fp, 3.2);
  }
  const H = ridge - base;
  const bays: [number, number] = [Math.max(3, Math.round(2 * Math.max(body.hx, body.hz) / 5.5) | 1), Math.max(1, Math.round(2 * Math.min(body.hx, body.hz) / 5.5) | 1)];
  const plan: HallPlan = { id: spec.name, gate: 'tiananmen', roof: spec.roof ?? 'xieshan', bays, baseY: base, body,
    top: { outer: grow(body, 3.2), eaveY: base + 0.5 * H, ridgeY: ridge }, notes: [] };
  if (spec.double) {
    const upper = inset(body, Math.min(2.6, Math.min(body.hx, body.hz) * 0.25));
    plan.skirt = { outer: grow(body, 3.2), inner: inset(body, 1.2), eaveY: base + 0.34 * H, topY: base + 0.44 * H };
    plan.upperBody = { ...upper, hx: Math.min(upper.hx, plan.skirt.inner.hx), hz: Math.min(upper.hz, plan.skirt.inner.hz) };
    plan.top = { outer: grow(plan.upperBody, 3), eaveY: base + 0.58 * H, ridgeY: ridge };
  }
  buildHall(out, KIT_DEFAULTS, plan);
}

/**
 * Green areas get trees in groves (林): clusters of 5–20 trees of one kind, some lone trees, and
 * open gaps between groves (林缘留白), kept off building footprints. `group` ties a tree to its
 * grove so the card painter can give a grove one species.
 */
function treePoints(city: CityData, seed: number) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state ^ (state >>> 15), 2246822519) + 0x9E3779B9) >>> 0; return state / 4294967296; };
  const cells = new Map<string, Point[][]>();
  const key = (x: number, z: number) => `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
  for (const b of city.buildings) {
    const xs = b.poly.map(p => p[0]), zs = b.poly.map(p => p[1]);
    for (let x = Math.floor(Math.min(...xs) / 50); x <= Math.floor(Math.max(...xs) / 50); x++)
      for (let z = Math.floor(Math.min(...zs) / 50); z <= Math.floor(Math.max(...zs) / 50); z++) {
        const k = `${x},${z}`; if (!cells.has(k)) cells.set(k, []); cells.get(k)!.push(b.poly);
      }
  }
  const [x0, x1, z0, z1] = city.bounds;
  const points: { x: number; z: number; y: number; group: number }[] = [];
  const free = (p: Point, poly: Point[]) => p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1 && pointInPolygon(p, poly)
    && (!city.ring || pointInPolygon(p, city.ring))
    && !(cells.get(key(p[0], p[1])) ?? []).some(b => pointInPolygon(p, b));
  let group = 0;
  // Only parks, gardens and woods get trees; plain grass (palace courtyards, the square) stays open.
  // The tree budget is shared out by area, so no park is left bare when the total is capped.
  const woods = city.green.filter(g => g.kind !== 'grass');
  const wanted = woods.map(g => Math.min(3500, Math.round(polygonArea(g.poly) / 220)));
  const share = Math.min(1, TREE_BUDGET / Math.max(1, wanted.reduce((a, b) => a + b, 0)));
  for (const [index, g] of woods.entries()) {
    const xs = g.poly.map(p => p[0]), zs = g.poly.map(p => p[1]);
    const span = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const inBox = (): Point => [span[0] + random() * (span[1] - span[0]), span[2] + random() * (span[3] - span[2])];
    const target = Math.round(wanted[index] * share);
    let placed = 0;
    // Groves first (about 85 % of the trees)…
    for (let tries = 0; placed < target * 0.85 && tries < target * 2; tries++) {
      const centre = inBox();
      if (!free(centre, g.poly)) continue;
      group++;
      const count = 5 + Math.floor(random() * 16), radius = 4 + Math.sqrt(count) * (3 + random() * 1.5);
      for (let i = 0; i < count && placed < target; i++) {
        const a = random() * Math.PI * 2, d = radius * Math.sqrt(random());
        const p: Point = [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d];
        if (!free(p, g.poly)) continue;
        points.push({ x: p[0], z: p[1], y: terrainY(p[0], p[1]), group });
        placed++;
      }
    }
    // …then lone trees in between.
    for (let tries = 0; placed < target && tries < target * 3; tries++) {
      const p = inBox();
      if (!free(p, g.poly)) continue;
      points.push({ x: p[0], z: p[1], y: terrainY(p[0], p[1]), group: -1 });
      placed++;
    }
  }
  return points.slice(0, TREE_BUDGET);
}

/**
 * Far-LOD stand-in. Modern buildings are flat prisms; old ones get a cheap gabled house per
 * rectangular wing, so the hutong grain (rows of ridges) still reads from afar.
 */
function cheap(out: Bucket, b: CityBuilding, palace: boolean) {
  const c = centroid(b.poly);
  const ground = terrainY(c[0], c[1]);
  if (!isTraditional(b, c)) { prism(out, 'modern', b.poly, ground, ground + modernHeight(b), 'roof'); return; }
  const rect = orientedRect(b.poly);
  const wallSlot: Slot = palace ? 'platform' : 'brick';
  const fill = fillOf(b, rect);
  if (rect.b >= 1.5 && fill >= 0.72) {
    const { eave, ridge } = traditionalHeights(b, rect.b);
    gableHouse(out, wallSlot, rect, ground, ground + eave, ground + ridge);
    return;
  }
  const { eave, ridge } = traditionalHeights(b, rect.b);
  if (palace && b.area > 2500 && !b.h) { prism(out, 'stone', b.poly, ground, ground + Math.min(8, eave), 'roof'); return; }
  const parts = rectangles(b.poly, rect, 2);
  if (!parts.length) { prism(out, wallSlot, b.poly, ground, ground + (eave + ridge) / 2, 'roof'); return; }
  const low = Math.min(...parts.map(p => partHeights(b, p).eave));
  prism(out, wallSlot, b.poly, ground, ground + low - 0.4, 'roof');
  for (const p of parts) { const h = partHeights(b, p); gableHouse(out, wallSlot, p, ground, ground + h.eave, ground + h.ridge); }
}

function meshesFrom(bucket: Bucket, materials: SceneMaterials, name: string) {
  const group = new Group();
  group.name = name;
  for (const slot of Object.keys(bucket) as Slot[]) {
    const geometry = mergeSlot(bucket[slot]);
    if (!geometry) continue;
    const mesh = new Mesh(geometry, materials[slot as ValueKey]);
    mesh.name = `${name}-${slot}`;
    mesh.userData = { slot };
    group.add(mesh);
  }
  return group;
}

interface Tile { key: string; index: number; cx: number; cz: number; buildings: CityBuilding[]; near: Group | null }

/** Far stand-ins are merged per CHUNK × CHUNK tiles (1600 m) to keep draw calls low. */
const CHUNK = 4;

/**
 * City layer with two levels of detail per 400 m tile: cheap prisms everywhere, and full
 * roofs generated on demand for the tiles around the camera's target (see `update`).
 * Landmarks, walls and the ground are always at full detail.
 */
/** Cut a polyline to the part(s) inside a convex-or-not polygon, splitting it where it leaves. */
function clipLine(line: Point[], poly: Point[]): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  const crossing = (a: Point, b: Point): Point | null => {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [px, pz] = poly[j], [qx, qz] = poly[i];
      const rx = b[0] - a[0], rz = b[1] - a[1], sx = qx - px, sz = qz - pz;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((px - a[0]) * sz - (pz - a[1]) * sx) / den, u = ((px - a[0]) * rz - (pz - a[1]) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return best === Infinity ? null : [a[0] + (b[0] - a[0]) * best, a[1] + (b[1] - a[1]) * best];
  };
  line.forEach((p, i) => {
    const inside = pointInPolygon(p, poly);
    if (i > 0) {
      const prev = line[i - 1], prevInside = pointInPolygon(prev, poly);
      if (inside !== prevInside) {
        const x = inside ? crossing(p, prev) : crossing(prev, p);
        if (x) run.push(x);
        if (!inside) { if (run.length > 1) runs.push(run); run = []; }
      }
    }
    if (inside) run.push(p);
  });
  if (run.length > 1) runs.push(run);
  return runs;
}

/**
 * 沙盘: keep only what stands on the plinth. Buildings whose centre lies outside the ring are
 * dropped, and roads and waterways are cut exactly at the plinth edge (the data is clipped to a
 * slightly larger box, so a few dozen features poke out).
 */
function onPlinth(city: CityData): CityData {
  const ring = city.ring;
  if (!ring) return city;
  return {
    ...city,
    buildings: city.buildings.filter(b => pointInPolygon(centroid(b.poly), ring)),
    roads: city.roads.flatMap(r => clipLine(r.line, ring).map(line => ({ ...r, line }))),
    waterways: city.waterways.flatMap(w => clipLine(w.line, ring).map(line => ({ ...w, line }))),
  };
}

export function createCity(source: CityData, materials: SceneMaterials) {
  const city = onPlinth(source);
  const root = new Group();
  root.name = 'city';
  const labels: Label[] = [];
  const notes: string[] = [];
  const specs = new Map(LANDMARKS.map(l => [l.name, l]));
  const used = new Set<string>();
  const palace = (x: number, z: number) => Math.abs(x) < 410 && z < -20 && z > -1560;
  const landmarkBucket = emptyBucket();
  const tileMap = new Map<string, CityBuilding[]>();
  // Several buildings can share a landmark's name (small bell pavilions called 钟楼): take the largest.
  const chosen = new Map<string, CityBuilding>();
  for (const b of city.buildings) {
    if (!b.name || !specs.has(b.name)) continue;
    const prev = chosen.get(b.name);
    const hint = specs.get(b.name)!.near;
    const closer = (x: CityBuilding) => { const c = centroid(x.poly); return Math.hypot(c[0] - hint![0], c[1] - hint![1]); };
    if (!prev || (hint ? closer(b) < closer(prev) : b.area > prev.area)) chosen.set(b.name, b);
  }
  for (const b of city.buildings) {
    const c = centroid(b.poly);
    const spec = b.name && chosen.get(b.name) === b ? specs.get(b.name) : undefined;
    if (spec && !used.has(spec.name)) {
      used.add(spec.name);
      landmark(landmarkBucket, b, spec, notes);
      const rect = orientedRect(b.poly);
      const top = (spec.kind === 'monument' || spec.kind === 'dome' ? b.h ?? 40 : spec.kind === 'stupa' ? b.h ?? spec.ridge ?? 36 : landmarkHeight(b, spec)) + terrainY(c[0], c[1]);
      const height = spec.kind === 'monument' || spec.kind === 'dome' || spec.kind === 'stupa' ? b.h ?? spec.ridge : landmarkHeight(b, spec);
      labels.push({ name: spec.name, tier: spec.tier, position: [c[0], top + 4, c[1]], size: Math.max(rect.a, rect.b), info: {
        kind: KIND_NAMES[spec.kind], height, source: spec.known?.source,
        heightFrom: spec.known ? 'known' : b.h ? 'osm' : 'estimate', footprint: [2 * rect.a, 2 * rect.b] } });
      continue;
    }
    const key = `${Math.floor(c[0] / TILE)},${Math.floor(c[1] / TILE)}`;
    if (!tileMap.has(key)) tileMap.set(key, []);
    tileMap.get(key)!.push(b);
    // Smaller buildings that share a landmark's name (several 钟楼) get no label of their own.
    if (b.name && OLD_NAME.test(b.name) && !MODERN_NAME.test(b.name) && b.area > 120 && !specs.has(b.name)) {
      const top = (b.h ?? traditionalHeights(b, orientedRect(b.poly).b).ridge) + terrainY(c[0], c[1]);
      const rect = orientedRect(b.poly);
      labels.push({ name: b.name, tier: 3, position: [c[0], top + 3, c[1]], size: Math.sqrt(b.area), info: {
        kind: '古建筑', height: top - terrainY(c[0], c[1]), heightFrom: b.h ? 'osm' : 'estimate', footprint: [2 * rect.a, 2 * rect.b] } });
    }
  }
  // The three axis gates are built by the kit from the axis layout, not from the city data.
  for (const gate of layout.gates) {
    const name = { tiananmen: '天安门', duanmen: '端门', wumen: '午门' }[gate.id];
    labels.push({ name, tier: 2, position: [AXIS_X, gate.height + 5, gate.center[1]], size: 70,
      info: { kind: '城楼', height: gate.height, heightFrom: 'osm' } });
  }
  for (const missing of LANDMARKS.filter(l => !used.has(l.name))) notes.push(`未在数据中找到地标 ${missing.name}`);
  for (const area of AREAS) {
    const polygonal = area.source ? [...city.green, ...city.squares, ...city.water].find(g => g.name === area.source) : undefined;
    const street = area.source && !polygonal ? city.roads.filter(r => r.name === area.source).flatMap(r => r.line) : [];
    const at = area.at ?? (polygonal ? centroid(polygonal.poly) : street.length ? centroid(street) : null);
    if (at && city.ring && !pointInPolygon(at, city.ring)) continue;
    if (!at) { notes.push(`未找到区域 ${area.name}`); continue; }
    labels.push({ name: area.name, tier: 1, position: [at[0], 60 + terrainY(at[0], at[1]), at[1]], size: 400, info: { kind: '片区' } });
  }
  root.add(meshesFrom(landmarkBucket, materials, 'landmarks'));

  // Ground layer: roads, water, the hill. Snow ground itself is one large plane.
  const ground = emptyBucket();
  // Layer order on the ground: snow 0, roads 0.15 m, water 0.3 m (water covers roads at crossings).
  // Materials add a depth bias too (materials.ts), so the layers never z-fight.
  for (const r of city.roads) if (r.line.length > 1) ground.road.push(ribbon(r.line, r.w, 0.15));
  for (const w of city.water) if (w.poly.length > 2) ground.water.push(cap(w.poly, 0.3));
  for (const w of city.waterways) if (w.line.length > 1) ground.water.push(ribbon(w.line, w.w, 0.3));
  // 沙盘 (sandbox): the city stands on a plinth cut to the 2nd Ring outline (the hull of the ring
  // road plus its margin, the same line the data is clipped to). Outside it there is only paper.
  // Without a ring (older data) the snow is a wide disc as before.
  if (city.ring) {
    ground.ground.push(cap(city.ring, 0));
    walls(ground.plinth, city.ring, city.ring, -PLINTH_DEPTH, 0, 1);
    ground.plinth.push(cap(city.ring, -PLINTH_DEPTH));
  } else {
    ground.ground.push(new CircleGeometry(8500, 128).rotateX(-Math.PI / 2));
  }
  const hill = new PlaneGeometry(JINGSHAN.radius * 2, JINGSHAN.radius * 2, 48, 48).rotateX(-Math.PI / 2)
    .translate(JINGSHAN.centre[0], 0, JINGSHAN.centre[1]);
  const pos = hill.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainY(pos.getX(i), pos.getZ(i)) + 0.02);
  hill.computeVertexNormals();
  ground.ground.push(hill);
  root.add(meshesFrom(ground, materials, 'ground'));

  const tiles: Tile[] = [];
  // One flag per tile: 1 hides that tile's far stand-in (its vertices collapse in the vertex shader)
  // while the full-detail version is shown. No re-merging is needed when the view moves.
  const hidden = uniformArray(new Array(Math.max(1, tileMap.size)).fill(0), 'float');
  const farMaterials = new Map<Slot, MeshBasicNodeMaterial>();
  const farMaterial = (slot: Slot) => {
    if (!farMaterials.has(slot)) {
      const m = (materials[slot as ValueKey] as MeshBasicNodeMaterial).clone();
      const flag = float(hidden.element(attribute('tileIndex', 'float').toInt()) as unknown as number);
      m.positionNode = positionLocal.mul(float(1).sub(flag));
      m.name = `${m.name}-far`;
      farMaterials.set(slot, m);
    }
    return farMaterials.get(slot)!;
  };
  const chunks = new Map<string, Map<Slot, BufferGeometry[]>>();
  for (const [key, buildings] of tileMap) {
    const [i, j] = key.split(',').map(Number);
    const index = tiles.length;
    const out = emptyBucket();
    for (const b of buildings) { const c = centroid(b.poly); cheap(out, b, palace(c[0], c[1])); }
    const chunkKey = `${Math.floor(i / CHUNK)},${Math.floor(j / CHUNK)}`;
    if (!chunks.has(chunkKey)) chunks.set(chunkKey, new Map());
    const chunk = chunks.get(chunkKey)!;
    for (const slot of Object.keys(out) as Slot[]) {
      const geometry = mergeSlot(out[slot]);
      if (!geometry) continue;
      geometry.setAttribute('tileIndex', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(index), 1));
      if (!chunk.has(slot)) chunk.set(slot, []);
      chunk.get(slot)!.push(geometry);
    }
    tiles.push({ key, index, cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, buildings, near: null });
  }
  const far = new Group();
  far.name = 'far';
  for (const [chunkKey, slots] of chunks) {
    for (const [slot, list] of slots) {
      const geometry = mergeGeometries(list);
      list.forEach(g => g.dispose());
      if (!geometry) continue;
      const mesh = new Mesh(geometry, farMaterial(slot));
      mesh.name = `far-${chunkKey}-${slot}`;
      mesh.userData = { slot };
      far.add(mesh);
    }
  }
  root.add(far);

  let pending: { tile: Tile; out: Bucket; index: number } | null = null;
  function cancelBuild() {
    if (!pending) return;
    for (const list of Object.values(pending.out)) list.forEach(g => g.dispose());
    pending = null;
  }
  function buildNear(tile: Tile, deadline: number) {
    if (pending?.tile !== tile) {
      cancelBuild();
      pending = { tile, out: emptyBucket(), index: 0 };
    }
    const work = pending!;
    while (work.index < tile.buildings.length) {
      const b = tile.buildings[work.index++], c = centroid(b.poly);
      ordinary(work.out, b, palace(c[0], c[1]));
      if (performance.now() >= deadline && work.index < tile.buildings.length) return false;
    }
    tile.near = meshesFrom(work.out, materials, `near-${tile.key}`);
    pending = null;
    root.add(tile.near);
    return true;
  }
  function dropNear(tile: Tile) {
    if (!tile.near) return;
    root.remove(tile.near);
    tile.near.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
    tile.near = null;
  }
  let nearCount = 0, pendingCount = 0;
  let lastX = NaN, lastZ = NaN, lastRadius = NaN;
  let wanted: { t: Tile; d: number }[] = [];
  return {
    root, labels, notes, trees: treePoints(city, 20261103), tiles, farMeshes: far.children.length,
    isHidden: (index: number) => hidden.array[index] === 1,
    get nearTiles() { return nearCount; },
    get pendingTiles() { return pendingCount; },
    cancelBuild,
    /**
     * Keep full-detail roofs around the map target: within a radius that grows with the
     * viewing distance (none when zoomed far out). Builds at most `budget` tiles per call.
     */
    update(x: number, z: number, distance: number, budget = 1, timeBudgetMs = Infinity) {
      const radius = distance < 1700 ? Math.min(1100, Math.max(380, distance * 1.15)) : 0;
      const changed = x !== lastX || z !== lastZ || radius !== lastRadius;
      if (!changed && (pendingCount === 0 || budget === 0)) return 0;
      if (changed) {
        lastX = x; lastZ = z; lastRadius = radius;
        wanted = tiles.map(t => ({ t, d: Math.hypot(t.cx - x, t.cz - z) }));
        wanted.sort((a, b) => a.d - b.d);
        if (pending && !wanted.some(({ t, d }) => t === pending!.tile && d < radius)) cancelBuild();
      }
      const deadline = performance.now() + timeBudgetMs;
      let built = 0;
      nearCount = 0; pendingCount = 0;
      for (const { t, d } of wanted) {
        const want = d < radius;
        if (want && !t.near && built < budget && performance.now() < deadline) {
          // Finish the in-progress tile before starting another, even if distances reorder.
          if (!pending || pending.tile === t) { if (buildNear(t, deadline)) built++; }
        }
        if (want && !t.near) pendingCount++;
        if (!want && t.near && (radius === 0 || d > radius * 1.6 + TILE)) dropNear(t);
        const showNear = want && t.near !== null;
        if (hidden.array[t.index] !== Number(showNear)) hidden.array[t.index] = Number(showNear);
        if (t.near) t.near.visible = showNear;
        if (t.near) nearCount++;
      }
      return built;
    },
  };
}
