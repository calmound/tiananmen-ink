import { DoubleSide, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  abs, clamp, color, float, floor, fract, fwidth, hash, mix, mrt, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2, normalWorld,
  positionWorld, screenUV, smoothstep, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { palette } from '../config/palette';
import { ink } from '../render/ink/params';

// SPEC 7.2 value plan. Until the ink pipeline exists (P3), every surface is an
// unlit paper-to-ink mix: base ink amount per category plus a little facing
// shade so form still reads. 0 = paper, 1 = scorched ink.
export const VALUE_DEFAULTS = {
  ground: 0.0,
  roof: 0.42,       // grey tiles; snow (⑤) whitens the up-facing parts
  stone: 0.1,       // marble bridges, huabiao, river banks, hall plinths
  platform: 0.32,   // red walls and platforms (mid tone + cinnabar)
  timber: 0.66,     // hall walls, eave fascia and soffit
  column: 0.5,      // eave columns (cinnabar)
  bracket: 0.84,    // bracket band: darkest line under each eave
  ridge: 0.4,       // ridges and ornaments
  gable: 0.38,      // 山花 (cinnabar)
  door: 0.92,       // door openings: darkest in the picture
  water: 0.42,
  brick: 0.3,       // hutong grey-brick walls
  modern: 0.14,     // modern facades (light concrete / stone)
  road: 0.06,       // paved roads, barely darker than snow
  plinth: 0.5,      // 沙盘 plinth: the cut section under the city, in shade
  shading: 0.22,    // how much faces turned from the light darken
  skyTop: 0.3,
  skyHorizon: 0.12,
  tileSpacing: 0.55, // SPEC 6.3.3 瓦垄 spacing (metres)
  tileStrength: 0.45,
};
const CINNABAR: Record<string, number> = { platform: 0.38, timber: 0.18, column: 0.32, gable: 0.25 };
// SPEC 7.3 meta: cinnabar wash weight and category per value class.
const WASH: Record<string, number> = { platform: 0.9, column: 0.8, gable: 0.6, timber: 0.2 };
export const CATEGORY = { paper: 0, building: 1, ground: 2, plant: 3, snowfall: 4, water: 5, marker: 6, road: 7, plinth: 8 } as const;
const CATEGORY_OF: Record<string, number> = { ground: CATEGORY.ground, water: CATEGORY.water, road: CATEGORY.road, plinth: CATEGORY.plinth };

/**
 * Ink-pipeline outputs every material adds to the scene pass (SPEC 7.3, P3):
 *  tone  = (ink amount, cinnabar weight, snow mask, category / 8)
 *  grain = (world noise A, world noise B, world height, 1)
 * Noise is sampled in world space so it stays on the buildings when the camera moves.
 */
export function worldGrain() {
  const p = positionWorld.mul(ink.noiseScale);
  const a = mx_fractal_noise_float(p, 3, 2, 0.5).mul(0.5).add(0.5).clamp(0, 1);
  const b = mx_noise_float(p.mul(3.7).add(11.3)).mul(0.5).add(0.5).clamp(0, 1);
  // 云气: large drifting bands in the ground plane; 1 = fully veiled in mist.
  const drift = vec2(time.mul(ink.mistSpeed), time.mul(ink.mistSpeed).mul(0.35));
  const m = mx_fractal_noise_float(vec3(positionWorld.xz.add(drift).mul(ink.mistScale), 0.7), 4, 2.1, 0.55);
  const mist = smoothstep(0.05, 0.45, m).mul(smoothstep(60, 0, positionWorld.y).mul(0.4).add(0.6));
  return { a, b, node: vec4(a, b, positionWorld.y, mist) };
}
type FloatNode = Node<'float'>;
export function inkOutputs(amount: FloatNode, wash: number | FloatNode, snow: FloatNode, category: number) {
  const grain = worldGrain();
  // Dry/wet variation lives in the ink, not on bare paper (snowfields stay clean).
  const wet = grain.a.sub(0.5).mul(2).mul(ink.noiseStrength).mul(smoothstep(0.02, 0.2, amount));
  const tone = vec4(clamp(amount.add(wet), 0, 1), wash, snow, category / 8);
  return mrt({ tone, grain: grain.node });
}

export type ValueKey = 'ground' | 'roof' | 'stone' | 'platform' | 'timber' | 'column' | 'bracket' | 'ridge' | 'gable' | 'door' | 'water' | 'brick' | 'modern' | 'road' | 'plinth';
export const VALUE_KEYS: ValueKey[] = ['ground', 'roof', 'stone', 'platform', 'timber', 'column', 'bracket', 'ridge', 'gable', 'door', 'water', 'brick', 'modern', 'road', 'plinth'];

export function createMaterials() {
  const shading = uniform(VALUE_DEFAULTS.shading);
  const tileSpacing = uniform(VALUE_DEFAULTS.tileSpacing);
  const tileStrength = uniform(VALUE_DEFAULTS.tileStrength);
  const light = vec3(0.35, 0.82, 0.45).normalize();
  const paper = color(palette.paper), inkColor = color(palette.ink), cinnabar = color(palette.cinnabar);
  const uniforms = {} as Record<ValueKey, typeof shading>;

  // Tile rows (瓦垄): thin dark lines at constant uv.x (metres along the eave),
  // faded out once they get denser than a few pixels to avoid moiré.
  const along = uv().x;
  const toLine = float(0.5).sub(fract(along.div(tileSpacing)).sub(0.5).abs()).mul(tileSpacing);
  const footprint = fwidth(along);
  const tileLine = float(1).sub(smoothstep(float(0.04), footprint.add(0.05), toLine))
    .mul(float(1).sub(smoothstep(tileSpacing.mul(0.18), tileSpacing.mul(0.45), footprint)));

  const make = (key: ValueKey) => {
    const base = uniform(VALUE_DEFAULTS[key]);
    uniforms[key] = base;
    const facing = float(0.5).sub(normalWorld.dot(light).mul(0.5));
    let amount: FloatNode = base.add(shading.mul(facing).mul(key === 'ground' ? 0 : 1));
    let snow: FloatNode = float(0);
    let wash: number | FloatNode = WASH[key] ?? 0;
    if (key === 'road') amount = ink.roadInk.add(float(0));
    if (key === 'water') {
      // Ripple strokes running east–west, wavering with world noise; they thin out with distance.
      const w = positionWorld;
      const wobble = mx_noise_float(vec3(w.x.mul(0.012), w.z.mul(0.012), 3.3)).mul(ink.rippleSpacing.mul(0.6));
      const row = fract(w.z.add(wobble).div(ink.rippleSpacing)).sub(0.5).abs().mul(ink.rippleSpacing);
      const fw = fwidth(w.z);
      const stroke = float(1).sub(smoothstep(float(0.15), fw.add(0.5), row))
        .mul(smoothstep(0.1, 0.5, mx_noise_float(vec3(w.x.mul(0.05), w.z.mul(0.2), 7.1))))
        .mul(float(1).sub(smoothstep(ink.rippleSpacing.mul(0.12), ink.rippleSpacing.mul(0.35), fw)));
      const open = ink.waterInk.add(stroke.mul(ink.ripple));
      // 冰面 (winter): the lakes freeze. Cracks follow cell borders (F2 − F1 small) of a wandering
      // Worley field at two scales; snow lies on the ice in long east–west drifts. All in world
      // space, so nothing swims when the view moves; cracks thin out once they get denser than pixels.
      const warp = vec2(mx_noise_float(vec3(w.x.mul(0.02), w.z.mul(0.02), 1.3)), mx_noise_float(vec3(w.x.mul(0.02), w.z.mul(0.02), 8.1))).mul(0.35);
      const crackAt = (scale: number, weight: number) => {
        const cells = mx_worley_noise_vec2(vec2(w.x, w.z).mul(ink.crackScale).mul(scale).add(warp));
        const gap = cells.y.sub(cells.x);
        const fwc = fwidth(gap);
        return float(1).sub(smoothstep(float(0.015), fwc.mul(1.2).add(0.03), gap))
          .mul(float(1).sub(smoothstep(0.12, 0.35, fwc))).mul(weight);
      };
      // Real ice cracks come in runs, not a honeycomb: a large noise keeps only some borders.
      const runs = smoothstep(-0.05, 0.3, mx_noise_float(vec3(w.x.mul(0.009), w.z.mul(0.009), 4.2)));
      const fineRuns = smoothstep(0.15, 0.45, mx_noise_float(vec3(w.x.mul(0.02), w.z.mul(0.02), 9.7)));
      const cracks = crackAt(1, 1).mul(runs).max(crackAt(2.6, 0.5).mul(runs).mul(fineRuns));
      const drift = smoothstep(0.05, 0.4, mx_fractal_noise_float(vec3(w.x.mul(0.006), w.z.mul(0.022), 5.5), 3, 2, 0.5));
      const frozen = ink.iceInk.mul(float(1).sub(drift.mul(ink.iceSnow).mul(1.6).clamp(0, 1)))
        .add(cracks.mul(ink.crack).mul(float(1).sub(drift.mul(0.8))));
      amount = mix(open, frozen, ink.ice);
    }
    if (['platform', 'brick', 'modern', 'timber'].includes(key)) {
      // 皴擦: dry horizontal rubbing on vertical faces, anchored in world space.
      const w = positionWorld;
      const streak = mx_noise_float(vec3(w.x.add(w.z).mul(0.35), w.y.mul(5), 1.9));
      const vertical = float(1).sub(abs(normalWorld.y));
      amount = amount.add(smoothstep(0.25, 0.75, streak).mul(ink.texture).mul(vertical));
      // Wall foot: a darker band where the wall meets the snow (walls stand on flat ground; 景山 aside).
      if (key === 'platform') amount = amount.add(float(1).sub(smoothstep(0.2, 2.2, w.y)).mul(0.14).mul(vertical));
    }
    if (key === 'brick' || key === 'modern') {
      // 窗光 (snowy night): a scattering of lit windows on house walls and modern facades. The
      // glow is carried to the ink pipeline as a negative value in the snow channel (tone.z, which
      // only roofs use); the pipeline shows it only at night. Walls have uv in metres (along, up).
      const along = uv().x, up = uv().y;
      const spacing = key === 'brick' ? 3.4 : 2.6;
      const col = floor(along.div(spacing));
      const row = key === 'brick' ? float(0) : floor(up.div(3.3));
      const inX = smoothstep(0.28, 0.33, fract(along.div(spacing))).mul(smoothstep(0.72, 0.67, fract(along.div(spacing))));
      const inY = key === 'brick'
        ? smoothstep(1.0, 1.1, up).mul(smoothstep(2.2, 2.1, up))
        : smoothstep(0.35, 0.42, fract(up.div(3.3))).mul(smoothstep(0.8, 0.73, fract(up.div(3.3)))).mul(smoothstep(2.5, 3.3, up));
      const w = positionWorld;
      const seed = col.mul(13.1).add(row.mul(71.7)).add(floor(w.x.mul(0.05)).mul(3.7)).add(floor(w.z.mul(0.05)).mul(29.3));
      const lit = hash(seed).lessThan(key === 'brick' ? 0.32 : 0.16).select(1, 0);
      const vertical = float(1).sub(abs(normalWorld.y)).greaterThan(0.9).select(1, 0);
      // Windows give way once they get smaller than a few pixels (no shimmer when zoomed out).
      const near = float(1).sub(smoothstep(0.7, 1.8, fwidth(along)));
      snow = inX.mul(inY).mul(lit).mul(vertical).mul(near).mul(hash(seed.add(5.3)).mul(0.5).add(0.5)).negate();
    }
    if (key === 'plinth') {
      // 沙盘剖面: the cut side of the plinth reads as earth strata — thin wavering layer lines,
      // darker towards the foot, dry rubbing along the layers, and a white lip of snow at the top.
      const w = positionWorld;
      const along = w.x.add(w.z);
      // Layers of uneven thickness that swell and pinch along the side, drawn as thin dry lines
      // with gaps (飞白), not as evenly spaced stripes.
      const waver = mx_noise_float(vec3(along.mul(0.002), 0.5, 2.7)).mul(22).add(mx_noise_float(vec3(along.mul(0.011), 1.5, 6.1)).mul(5));
      const depthIn = w.y.add(waver).negate();
      const spacing = mx_noise_float(vec3(along.mul(0.0008), depthIn.mul(0.004), 3.3)).mul(10).add(30);
      const layer = fract(depthIn.div(spacing)).sub(0.5).abs();
      const fwl = fwidth(depthIn.div(spacing));
      const line = float(1).sub(smoothstep(fwl.mul(0.7), fwl.mul(1.6).add(0.012), layer.sub(0.485).abs()));
      const gaps = smoothstep(0.0, 0.35, mx_noise_float(vec3(along.mul(0.012), depthIn.mul(0.03), 8.8)));
      const strata = line.mul(gaps).mul(float(1).sub(smoothstep(0.08, 0.25, fwl)));
      // Vertical dry rubbing (皴) and a gentle darkening towards the foot.
      const rub = smoothstep(0.35, 0.85, mx_noise_float(vec3(along.mul(0.05), w.y.mul(0.015), 4.4)));
      amount = base.add(smoothstep(0, -300, w.y).mul(0.16)).add(strata.mul(0.24)).add(rub.mul(0.1))
        .mul(smoothstep(-1, -6, w.y));
    }
    if (key === 'roof') {
      // ⑤ Snow rests where the roof faces up; tile rows show through at ~30%.
      snow = smoothstep(ink.snowLow, ink.snowHigh, normalWorld.y).mul(ink.snowOn);
      amount = amount.mul(float(1).sub(snow.mul(ink.snowStrength)))
        .add(tileLine.mul(tileStrength).mul(float(1).sub(snow.mul(0.7))));
      // 琉璃黄: the halls of the Forbidden City, 太庙 and 天安门 are roofed in yellow glazed tile
      // (a few exceptions in other colours are ignored). The colour shows where snow leaves the
      // tiles bare. Same rough rectangle as the palace test in city.ts; carried as negative wash.
      const w = positionWorld;
      const inPalace = smoothstep(-410, -390, w.x).mul(smoothstep(410, 390, w.x))
        .mul(smoothstep(-1560, -1540, w.z)).mul(smoothstep(-20, -40, w.z));
      // Snow on glazed tile still glows a pale gold, so the yellow city reads under snow too.
      // Only pitched tile: flat caps on untagged palace platforms (city.ts) share the roof slot.
      const pitched = smoothstep(0.995, 0.97, normalWorld.y);
      wash = inPalace.mul(pitched).mul(mix(1, 0.4, snow.mul(ink.snowStrength))).negate();
    }
    if (key === 'ridge') {
      // Ridges and ornaments of the same palace roofs are glazed yellow as well.
      const w = positionWorld;
      wash = smoothstep(-410, -390, w.x).mul(smoothstep(410, 390, w.x))
        .mul(smoothstep(-1560, -1540, w.z)).mul(smoothstep(-20, -40, w.z)).negate();
    }
    const clamped = clamp(amount, 0, 1);
    const material = new MeshBasicNodeMaterial();
    material.colorNode = mix(mix(paper, inkColor, clamped), cinnabar, float(CINNABAR[key] ?? 0).mul(clamped.oneMinus()));
    material.name = `value-${key}`;
    material.mrtNode = inkOutputs(clamped, wash, snow, CATEGORY_OF[key] ?? CATEGORY.building);
    // Kit grids are oriented, but door decals and thin parts are safer double-sided.
    if (key === 'door' || key === 'gable') material.side = DoubleSide;
    // Flat ground layers: a depth bias keeps road over snow and water over road at any distance.
    if (key === 'road' || key === 'water') {
      material.polygonOffset = true;
      material.polygonOffsetFactor = key === 'water' ? -2 : -1;
      material.polygonOffsetUnits = key === 'water' ? -8 : -4;
    }
    return material;
  };
  const materials = Object.fromEntries(VALUE_KEYS.map(key => [key, make(key)])) as Record<ValueKey, MeshBasicNodeMaterial>;
  const skyTop = uniform(VALUE_DEFAULTS.skyTop);
  const skyHorizon = uniform(VALUE_DEFAULTS.skyHorizon);
  const skyOn = uniform(1);
  // Cover only: wash the sky with pale ink so snow reads as paper ("以墨衬白").
  const skyAmount = mix(skyTop, skyHorizon, smoothstep(0.0, 0.62, screenUV.y)).mul(skyOn);
  const background = mix(paper, inkColor, skyAmount);
  return { ...materials, uniforms, shading, tileSpacing, tileStrength, skyTop, skyHorizon, skyOn, skyAmount, background };
}

export type SceneMaterials = ReturnType<typeof createMaterials>;
