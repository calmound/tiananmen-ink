import source from '../../../data/axis-layout.json';

export type Point = [number, number];
export type GateId = 'tiananmen' | 'duanmen' | 'wumen';
export interface RawPart {
  role: string;
  id: number;
  poly?: Point[];
  rings?: Point[][];
  x: [number, number];
  z: [number, number];
  w: number;
  d: number;
  min_h: number;
  h: number | null;
  roof: 'skillion' | 'gabled' | 'pyramidal' | null;
  roof_h: number | null;
  roof_dir: number | null;
  material: string | null;
  colour: string | null;
}
export interface LayoutSource {
  gates: Record<GateId, RawPart[]>;
  bridges: { name: string; x: number; z: [number, number]; len: number }[];
  columns: { x: number; z: number; h: number }[];
}
export interface PartPlan extends RawPart {
  gate: GateId;
  polygons: Point[][];
  isPlatform: boolean;
  bottom: number;
  top: number;
  roofBase: number;
  snappedRoofDirection: number | null;
}

const same = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02;

// OSM outer ways may be open fragments. Stitch endpoints before triangulating.
// Independent, already closed outer rings remain independent polygons.
export function assembleRings(rings: Point[][]): Point[][] {
  const pending = rings.map(ring => ring.map(p => [...p] as Point));
  const polygons: Point[][] = [];
  while (pending.length) {
    const chain = pending.shift()!;
    while (!same(chain[0], chain[chain.length - 1])) {
      const index = pending.findIndex(ring =>
        same(chain[chain.length - 1], ring[0]) || same(chain[chain.length - 1], ring[ring.length - 1]));
      if (index < 0) throw new Error('城台轮廓片段未闭合，请检查布局数据');
      const next = pending.splice(index, 1)[0];
      if (!same(chain[chain.length - 1], next[0])) next.reverse();
      chain.push(...next.slice(1));
    }
    polygons.push(chain.slice(0, -1));
  }
  return polygons;
}

function openPolygon(points: Point[]): Point[] {
  return same(points[0], points[points.length - 1]) ? points.slice(0, -1) : points;
}

export function buildLayout(data: LayoutSource) {
  const corrections: { gate: GateId; id: number; from: number; to: number }[] = [];
  const skipped: { gate: GateId; id: number; reason: string }[] = [];
  const anomalies: { gate: GateId; id: number; reason: string }[] = [];
  const gates = (Object.entries(data.gates) as [GateId, RawPart[]][]).map(([id, raw]) => {
    const platform = raw.find(p => p.role === 'platform') ?? raw.find(p =>
      p.role === 'part' && p.min_h === 0 && (p.material === 'concrete' || p.material === 'brick'));
    if (!platform?.h) throw new Error(`${id} 缺少城台高度`);
    const mainHall = raw.filter(p => p.role === 'part' && p.material === 'wood' && p.min_h === 0)
      .sort((a, b) => b.w - a.w)[0];
    if (!mainHall) throw new Error(`${id} 缺少主殿轮廓`);
    const center: Point = [(mainHall.x[0] + mainHall.x[1]) / 2, (mainHall.z[0] + mainHall.z[1]) / 2];
    const parts = raw.flatMap((part): PartPlan[] => {
      if ((part.role !== 'part' && part.role !== 'platform') || part.h === null) {
        skipped.push({ gate: id, id: part.id, reason: part.role === 'outline' ? 'outline' : '未分类部件' });
        return [];
      }
      const bottom = part.material === 'wood' && part.min_h === 0 ? platform.h! : part.min_h;
      if (bottom !== part.min_h) corrections.push({ gate: id, id: part.id, from: part.min_h, to: bottom });
      const roofBase = part.h - (part.roof_h ?? 0);
      const roofDirection = part.roof_dir ?? null;
      if (bottom > roofBase) anomalies.push({ gate: id, id: part.id, reason: '起始高度高于屋顶基部；仅生成屋顶，不倒向拉伸' });
      return [{ ...part, roof: part.roof ?? null, roof_h: part.roof_h ?? null,
        roof_dir: roofDirection, gate: id, bottom, top: part.h, roofBase,
        isPlatform: part.id === platform.id,
        polygons: part.rings ? assembleRings(part.rings) : [openPolygon(part.poly!)],
        snappedRoofDirection: roofDirection === null ? null : ((Math.round(roofDirection / 90) * 90) % 360 + 360) % 360,
      }];
    });
    return { id, center, platformHeight: platform.h, height: Math.max(...parts.map(p => p.top)), parts };
  });
  const outerBridges = data.bridges.filter(bridge => bridge.name === '外金水桥');
  return {
    gates,
    axisX: gates.reduce((sum, gate) => sum + gate.center[0], 0) / gates.length,
    bridges: outerBridges,
    columns: data.columns,
    river: {
      z: outerBridges.reduce((sum, bridge) => sum + (bridge.z[0] + bridge.z[1]) / 2, 0) / outerBridges.length,
      width: Math.min(...outerBridges.map(bridge => bridge.len)) * 0.6,
    },
    corrections, skipped, anomalies,
  };
}

export const layout = buildLayout(source as unknown as LayoutSource);
export const AXIS_X = layout.axisX;
