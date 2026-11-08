import {
  BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, ShapeUtils, Vector2, Vector3,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point, PartPlan } from '../data/layout';

export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const clean = parts.map(part => {
    const result = part.index ? part.toNonIndexed() : part.clone();
    for (const name of Object.keys(result.attributes)) {
      if (name !== 'position' && name !== 'normal') result.deleteAttribute(name);
    }
    return result;
  });
  const merged = mergeGeometries(clean);
  clean.forEach(part => part.dispose());
  parts.forEach(part => part.dispose());
  if (!merged) throw new Error('体块几何合并失败');
  return merged;
}

export function extrudePolygon(polygon: Point[], bottom: number, top: number) {
  const shape = new Shape(polygon.map(([x, z]) => new Vector2(x, -z)));
  const geometry = new ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

// Clip at the gable ridge so each cap triangle lies on one planar slope.
function clipHalf(polygon: Point[], axis: 0 | 1, middle: number, side: number): Point[] {
  const output: Point[] = [];
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const da = (a[axis] - middle) * side;
    const db = (b[axis] - middle) * side;
    if (da >= -1e-7) output.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return output;
}

export function createRoof(part: PartPlan, polygon: Point[]) {
  const positions: number[] = [];
  const base = part.roofBase;
  const rise = part.top - base;
  const minX = Math.min(...polygon.map(p => p[0]));
  const maxX = Math.max(...polygon.map(p => p[0]));
  const minZ = Math.min(...polygon.map(p => p[1]));
  const maxZ = Math.max(...polygon.map(p => p[1]));
  const center: Point = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const a = new Vector3(), b = new Vector3(), cross = new Vector3();
  type V = [number, number, number];
  function triangle(v0: V, v1: V, v2: V, upward?: boolean) {
    a.set(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
    b.set(v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]);
    cross.crossVectors(a, b);
    if (cross.lengthSq() < 1e-12) return;
    if (upward !== undefined && (cross.y > 0) !== upward) positions.push(...v0, ...v2, ...v1);
    else positions.push(...v0, ...v1, ...v2);
  }
  function surface(poly: Point[], height: (point: Point) => number) {
    const indices = ShapeUtils.triangulateShape(poly.map(p => new Vector2(...p)), []);
    indices.forEach(indices => {
      const p = indices.map(i => poly[i]);
      triangle(...p.map(([x, z]) => [x, height([x, z]), z] as V) as [V, V, V], true);
      triangle(...p.map(([x, z]) => [x, base, z] as V) as [V, V, V], false);
    });
    const clockwise = ShapeUtils.isClockWise(poly.map(p => new Vector2(...p)));
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const p0: V = [p[0], base, p[1]], p1: V = [p[0], height(p), p[1]];
      const q0: V = [q[0], base, q[1]], q1: V = [q[0], height(q), q[1]];
      if (clockwise) { triangle(p0, p1, q1); triangle(p0, q1, q0); }
      else { triangle(p0, q1, p1); triangle(p0, q0, q1); }
    });
  }
  if (part.roof === 'pyramidal') {
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      triangle([p[0], base, p[1]], [center[0], part.top, center[1]], [q[0], base, q[1]], true);
    });
    const indices = ShapeUtils.triangulateShape(polygon.map(p => new Vector2(...p)), []);
    indices.forEach(ids => triangle(...ids.map(i => [polygon[i][0], base, polygon[i][1]] as V) as [V, V, V], false));
  } else if (part.roof === 'gabled') {
    const axis = maxX - minX >= maxZ - minZ ? 1 : 0;
    const half = (axis === 0 ? maxX - minX : maxZ - minZ) / 2;
    const height = (p: Point) => base + rise * Math.max(0, 1 - Math.abs(p[axis] - center[axis]) / half);
    [-1, 1].forEach(side => {
      const halfPoly = clipHalf(polygon, axis, center[axis], side);
      if (halfPoly.length >= 3) surface(halfPoly, height);
    });
  } else {
    // OSM roof:direction denotes the descending direction (rounded to a cardinal).
    const direction = part.snappedRoofDirection ?? 0;
    const axis = direction === 90 || direction === 270 ? 0 : 1;
    const min = axis === 0 ? minX : minZ;
    const span = axis === 0 ? maxX - minX : maxZ - minZ;
    surface(polygon, p => {
      const t = (p[axis] - min) / span;
      return base + rise * (direction === 90 || direction === 180 ? 1 - t : t);
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
