import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4 } from 'three/webgpu';
import { layout } from '../data/layout';
import { mergeParts } from './geometry';
import type { SceneMaterials } from './materials';

export function createColumns(materials: SceneMaterials) {
  const root = new Group();
  root.name = 'columns';
  // TODO(verify): 1m shaft diameter from SPEC; disk, base and cloud board
  // are schematic within the data's total 11m height.
  const parts = [
    new CylinderGeometry(0.5, 0.5, 10.3, 12).translate(0, 5.45, 0),
    new CylinderGeometry(1.05, 1.2, 0.3, 12).translate(0, 0.15, 0),
    new CylinderGeometry(1.05, 0.85, 0.4, 12).translate(0, 10.8, 0),
    new BoxGeometry(3.4, 0.55, 0.35).translate(0, 8.7, 0),
  ];
  const mesh = new InstancedMesh(mergeParts(parts), materials.stone, layout.columns.length);
  layout.columns.forEach((column, i) => {
    const matrix = new Matrix4().makeScale(1, column.h / 11, 1);
    matrix.setPosition(column.x, 0, column.z);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'four-huabiao';
  mesh.userData.category = 1;
  root.add(mesh);
  return root;
}
