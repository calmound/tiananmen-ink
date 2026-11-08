import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];

/** Material slots used by the architecture kit (SPEC 7.2 value plan). */
export type Slot = 'roof' | 'timber' | 'column' | 'bracket' | 'ridge' | 'gable' | 'platform' | 'stone' | 'door'
  | 'brick' | 'modern' | 'road' | 'water' | 'ground' | 'plinth';
export type Bucket = Record<Slot, BufferGeometry[]>;
export const emptyBucket = (): Bucket => ({
  roof: [], timber: [], column: [], bracket: [], ridge: [], gable: [], platform: [], stone: [], door: [],
  brick: [], modern: [], road: [], water: [], ground: [], plinth: [],
});

/**
 * Indexed grid from rows of points (rows × cols). `uv` gives metres along / across.
 * Winding is flipped if the average normal points against `outward`.
 */
export function grid(points: V3[][], uvs: [number, number][][], outward?: V3) {
  const rows = points.length, cols = points[0].length;
  const position: number[] = [], uv: number[] = [], index: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    position.push(...points[r][c]);
    uv.push(...uvs[r][c]);
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    index.push(a, d, b, b, d, e);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  if (outward) orient(geometry, outward);
  return geometry;
}

/** Flip triangle winding when the summed normal disagrees with `outward`. */
export function orient(geometry: BufferGeometry, outward: V3) {
  const normal = geometry.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < normal.count; i++) dot += normal.getX(i) * outward[0] + normal.getY(i) * outward[1] + normal.getZ(i) * outward[2];
  if (dot >= 0) return geometry;
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  index.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Thin box laid between two points (ridges, rails). */
export function beam(a: V3, b: V3, width: number, height: number, lift = 0) {
  const from = new Vector3(...a), to = new Vector3(...b);
  const length = from.distanceTo(to);
  if (length < 1e-4) return null;
  const geometry = new BoxGeometry(length, height, width);
  const direction = to.clone().sub(from).normalize();
  const flat = new Vector3(direction.x, 0, direction.z);
  // Yaw first, then pitch, so the box's up stays close to world up.
  const yaw = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), flat.lengthSq() > 1e-8 ? flat.normalize() : new Vector3(1, 0, 0));
  const pitched = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0).applyQuaternion(yaw), direction);
  geometry.applyQuaternion(pitched.multiply(yaw));
  const middle = from.add(to).multiplyScalar(0.5);
  geometry.translate(middle.x, middle.y + lift, middle.z);
  return geometry;
}

export function polylineBeams(points: V3[], width: number, height: number, lift: number) {
  const out: BufferGeometry[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const g = beam(points[i], points[i + 1], width, height, lift);
    if (g) out.push(g);
  }
  return out;
}

/** Merge into one non-indexed geometry with position / normal / uv. */
export function mergeSlot(parts: BufferGeometry[]) {
  if (!parts.length) return null;
  const clean = parts.map(part => {
    const result = part.index ? part.toNonIndexed() : part.clone();
    if (!result.getAttribute('normal')) result.computeVertexNormals();
    if (!result.getAttribute('uv')) {
      result.setAttribute('uv', new Float32BufferAttribute(new Float32Array(result.getAttribute('position').count * 2), 2));
    }
    for (const name of Object.keys(result.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) result.deleteAttribute(name);
    }
    return result;
  });
  const merged = mergeGeometries(clean);
  clean.forEach(part => part.dispose());
  parts.forEach(part => part.dispose());
  if (!merged) throw new Error('古建组件几何合并失败');
  return merged;
}
