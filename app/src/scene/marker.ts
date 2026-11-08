import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { sin, time, vec3 } from 'three/tsl';
import { terrainY } from './city';

// Selection marker: a single cinnabar brush circle (圆相) round the chosen place.
// Open at one point and tapering at both ends like one stroke; it breathes slowly.
// Drawn in the overlay pass (green channel) and composited as cinnabar over the finished
// painting, like a mark added on top of the scroll, so terraces and roofs never hide it.

function strokeRing(segments = 120) {
  const start = 0.35, end = Math.PI * 2 - 0.05;
  const position: number[] = [], index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = start + (end - start) * t;
    // Pressure: heavy start, thinning tail, with a slight wobble.
    const press = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6 * (1 - 0.55 * t) + 0.06;
    const w = 0.055 * press * (1 + 0.15 * Math.sin(a * 7));
    const r = 1 + 0.02 * Math.sin(a * 3 + 1);
    position.push(Math.cos(a) * (r - w), 0, Math.sin(a) * (r - w), Math.cos(a) * (r + w), 0, Math.sin(a) * (r + w));
    if (i < segments) { const k = i * 2; index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(position.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  return g;
}

export function createMarker() {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending });
  const pulse = sin(time.mul(2.2)).mul(0.12).add(0.82);
  material.colorNode = vec3(0, pulse, 0);
  const mesh = new Mesh(strokeRing(), material);
  mesh.name = 'selection-marker';
  mesh.visible = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    /** `top` is the label's height; the circle sits about a fifth of the way up (terraces, platforms). */
    show(x: number, z: number, size: number, top = 0) {
      const r = Math.min(300, Math.max(18, size * 1.35));
      mesh.position.set(x, terrainY(x, z) + Math.min(10, top * 0.22) + 0.6, z);
      mesh.scale.setScalar(r);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      mesh.visible = true;
    },
    hide() { mesh.visible = false; },
  };
}
