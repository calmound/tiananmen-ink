import { BoxGeometry, CylinderGeometry } from 'three/webgpu';
import type { HallPlan, Rect } from '../../config/gates';
import type { Bucket } from './build';
import { buildRoof, buildSkirt, type KitStyle } from './roof';

// SPEC 6.3.2: plinth, recessed wall, eave columns, bracket band, then the roof(s).
// TODO(verify): plinth 0.8 m, column Ø 0.9 m, wall set back 0.8 m, bracket spacing 1 m.
const PLINTH = 0.8;
const COLUMN_RADIUS = 0.45;
const WALL_SETBACK = 0.8;
const BRACKET_HEIGHT = 1.4;
const BRACKET_SPACING = 1.0;

export function box(rect: Rect, y0: number, y1: number, grow = 0) {
  return new BoxGeometry(2 * (rect.hx + grow), y1 - y0, 2 * (rect.hz + grow)).translate(rect.cx, (y0 + y1) / 2, rect.cz);
}

function columns(out: Bucket, rect: Rect, bays: [number, number], y0: number, y1: number) {
  const along = rect.hx >= rect.hz;
  const [nx, nz] = along ? bays : [bays[1], bays[0]];
  const xs = Array.from({ length: nx + 1 }, (_, i) => -rect.hx + 2 * rect.hx * i / nx);
  const zs = Array.from({ length: nz + 1 }, (_, i) => -rect.hz + 2 * rect.hz * i / nz);
  const seen = new Set<string>();
  const add = (x: number, z: number) => {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.column.push(new CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS * 1.08, y1 - y0, 10)
      .translate(rect.cx + x, (y0 + y1) / 2, rect.cz + z));
  };
  for (const x of xs) { add(x, -rect.hz); add(x, rect.hz); }
  for (const z of zs) { add(-rect.hx, z); add(rect.hx, z); }
}

/** Two staggered rows of small blocks under an eave: a dense dark band in ink. */
function brackets(out: Bucket, rect: Rect, y0: number, y1: number) {
  const mid = (y0 + y1) / 2;
  const rows = [
    { offset: 0, inset: 0, from: y0, to: mid + 0.1 },
    { offset: BRACKET_SPACING / 2, inset: -0.7, from: mid - 0.1, to: y1 },
  ];
  for (const row of rows) {
    const hx = rect.hx - row.inset, hz = rect.hz - row.inset;
    const edges: [number, number, number, number][] = [
      [-hx, hz, hx, hz], [hx, hz, hx, -hz], [hx, -hz, -hx, -hz], [-hx, -hz, -hx, hz],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const length = Math.hypot(x1 - x0, z1 - z0);
      const count = Math.floor((length - row.offset) / BRACKET_SPACING);
      for (let i = 0; i <= count; i++) {
        const t = (row.offset + i * BRACKET_SPACING) / length;
        const along = x0 === x1;
        out.bracket.push(new BoxGeometry(along ? 0.7 : 0.5, row.to - row.from, along ? 0.5 : 0.7)
          .translate(rect.cx + x0 + (x1 - x0) * t, (row.from + row.to) / 2, rect.cz + z0 + (z1 - z0) * t));
      }
    }
  }
}

const inset = (r: Rect, d: number): Rect => ({ ...r, hx: r.hx - d, hz: r.hz - d });

export function buildHall(out: Bucket, style: KitStyle, plan: HallPlan) {
  const thick = style.eaveThickness;
  const floor = plan.baseY + PLINTH;
  out.stone.push(box(plan.body, plan.baseY, floor, 1.6));
  const firstEave = plan.skirt ? plan.skirt.eaveY : plan.top.eaveY;
  const bodyTop = firstEave - thick;
  out.timber.push(box(inset(plan.body, WALL_SETBACK), floor, bodyTop));
  columns(out, plan.body, plan.bays, floor, bodyTop - BRACKET_HEIGHT);
  brackets(out, plan.body, bodyTop - BRACKET_HEIGHT, bodyTop);
  if (plan.skirt && plan.upperBody) {
    const { outer, inner, eaveY, topY } = plan.skirt;
    buildSkirt(out, style, outer, inner, plan.body, eaveY, topY);
    const upperTop = plan.top.eaveY - thick;
    // Start the upper wall below the skirt's top so no gap shows at the junction.
    out.timber.push(box(inset(plan.upperBody, 0.4), topY - 1, upperTop));
    brackets(out, plan.upperBody, upperTop - BRACKET_HEIGHT * 0.85, upperTop);
    buildRoof(out, style, plan.roof, plan.top.outer, plan.upperBody, plan.top.eaveY, plan.top.ridgeY);
  } else {
    buildRoof(out, style, plan.roof, plan.top.outer, plan.body, plan.top.eaveY, plan.top.ridgeY);
  }
}
