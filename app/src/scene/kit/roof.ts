import { BoxGeometry, BufferGeometry, CylinderGeometry, SphereGeometry } from 'three/webgpu';
import type { Rect, RoofType } from '../../config/gates';
import { grid, polylineBeams, type Bucket, type V3 } from './build';

// SPEC 6.3.3. Roofs are parametric grids, not OSM's planar folds:
// a concave profile (举折), eaves with thickness, corners that lift and flare (起翘),
// tile rows carried in uv.x (metres along the eave) for the material.

export interface KitStyle {
  /** Profile curvature k: height = (1-k)s + ks²; 0 = straight slope. */
  sag: number;
  cornerLift: number;
  cornerFlare: number;
  eaveThickness: number;
  /** Where a 歇山 roof turns from four slopes to two (0–1 up the slope). */
  xieshanBreak: number;
  slopeSegments: number;
  /** Columns along each eave; undefined = by length (fine). Small values for the city's lite roofs. */
  edgeColumns?: number;
  /** Ridge-end ornaments and finials. */
  ornaments?: boolean;
}

// TODO(verify): placeholders until compared with photographs (SPEC 第 15 节).
export const KIT_DEFAULTS: KitStyle = {
  sag: 0.45, cornerLift: 1.0, cornerFlare: 1.2, eaveThickness: 0.5, xieshanBreak: 0.5, slopeSegments: 8, ornaments: true,
};
/** Low-poly variant for the thousands of ordinary city roofs. */
export const LITE_STYLE: KitStyle = {
  ...KIT_DEFAULTS, slopeSegments: 2, edgeColumns: 4, cornerLift: 0.35, cornerFlare: 0.3, eaveThickness: 0.3, ornaments: false,
};

interface Ring { a: number; b: number; y: number }
type RingFn = (s: number) => Ring;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// Corners C0..C3 and the edge each starts: 0 front (+z), 1 east (+x), 2 back (−z), 3 west (−x).
const CORNER_SIGN: [number, number][] = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
const EDGE_NORMAL: V3[] = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];

function corner(k: number, a: number, b: number): [number, number] {
  return [CORNER_SIGN[k][0] * a, CORNER_SIGN[k][1] * b];
}

/** Builder for one roof in a local frame centred on the hall, long side along x. */
class RoofBuilder {
  constructor(private style: KitStyle, private out: Bucket) {}

  profile(s: number) { return (1 - this.style.sag) * s + this.style.sag * s * s; }

  /** Point on edge e at t (0–1 corner to corner), ring parameter s, with corner lift. */
  point(ring: RingFn, e: number, t: number, s: number, lift = true, decayEnd = 0.5): V3 {
    const r = ring(s), r0 = ring(0);
    const [x0, z0] = corner(e, r.a, r.b), [x1, z1] = corner((e + 1) % 4, r.a, r.b);
    let x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = r.y;
    if (lift) {
      const length = e % 2 === 0 ? 2 * r0.a : 2 * r0.b;
      const reach = Math.min(10, 0.35 * length);
      const near = 1 - smoothstep(0, reach, Math.min(t, 1 - t) * length);
      const decay = (1 - Math.min(1, s / decayEnd)) ** 2;
      const w = near * near * decay;
      const [sx, sz] = CORNER_SIGN[t < 0.5 ? e : (e + 1) % 4];
      x += sx * Math.SQRT1_2 * this.style.cornerFlare * w;
      z += sz * Math.SQRT1_2 * this.style.cornerFlare * w;
      y += this.style.cornerLift * w;
    }
    return [x, y, z];
  }

  /** Four-sided band between s0 and s1 for the given edges. */
  band(ring: RingFn, s0: number, s1: number, edges: number[], lift = true, decayEnd = 0.5) {
    const rows = Math.max(2, Math.ceil(this.style.slopeSegments * (s1 - s0)) + 1);
    const r0 = ring(0), r1 = ring(1);
    const slope = Math.hypot(r1.y - r0.y, r0.b - r1.b);
    for (const e of edges) {
      const length = e % 2 === 0 ? 2 * r0.a : 2 * r0.b;
      const cols = (this.style.edgeColumns ?? Math.min(48, Math.max(12, Math.ceil(length / 3)))) + 1;
      const points: V3[][] = [], uvs: [number, number][][] = [];
      for (let i = 0; i < rows; i++) {
        const s = s0 + (s1 - s0) * i / (rows - 1);
        const row: V3[] = [], uvRow: [number, number][] = [];
        for (let j = 0; j < cols; j++) {
          const t = j / (cols - 1);
          const p = this.point(ring, e, t, s, lift, decayEnd);
          row.push(p);
          const along = [p[0], -p[2], -p[0], p[2]][e];
          uvRow.push([along, s * slope]);
        }
        points.push(row); uvs.push(uvRow);
      }
      const n = EDGE_NORMAL[e];
      this.out.roof.push(grid(points, uvs, [n[0], 1.5, n[2]]));
    }
  }

  /** Eave fascia (thickness) and soffit back to the column line, all on `edges`. */
  eave(ring: RingFn, body: { a: number; b: number }, edges: number[], lift = true) {
    const thick = this.style.eaveThickness;
    const y = ring(0).y;
    for (const e of edges) {
      const cols = (this.style.edgeColumns ?? 24) + 1;
      const top: V3[] = [], bottom: V3[] = [], inner: V3[] = [];
      const [bx0, bz0] = corner(e, body.a, body.b), [bx1, bz1] = corner((e + 1) % 4, body.a, body.b);
      for (let j = 0; j < cols; j++) {
        const t = j / (cols - 1);
        const p = this.point(ring, e, t, 0, lift);
        top.push(p);
        bottom.push([p[0], p[1] - thick, p[2]]);
        inner.push([bx0 + (bx1 - bx0) * t, y - thick, bz0 + (bz1 - bz0) * t]);
      }
      const flat = (row: V3[], v: number) => row.map((_, j) => [j, v] as [number, number]);
      this.out.timber.push(grid([top, bottom], [flat(top, 0), flat(top, 1)], EDGE_NORMAL[e]));
      this.out.timber.push(grid([bottom, inner], [flat(top, 0), flat(top, 1)], [0, -1, 0]));
    }
  }

  /** Two slopes (front/back) from s0 to the ridge with a constant half-length. */
  gableSlopes(ring: RingFn, s0: number, halfLength: number) {
    const rows = Math.max(2, Math.ceil(this.style.slopeSegments * (1 - s0)) + 1);
    const cols = (this.style.edgeColumns ?? Math.min(48, Math.max(8, Math.ceil(2 * halfLength / 3)))) + 1;
    const r0 = ring(0), r1 = ring(1);
    const slope = Math.hypot(r1.y - r0.y, r0.b - r1.b);
    for (const side of [1, -1]) {
      const points: V3[][] = [], uvs: [number, number][][] = [];
      for (let i = 0; i < rows; i++) {
        const s = s0 + (1 - s0) * i / (rows - 1);
        const r = ring(s);
        points.push(Array.from({ length: cols }, (_, j) => [-halfLength + 2 * halfLength * j / (cols - 1), r.y, side * r.b] as V3));
        uvs.push(Array.from({ length: cols }, (_, j) => [side * (-halfLength + 2 * halfLength * j / (cols - 1)), s * slope] as [number, number]));
      }
      this.out.roof.push(grid(points, uvs, [0, 1.5, side]));
    }
    // Vertical gable ends (山花) at ±halfLength.
    for (const end of [1, -1]) {
      const points: V3[][] = [], uvs: [number, number][][] = [];
      for (let i = 0; i < rows; i++) {
        const s = s0 + (1 - s0) * i / (rows - 1);
        const r = ring(s);
        points.push([[end * halfLength, r.y, r.b], [end * halfLength, r.y, -r.b]]);
        uvs.push([[0, s], [1, s]]);
      }
      this.out.gable.push(grid(points, uvs, [end, 0, 0]));
    }
    const ridge = ring(1).y;
    const slopes = [1, -1].flatMap(side => [1, -1].map(end => {
      const line: V3[] = [];
      const n = this.style.ornaments ? 6 : 2;
      for (let i = 0; i <= n; i++) {
        const s = s0 + (1 - s0) * i / n, r = ring(s);
        line.push([end * halfLength, r.y, side * r.b]);
      }
      return line;
    }));
    for (const line of slopes) this.out.ridge.push(...polylineBeams(line, 0.5, 0.6, 0.25));
    this.mainRidge(halfLength, ridge);
  }

  mainRidge(halfLength: number, y: number) {
    this.out.ridge.push(...polylineBeams([[-halfLength, y, 0], [halfLength, y, 0]], 0.7, 0.9, 0.35));
    // Simplified ridge-end ornaments (鸱吻): a block with a tail curling inward.
    if (this.style.ornaments) for (const end of [1, -1]) {
      this.out.ridge.push(new BoxGeometry(1.4, 1.9, 0.8).translate(end * (halfLength - 0.3), y + 1.0, 0));
      this.out.ridge.push(new BoxGeometry(0.9, 0.6, 0.6).translate(end * (halfLength - 1.1), y + 1.8, 0));
    }
  }

  hips(ring: RingFn, s1: number, decayEnd = 0.5) {
    for (let k = 0; k < 4; k++) {
      const line: V3[] = [];
      const n = this.style.ornaments ? 10 : 2;
      for (let i = 0; i <= n; i++) line.push(this.point(ring, k, 0, s1 * i / n, true, decayEnd));
      this.out.ridge.push(...polylineBeams(line, 0.5, 0.6, 0.25));
    }
  }
}

function localFrame(rect: Rect) {
  const rotate = rect.hz > rect.hx;
  return { rotate, a: rotate ? rect.hz : rect.hx, b: rotate ? rect.hx : rect.hz };
}

/** Move everything a builder added since `marks` into world space (optional extra yaw, radians). */
function place(out: Bucket, marks: Record<string, number>, rect: Rect, rotate: boolean, yaw = 0, lift = 0) {
  for (const [slot, list] of Object.entries(out) as [keyof Bucket, BufferGeometry[]][]) {
    for (let i = marks[slot]; i < list.length; i++) {
      if (rotate) list[i].rotateY(Math.PI / 2);
      if (yaw) list[i].rotateY(yaw);
      list[i].translate(rect.cx, lift, rect.cz);
    }
  }
}
const mark = (out: Bucket) => Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));

/** Top roof from its eave rectangle up to the ridge. `body` is the column line under it. */
export function buildRoof(out: Bucket, style: KitStyle, type: RoofType, outer: Rect, body: Rect, eaveY: number, ridgeY: number,
  yaw = 0) {
  const marks = mark(out);
  const { rotate, a: a0, b: b0 } = localFrame(outer);
  const local = rotate ? { a: body.hz, b: body.hx } : { a: body.hx, b: body.hz };
  const builder = new RoofBuilder(style, out);
  const height = ridgeY - eaveY;
  const f = (s: number) => builder.profile(s);
  if (type === 'yingshan') {
    const ring: RingFn = s => ({ a: a0, b: b0 * (1 - s), y: eaveY + height * f(s) });
    builder.eave(ring, { a: a0, b: local.b }, [0, 2], false);
    builder.gableSlopes(ring, 0, a0);
  } else if (type === 'cuanjian') {
    const ring: RingFn = s => ({ a: a0 * (1 - s), b: b0 * (1 - s), y: eaveY + height * f(s) });
    builder.band(ring, 0, 1, [0, 1, 2, 3]);
    builder.eave(ring, local, [0, 1, 2, 3]);
    builder.hips(ring, 1);
    if (style.ornaments) {
      out.ridge.push(new CylinderGeometry(0.35, 0.6, 1.2, 10).translate(0, ridgeY + 0.6, 0));
      out.ridge.push(new SphereGeometry(0.75, 12, 8).translate(0, ridgeY + 1.6, 0));
    }
  } else {
    // Hips at 45° in plan: both half sizes shrink by b0 over the full slope.
    const ring: RingFn = s => ({ a: a0 - b0 * s, b: b0 * (1 - s), y: eaveY + height * f(s) });
    if (type === 'wudian') {
      builder.band(ring, 0, 1, [0, 1, 2, 3]);
      builder.hips(ring, 1);
      builder.mainRidge(a0 - b0, ridgeY);
    } else {
      const sx = style.xieshanBreak;
      builder.band(ring, 0, sx, [0, 1, 2, 3], true, sx);
      builder.hips(ring, sx, sx);
      builder.gableSlopes(ring, sx, ring(sx).a);
    }
    builder.eave(ring, local, [0, 1, 2, 3]);
  }
  place(out, marks, outer, rotate, yaw);
}

/** Lower eave of a double-eave hall: a sloped ring from `outer` (at eaveY) to `inner` (at topY). */
export function buildSkirt(out: Bucket, style: KitStyle, outer: Rect, inner: Rect, body: Rect, eaveY: number, topY: number) {
  const marks = mark(out);
  const { rotate, a: a0, b: b0 } = localFrame(outer);
  const a1 = rotate ? inner.hz : inner.hx, b1 = rotate ? inner.hx : inner.hz;
  const local = rotate ? { a: body.hz, b: body.hx } : { a: body.hx, b: body.hz };
  const builder = new RoofBuilder(style, out);
  const ring: RingFn = s => ({ a: a0 + (a1 - a0) * s, b: b0 + (b1 - b0) * s, y: eaveY + (topY - eaveY) * builder.profile(s) });
  builder.band(ring, 0, 1, [0, 1, 2, 3], true, 0.7);
  builder.eave(ring, local, [0, 1, 2, 3]);
  builder.hips(ring, 1, 0.7);
  place(out, marks, outer, rotate);
}
