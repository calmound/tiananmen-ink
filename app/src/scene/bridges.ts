import { BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4 } from 'three/webgpu';
import { layout } from '../data/layout';
import type { SceneMaterials } from './materials';

function bridgeGeometry() {
  const positions: number[] = [];
  function quad(a: number[], b: number[], c: number[], d: number[]) {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  // TODO(verify): deck rise 1.6m, thickness 0.45m; P0 silhouette placeholders.
  function strip(x0: number, x1: number, bottom: number, top: number) {
    const n = 32;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const z0 = t0 - 0.5, z1 = t1 - 0.5;
      const y0 = Math.sin(Math.PI * t0) * 1.6, y1 = Math.sin(Math.PI * t1) * 1.6;
      quad([x0,y0+top,z0],[x0,y1+top,z1],[x1,y1+top,z1],[x1,y0+top,z0]);
      quad([x0,y0+bottom,z0],[x1,y0+bottom,z0],[x1,y1+bottom,z1],[x0,y1+bottom,z1]);
      quad([x0,y0+bottom,z0],[x0,y1+bottom,z1],[x0,y1+top,z1],[x0,y0+top,z0]);
      quad([x1,y0+bottom,z0],[x1,y0+top,z0],[x1,y1+top,z1],[x1,y1+bottom,z1]);
      if (i === 0) quad([x0,bottom,z0],[x0,top,z0],[x1,top,z0],[x1,bottom,z0]);
      if (i === n - 1) quad([x0,bottom,z1],[x1,bottom,z1],[x1,top,z1],[x0,top,z1]);
    }
  }
  strip(-0.5, 0.5, -0.4, 0.05);
  strip(-0.5, -0.47, 0.05, 1.05);
  strip(0.47, 0.5, 0.05, 1.05);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createBridges(materials: SceneMaterials) {
  const root = new Group();
  root.name = 'bridges';
  const mesh = new InstancedMesh(bridgeGeometry(), materials.stone, layout.bridges.length);
  const central = layout.bridges.reduce((a, b) => a.len > b.len ? a : b);
  layout.bridges.forEach((bridge, i) => {
    // TODO(verify): SPEC placeholders: 8m wide, central bridge 10m.
    const matrix = new Matrix4().makeScale(bridge === central ? 10 : 8, 1, bridge.len);
    matrix.setPosition(bridge.x, 0, (bridge.z[0] + bridge.z[1]) / 2);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'five-outer-jinshui-bridges';
  mesh.userData.category = 1;
  root.add(mesh);
  return root;
}
