import {
  abs, asin, atan, clamp, cos, float, Fn, fwidth, If, length, max, mix,
  mx_fractal_noise_float, sin, smoothstep, vec2, vec3, vec4,
} from 'three/tsl';
import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three/webgpu';
import { texture } from 'three/tsl';
import { decorationTime, ink } from './params';

// Like pipeline.ts, this graph combines scalar / vector nodes at runtime.
type AnyNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Bounds of the decorative plinth, in world metres. */
export interface InkStage { bounds: [number, number, number, number]; depth: number; ring?: [number, number][] }

// Signed distance to the ring outline (negative inside), baked once on the CPU into a small
// 8-bit texture (~40 m per texel) so the shader does not walk the 90-odd polygon edges per pixel.
const RIM_MIN = -2500, RIM_MAX = 500, RIM_PAD = 800, RIM_SIZE = 256;
function ringDistanceTexture(stage: InkStage, ring: [number, number][]) {
  const [x0, x1, z0, z1] = stage.bounds;
  const ox = x0 - RIM_PAD, oz = z0 - RIM_PAD, sx = x1 - x0 + 2 * RIM_PAD, sz = z1 - z0 + 2 * RIM_PAD;
  const data = new Uint8Array(RIM_SIZE * RIM_SIZE);
  for (let j = 0; j < RIM_SIZE; j++) for (let i = 0; i < RIM_SIZE; i++) {
    const px = ox + (i + 0.5) / RIM_SIZE * sx, pz = oz + (j + 0.5) / RIM_SIZE * sz;
    let best = Infinity, inside = false;
    for (let k = 0, n = ring.length; k < n; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % n];
      const ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez || 1)));
      best = Math.min(best, Math.hypot(px - ax - ex * t, pz - az - ez * t));
      if ((az > pz) !== (bz > pz) && px < ax + (pz - az) / (bz - az) * ex) inside = !inside;
    }
    const d = inside ? -best : best;
    data[j * RIM_SIZE + i] = Math.round(Math.max(0, Math.min(1, (d - RIM_MIN) / (RIM_MAX - RIM_MIN))) * 255);
  }
  const tex = new DataTexture(data, RIM_SIZE, RIM_SIZE, RedFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return (xz: AnyNode) => texture(tex, xz.sub(vec2(ox, oz)).div(vec2(sx, sz))).r.mul(RIM_MAX - RIM_MIN).add(RIM_MIN);
}

/** Shared rounded-box SDF: shadow on the table, white cloud collar in 云上. */
function stageDistance(xz: AnyNode, stage: InkStage, offset = vec2(0)) {
  const [x0, x1, z0, z1] = stage.bounds;
  const q = abs(xz.sub(vec2((x0 + x1) / 2, (z0 + z1) / 2)).sub(offset))
    .sub(vec2((x1 - x0) / 2, (z1 - z0) / 2)).add(900);
  return length(max(q, vec2(0))).add(q.x.max(q.y).min(0)).sub(900);
}

// Field contract (decorative, not weather data): world XZ -> two coordinate warps ->
// cloud tops / hollows -> pale ink and broken 勾云 contours. Every fBm has <= 3 octaves.
function cloudField(xz: AnyNode) {
  const drift = vec2(0.8, 0.6).mul(decorationTime).mul(ink.cloudDrift);
  const p = xz.sub(drift).mul(ink.cloudScale);
  const noise = (q: AnyNode, seed: number) => mx_fractal_noise_float(vec3(q, seed), 3, 2, 0.5);
  const first = vec2(noise(p.mul(0.65), 2.3), noise(p.mul(0.65), 7.1));
  const second = vec2(noise(p.add(first.mul(0.7)), 11.4), noise(p.add(first.mul(0.7)), 18.2));
  const field = noise(p.add(second.mul(0.55)), 4.9).mul(0.5).add(0.5);
  const threshold = mix(0.34, 0.58, ink.cloudCoverage);
  const fw = fwidth(field).max(0.006);
  const tops = smoothstep(threshold.sub(0.13).sub(fw), threshold.add(0.13).add(fw), field);
  const contour = float(1).sub(smoothstep(fw, fw.mul(2).add(0.008), abs(field.sub(threshold))))
    .mul(smoothstep(-0.1, 0.25, first.x));
  const amount = float(1).sub(tops).add(contour.mul(0.16)).mul(ink.cloudInk).mul(ink.cloudCoverage);
  return { amount, field };
}

/** Decorative 云海, three painted ranges and 横云. No extra geometry or render targets.
 * The Fn branches restrict new noise to background / category 8; ordinary city pixels skip it.
 * Channels: X = surroundings ink, Y = plinth retention, Z = moonlight, W = horizontal clouds.
 */
export function createInkBackdrop(dirW: AnyNode, camPos: AnyNode, camHeight: AnyNode,
  background: AnyNode, category: AnyNode, height: AnyNode, skyWash: AnyNode, stage?: InkStage,
  surface?: { position: AnyNode; focus: AnyNode }) {
  const cloudMode = stage ? ink.stageMode.equal(2) : float(0).equal(1);
  const tableMode = stage ? ink.stageMode.equal(1) : float(0).equal(1);
  const az = atan(dirW.x, dirW.z.negate());
  const el = asin(clamp(dirW.y, -1, 1));
  const horizon = atan(camHeight, float(8500)).negate();
  const horizon2 = atan(camHeight.sub(ink.cloudY), ink.horizonDistance.max(1000)).negate();
  const baseHorizon = cloudMode.select(horizon2, horizon);
  // Decorative moon: 115° ESE, 0.12 rad above the cloud horizon (clears the low eastern ranges, stays in the 东望 frame).
  const moonEl = cloudMode.select(horizon2.add(0.12), float(0.085));
  const moonDir = vec3(cos(moonEl).mul(Math.sin(2)), sin(moonEl), cos(moonEl).mul(-Math.cos(2)));
  // Decorative pale winter sun (clear mood): low in the south-west, a little above the ranges.
  const SUN_AZ = -2.2;
  const sunEl = baseHorizon.add(0.09);
  const sunDir = vec3(cos(sunEl).mul(Math.sin(SUN_AZ)), sin(sunEl), cos(sunEl).mul(-Math.cos(SUN_AZ)));
  // 云吞城郭: in 云上 the outer band of the city dissolves into the cloud sea along the cloud's own
  // lobes, so the ring never ends in a cut edge. The band widens as the camera pulls back.
  const ringDistance = stage?.ring && surface ? ringDistanceTexture(stage, stage.ring) : undefined;
  const rimWidth = surface ? clamp(surface.focus.mul(0.09), 160, 800) : float(1);
  const inner = ringDistance && surface ? ringDistance(surface.position.xz).negate() : float(1e5);
  // Geometry below the cloud deck (the plinth side, and MSAA-blended silhouette pixels whose
  // category no longer reads as 8) is cloud as well: decide by world height, not category alone.
  const surfaceY = surface ? surface.position.y : height;
  const underCloud = background.lessThan(0.5).and(category.equal(8).or(surfaceY.lessThan(ink.cloudY)).or(inner.lessThan(rimWidth)));
  const painted = Fn(() => {
    const result = vec4(0, 1, 0, 0).toVar();
    If(background.greaterThan(0.5), () => {
      If(tableMode, () => {
        if (stage) {
          const t = float(-stage.depth).sub(camPos.y).div(dirW.y.min(-1e-4));
          const hit = camPos.xz.add(dirW.xz.mul(t));
          const shadow = float(1).sub(smoothstep(-60, 520, stageDistance(hit, stage, vec2(90, 120))))
            .mul(dirW.y.lessThan(0).select(1, 0));
          result.x.assign(ink.backdrop.add(shadow.mul(ink.tableShadow)));
        }
      }).Else(() => {
        // Decorative mountain silhouettes, not terrain data. West / north high, east / south low.
        const west = smoothstep(-0.35, 0.6, cos(az.add(Math.PI / 3)));
        const range = (k: number, seed: number, base: number, amp: number, density: AnyNode) => {
          const n = mx_fractal_noise_float(vec3(cos(az).mul(k), sin(az).mul(k), seed), 4, 2.1, 0.5);
          const ridge = float(1).sub(abs(n)).pow(2);
          const top = baseHorizon.add(base).add(ridge.mul(amp).mul(west.mul(0.8).add(0.2)));
          const inside = float(1).sub(smoothstep(top.sub(0.0015), top.add(0.0015), el));
          const body = mix(0.5, 1, smoothstep(top.sub(0.035), top, el))
            .mul(smoothstep(top.sub(0.1), top.sub(0.03), el))
            .mul(cloudMode.select(smoothstep(horizon2, horizon2.add(0.036), el), 1));
          return { a: density.mul(body).mul(inside), inside };
        };
        const far = range(2.2, 3.7, 0.022, 0.12, ink.hillInk.mul(0.55));
        const near = range(4.5, 8.1, 0.008, 0.065, ink.hillInk);
        const hills = far.a.toVar();
        If(cloudMode, () => {
          const distant = range(1.1, 19.3, 0.04, 0.16, ink.hillInk.mul(0.3));
          hills.assign(mix(distant.a, far.a, far.inside));
        });
        hills.assign(mix(hills, near.a, near.inside).mul(ink.hills));
        const cloudAz = az.add(decorationTime.mul(0.002));
        const band = mx_fractal_noise_float(vec3(cos(cloudAz).mul(2.6), sin(cloudAz).mul(2.6), el.mul(38)), 3, 2, 0.5);
        const cloud = smoothstep(0.12, 0.45, band).mul(smoothstep(baseHorizon, baseHorizon.add(0.03), el))
          .mul(float(1).sub(smoothstep(baseHorizon.add(0.08), baseHorizon.add(0.22), el))).mul(ink.clouds);
        const haze = smoothstep(baseHorizon.sub(0.005), baseHorizon.add(0.05), el);
        result.x.assign(clamp(skyWash.mul(haze).add(hills), 0, 1).mul(float(1).sub(cloud.mul(0.85))));
        result.w.assign(cloud);
      });
    });
    // The same ray-plane field replaces the hidden bottom of the plinth and the adjacent sky.
    If(cloudMode.and(background.greaterThan(0.5).or(underCloud)), () => {
      const t = ink.cloudY.sub(camPos.y).div(dirW.y.min(-1e-4));
      const valid = dirW.y.lessThan(-1e-4).and(t.greaterThan(0));
      If(valid, () => {
        const hit = camPos.xz.add(dirW.xz.mul(t));
        const clouds = cloudField(hit);
        const fade = float(1).sub(smoothstep(8000, ink.horizonDistance.max(9000), t));
        const collar = stage ? float(1).sub(smoothstep(0, 600, stageDistance(hit, stage).max(0))) : float(0);
        const sea = clouds.amount.mul(fade).mul(float(1).sub(collar.mul(0.82)));
        const seaWeight = float(1).sub(smoothstep(horizon2.sub(0.016), horizon2.add(0.012), el));
        result.x.assign(mix(result.x, sea, seaWeight));
        // Moonlight on the cloud sea: broad, broken by the same hollows; night only.
        const moonAz = cos(az.sub(2)).max(0).pow(24);
        result.z.assign(moonAz.mul(seaWeight).mul(fade).mul(mix(0.5, 1, clouds.field)).mul(ink.night));
        If(underCloud, () => {
          // The plinth's cut side is always under cloud. Ground near the rim fades by distance
          // inside the ring, offset by the cloud field so the edge follows the lobes (虚实相生).
          const reach = inner.div(rimWidth).mul(1.6).sub(float(1).sub(clouds.field).mul(0.6));
          const rim = smoothstep(0.05, 0.7, reach);
          const low = smoothstep(ink.cloudY.sub(30), ink.cloudY, surfaceY);
          result.y.assign(category.equal(8).select(0, rim.mul(low)));
        });
      });
    });
    return result;
  })();
  return { amount: painted.x, plinthKeep: painted.y, moonlight: painted.z, cloud: painted.w,
    moonDir, moonOn: tableMode.select(0, 1), sunDir, sunAz: SUN_AZ, az, el, horizon: baseHorizon };
}
