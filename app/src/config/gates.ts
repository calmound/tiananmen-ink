import source from '../../../data/axis-layout.json';
import { AXIS_X, type GateId, type LayoutSource, type RawPart } from '../data/layout';

// SPEC 6.3. Which OSM parts make up each hall is assigned by hand (by part id);
// every size and height is then read from those parts. Form choices and detail
// proportions that the data does not carry are placeholders marked TODO(verify).

export type RoofType = 'xieshan' | 'wudian' | 'cuanjian' | 'yingshan';

/** Axis-aligned rectangle in local metres: centre and half extents. */
export interface Rect { cx: number; cz: number; hx: number; hz: number }

export interface HallSource {
  id: string;
  roof: RoofType;
  /** Wood part from the ground (the column line). Omitted → inner edge of the eave ring. */
  body?: number;
  /** Lower eave ring of a double-eave hall (skillion parts). */
  skirt?: number[];
  /** Ring that continues into the top roof (skillion parts). */
  eave?: number[];
  /** Gabled / pyramidal top part. */
  top: number;
  /** Data gap: use this part mirrored across the axis instead of `top`. */
  topMirror?: boolean;
  /** Bays across the long side and the short side. TODO(verify) */
  bays: [number, number];
  /** Eave overhang when the data has no eave ring (top part only). TODO(verify) */
  overhang?: number;
}

export interface DoorSpec { x: number; width: number; height: number }

// TODO(verify): door centres, widths and heights are SPEC placeholders
// (centre 5 × 8 m, then × 0.85 and × 0.7). Positions are spaced evenly.
const fiveDoors: DoorSpec[] = [
  { x: 0, width: 5, height: 8 },
  ...[-1, 1].flatMap(s => [{ x: 13 * s, width: 4.25, height: 6.8 }, { x: 26 * s, width: 3.5, height: 5.6 }]),
];
const threeDoors: DoorSpec[] = [{ x: 0, width: 5, height: 8 }, { x: -12, width: 4.25, height: 6.8 }, { x: 12, width: 4.25, height: 6.8 }];

export const GATE_SOURCES: Record<GateId, { doors: DoorSpec[]; halls: HallSource[] }> = {
  tiananmen: {
    doors: fiveDoors,
    halls: [
      // TODO(verify): 重檐歇山, 9 × 5 bays (common sources).
      { id: 'tiananmen-main', roof: 'xieshan', body: 637830318, bays: [9, 5],
        skirt: [637830305, 637830311, 637830317, 637830304],
        eave: [637830181, 637830205, 637830191, 637830229], top: 637830242 },
      // Two small parts at the platform's rear corners. TODO(verify): purpose and roof form.
      { id: 'tiananmen-annex-w', roof: 'yingshan', top: 637830905, bays: [3, 1], overhang: 1 },
      { id: 'tiananmen-annex-e', roof: 'yingshan', top: 637830906, bays: [3, 1], overhang: 1 },
    ],
  },
  duanmen: {
    doors: fiveDoors,
    halls: [
      // TODO(verify): treated as identical in form to Tiananmen.
      { id: 'duanmen-main', roof: 'xieshan', body: 637950084, bays: [9, 5],
        skirt: [637950120, 637950091, 637950103, 637950110],
        eave: [637950077, 637950131, 637950127, 637950062], top: 637950096 },
    ],
  },
  wumen: {
    doors: threeDoors,
    halls: [
      // TODO(verify): 重檐庑殿, 9 bays.
      { id: 'wumen-main', roof: 'wudian', body: 638156994, bays: [9, 5],
        skirt: [638156955, 638156970, 638156983, 638156932],
        eave: [638156898, 638156886, 638156871, 638156846], top: 638156914 },
      // Low range joining the main hall to the northern pavilions. TODO(verify): roof form.
      { id: 'wumen-corridor', roof: 'yingshan', body: 638156517, top: 638156505, bays: [15, 1] },
      // 雁翅楼: single eave. TODO(verify): roof form.
      { id: 'wumen-wing-e', roof: 'xieshan', eave: [638156379, 638156444, 638156402], top: 638156484, bays: [13, 2] },
      { id: 'wumen-wing-w', roof: 'xieshan', eave: [638156391, 638156431, 638156417], top: 638156495, bays: [13, 2] },
      // 阙亭: double-eave pyramidal. TODO(verify).
      { id: 'wumen-pavilion-se', roof: 'cuanjian', body: 638156655, bays: [3, 3],
        skirt: [638156553, 638156579, 638156605, 638156629], top: 638156530 },
      { id: 'wumen-pavilion-sw', roof: 'cuanjian', body: 638156665, bays: [3, 3],
        skirt: [638156565, 638156594, 638156617, 638156643], top: 638156542 },
      { id: 'wumen-pavilion-ne', roof: 'cuanjian', body: 638156677, bays: [3, 3],
        skirt: [638156683, 638156700, 638156717, 638156736], top: 638156686 },
      // Data gap: the north-west pavilion has no pyramidal top part; mirror the north-east one.
      { id: 'wumen-pavilion-nw', roof: 'cuanjian', body: 638156830, bays: [3, 3],
        skirt: [638156786, 638156804, 638156817], top: 638156686, topMirror: true },
    ],
  },
};

/** Minimum wall height between a lower skirt and the upper eave. TODO(verify) */
const MIN_UPPER_BODY = 2.5;

export interface HallPlan {
  id: string;
  gate: GateId;
  roof: RoofType;
  bays: [number, number];
  baseY: number;
  body: Rect;
  skirt?: { outer: Rect; inner: Rect; eaveY: number; topY: number };
  upperBody?: Rect;
  top: { outer: Rect; eaveY: number; ridgeY: number };
  notes: string[];
}

const rectOf = (p: RawPart): Rect => ({ cx: (p.x[0] + p.x[1]) / 2, cz: (p.z[0] + p.z[1]) / 2, hx: p.w / 2, hz: p.d / 2 });

/** Union of parts, made symmetric about (cx, cz): one-sided data is mirrored. */
function ringRect(parts: RawPart[], cx: number, cz: number) {
  const hx = Math.max(...parts.flatMap(p => [Math.abs(p.x[0] - cx), Math.abs(p.x[1] - cx)]));
  const hz = Math.max(...parts.flatMap(p => [Math.abs(p.z[0] - cz), Math.abs(p.z[1] - cz)]));
  const sides = parts.filter(p => p.d > p.w), ends = parts.filter(p => p.w >= p.d);
  const side = sides.length ? Math.min(...sides.map(p => p.w)) : Math.min(...ends.map(p => p.d));
  const end = ends.length ? Math.min(...ends.map(p => p.d)) : side;
  return {
    outer: { cx, cz, hx, hz },
    inner: { cx, cz, hx: hx - side, hz: hz - end },
    eaveY: Math.min(...parts.map(p => p.min_h)),
    topY: Math.max(...parts.map(p => p.h ?? 0)),
  };
}

export function buildHallPlans(data: LayoutSource = source as unknown as LayoutSource) {
  const plans: HallPlan[] = [];
  (Object.keys(GATE_SOURCES) as GateId[]).forEach(gate => {
    const raw = data.gates[gate];
    const byId = (id: number) => {
      const part = raw.find(p => p.id === id);
      if (!part) throw new Error(`${gate} 缺少部件 ${id}`);
      return part;
    };
    const platform = raw.find(p => p.role === 'platform') ?? raw.find(p =>
      p.role === 'part' && p.min_h === 0 && (p.material === 'concrete' || p.material === 'brick'))!;
    const baseY = platform.h!;
    for (const src of GATE_SOURCES[gate].halls) {
      const notes: string[] = [];
      const topPart = byId(src.top);
      let topRect = rectOf(topPart);
      if (src.topMirror) {
        const body = rectOf(byId(src.body!));
        topRect = { ...topRect, cx: 2 * AXIS_X - topRect.cx, cz: body.cz };
        notes.push(`顶部数据缺失，按部件 ${src.top} 沿中轴镜像补齐`);
      }
      const ridgeY = topPart.h!;
      const topBase = ridgeY - (topPart.roof_h ?? 0);
      const center = src.body ? rectOf(byId(src.body)) : topRect;
      let body: Rect;
      let top: HallPlan['top'];
      if (src.eave) {
        const ring = ringRect(src.eave.map(byId), topRect.cx, topRect.cz);
        if (Math.abs(ring.topY - topBase) > 0.6) notes.push(`檐口环顶部 ${ring.topY} 与屋顶基部 ${topBase} 不连续`);
        top = { outer: ring.outer, eaveY: ring.eaveY, ridgeY };
        body = src.body ? rectOf(byId(src.body)) : ring.inner;
      } else {
        const overhang = src.overhang ?? 0;
        top = { outer: topRect, eaveY: topBase, ridgeY };
        body = src.body ? rectOf(byId(src.body)) : { ...topRect, hx: topRect.hx - overhang, hz: topRect.hz - overhang };
        if (!src.body) notes.push(`没有殿身部件，按屋顶外缘内收 ${overhang} 米`);
      }
      const plan: HallPlan = { id: src.id, gate, roof: src.roof, bays: src.bays, baseY, body, top, notes };
      if (src.skirt) {
        const ring = ringRect(src.skirt.map(byId), center.cx, center.cz);
        let topY = ring.topY;
        if (top.eaveY - topY < MIN_UPPER_BODY) {
          notes.push(`下檐顶 ${topY} 到上檐口 ${top.eaveY} 不足 ${MIN_UPPER_BODY} 米，下檐顶降为 ${top.eaveY - MIN_UPPER_BODY}`);
          topY = top.eaveY - MIN_UPPER_BODY;
        }
        plan.skirt = { outer: ring.outer, inner: ring.inner, eaveY: ring.eaveY, topY };
        // Upper storey sits inside both the skirt's inner edge and the top eave.
        const upperFromTop = src.eave ? ringRect(src.eave.map(byId), topRect.cx, topRect.cz).inner
          : { ...top.outer, hx: top.outer.hx - 2, hz: top.outer.hz - 2 };
        plan.upperBody = { cx: center.cx, cz: center.cz,
          hx: Math.min(ring.inner.hx, upperFromTop.hx), hz: Math.min(ring.inner.hz, upperFromTop.hz) };
        if (src.topMirror) top = { ...top, outer: { ...top.outer, cx: center.cx, cz: center.cz } };
      }
      plan.top = top;
      plans.push(plan);
    }
  });
  return plans;
}
