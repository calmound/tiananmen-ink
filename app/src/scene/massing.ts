import { Group, Mesh, type BufferGeometry } from 'three/webgpu';
import { layout } from '../data/layout';
import type { SceneMaterials } from './materials';
import { createRoof, extrudePolygon, mergeParts } from './geometry';

export function createMassing(materials: SceneMaterials) {
  const root = new Group();
  root.name = 'gate-massing';
  layout.gates.forEach(gate => {
    const group = new Group();
    group.name = gate.id;
    const slots: Record<string, BufferGeometry[]> = { platform: [], timber: [], roof: [] };
    gate.parts.forEach(part => part.polygons.forEach(polygon => {
      const bodyTop = part.roof ? part.roofBase : part.top;
      if (bodyTop > part.bottom) slots[part.isPlatform ? 'platform' : 'timber']
        .push(extrudePolygon(polygon, part.bottom, bodyTop));
      if (part.roof && part.top > part.roofBase) slots.roof.push(createRoof(part, polygon));
    }));
    Object.entries(slots).forEach(([slot, geometries]) => {
      if (!geometries.length) return;
      const mesh = new Mesh(mergeParts(geometries), materials[slot as 'platform' | 'timber' | 'roof']);
      mesh.name = `${gate.id}-${slot}`;
      mesh.userData = { category: 1, cinnabarWeight: slot === 'roof' ? 0 : 0.7, roof: slot === 'roof' };
      group.add(mesh);
    });
    root.add(group);
  });
  return root;
}
