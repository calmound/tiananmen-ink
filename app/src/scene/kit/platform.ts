import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry, ShapeUtils, Vector2 } from 'three/webgpu';
import type { Point } from '../../data/layout';
import type { DoorSpec } from '../../config/gates';
import { grid, type Bucket } from './build';

// SPEC 6.3.2 城台: battered walls, a parapet (宇墙) round the top, arched doors on the south face.
// TODO(verify): batter, parapet height / thickness.
export const PLATFORM_DEFAULTS = { batter: 0.6, parapetHeight: 1.2, parapetThickness: 0.6 };

const signedArea = (poly: Point[]) =>
  poly.reduce((sum, [x0, z0], i) => { const [x1, z1] = poly[(i + 1) % poly.length]; return sum + x0 * z1 - x1 * z0; }, 0) / 2;

/** Offset a simple polygon; positive d moves edges outward. Miters are clamped. */
export function offsetPolygon(poly: Point[], d: number): Point[] {
  const sign = signedArea(poly) > 0 ? 1 : -1;
  const normals = poly.map(([x0, z0], i) => {
    const [x1, z1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    return [sign * (z1 - z0) / len, -sign * (x1 - x0) / len] as Point;
  });
  return poly.map(([x, z], i) => {
    const n0 = normals[(i - 1 + poly.length) % poly.length], n1 = normals[i];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = Math.max(0.35, mx * n1[0] + mz * n1[1]);
    return [x + mx * d / cos, z + mz * d / cos] as Point;
  });
}

export function walls(out: Bucket['platform'], bottom: Point[], top: Point[], y0: number, y1: number, outwardSign: number) {
  const sign = (signedArea(bottom) > 0 ? 1 : -1) * outwardSign;
  bottom.forEach((a, i) => {
    const j = (i + 1) % bottom.length;
    const b = bottom[j], c = top[j], d = top[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) return;
    const normal: [number, number, number] = [sign * (b[1] - a[1]) / len, 0, -sign * (b[0] - a[0]) / len];
    out.push(grid([[[a[0], y0, a[1]], [b[0], y0, b[1]]], [[d[0], y1, d[1]], [c[0], y1, c[1]]]],
      [[[0, 0], [len, 0]], [[0, y1 - y0], [len, y1 - y0]]], normal));
  });
}

export function cap(polygon: Point[], y: number, holes: Point[][] = [], uvX = 0) {
  const contour = polygon.map(([x, z]) => new Vector2(x, z));
  const holeVectors = holes.map(h => h.map(([x, z]) => new Vector2(x, z)));
  const faces = ShapeUtils.triangulateShape(contour, holeVectors);
  const all = [...contour, ...holeVectors.flat()];
  const position: number[] = [];
  for (const [a, b, c] of faces) {
    for (const v of [a, c, b]) position.push(all[v].x, y, all[v].y);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  // uv.x away from tile-row lines so a roof-material cap shows no stripes.
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(position.length / 3 * 2).fill(uvX), 2));
  geometry.computeVertexNormals();
  // Ensure the cap faces up.
  if (geometry.getAttribute('normal').getY(0) < 0) {
    for (let i = 0; i < position.length; i += 9) for (let k = 0; k < 3; k++) {
      [position[i + 3 + k], position[i + 6 + k]] = [position[i + 6 + k], position[i + 3 + k]];
    }
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Southmost face of the polygon at x, with that edge's outward normal. */
function southFace(poly: Point[], x: number) {
  let best: { z: number } | null = null;
  poly.forEach(([x0, z0], i) => {
    const [x1, z1] = poly[(i + 1) % poly.length];
    if ((x0 - x) * (x1 - x) > 0 || x0 === x1) return;
    const z = z0 + (z1 - z0) * (x - x0) / (x1 - x0);
    if (!best || z > best.z) best = { z };
  });
  return best as { z: number } | null;
}

function archShape(width: number, height: number) {
  const r = width / 2, spring = height - r;
  const shape = new Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(r, 0);
  shape.lineTo(r, spring);
  shape.absarc(0, spring, r, 0, Math.PI, false);
  shape.lineTo(-r, 0);
  return shape;
}

export function buildPlatform(out: Bucket, polygons: Point[][], height: number, doors: DoorSpec[], axisX: number,
  batter = PLATFORM_DEFAULTS.batter) {
  const inward = -batter * height / 10;
  const { parapetHeight, parapetThickness } = PLATFORM_DEFAULTS;
  for (const base of polygons) {
    const top = offsetPolygon(base, inward);
    walls(out.platform, base, top, 0, height, 1);
    const inner = offsetPolygon(top, -parapetThickness);
    out.platform.push(cap(inner, height));
    // Parapet: outer face continues the wall line, inner face, and a top ring.
    walls(out.platform, top, top, height, height + parapetHeight, 1);
    walls(out.platform, inner, inner, height, height + parapetHeight, -1);
    out.platform.push(cap(top, height + parapetHeight, [inner]));
    const tilt = Math.atan(batter / 10);
    for (const door of doors) {
      const face = southFace(base, axisX + door.x);
      if (!face) continue;
      const geometry = new ShapeGeometry(archShape(door.width, door.height), 12);
      geometry.rotateX(-tilt);
      geometry.translate(axisX + door.x, 0, face.z + 0.04);
      out.door.push(geometry);
    }
  }
}
