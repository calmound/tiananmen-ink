import { Group, Mesh } from 'three/webgpu';
import { AXIS_X, layout } from '../data/layout';
import { buildHallPlans, GATE_SOURCES, type HallPlan } from '../config/gates';
import type { SceneMaterials, ValueKey } from './materials';
import { emptyBucket, mergeSlot, type Slot } from './kit/build';
import { buildHall } from './kit/hall';
import { buildPlatform, PLATFORM_DEFAULTS } from './kit/platform';
import { KIT_DEFAULTS, type KitStyle } from './kit/roof';

export type GateStyle = KitStyle & { batter: number };
export const GATE_STYLE_DEFAULTS: GateStyle = { ...KIT_DEFAULTS, batter: PLATFORM_DEFAULTS.batter };

export const hallPlans: HallPlan[] = buildHallPlans();

// SPEC 6.3: every gate is assembled from the kit; OSM only supplies sizes.
export function createGates(materials: SceneMaterials, style: GateStyle = GATE_STYLE_DEFAULTS) {
  const root = new Group();
  root.name = 'gates';
  for (const gate of layout.gates) {
    const group = new Group();
    group.name = gate.id;
    const out = emptyBucket();
    const platform = gate.parts.find(p => p.isPlatform)!;
    buildPlatform(out, platform.polygons, gate.platformHeight, GATE_SOURCES[gate.id].doors, AXIS_X, style.batter);
    for (const plan of hallPlans.filter(p => p.gate === gate.id)) buildHall(out, style, plan);
    (Object.keys(out) as Slot[]).forEach(slot => {
      const geometry = mergeSlot(out[slot]);
      if (!geometry) return;
      const mesh = new Mesh(geometry, materials[slot as ValueKey]);
      mesh.name = `${gate.id}-${slot}`;
      mesh.userData = { category: 1, slot };
      group.add(mesh);
    });
    root.add(group);
  }
  return root;
}
