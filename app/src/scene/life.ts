import {
  AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3, type PerspectiveCamera,
} from 'three/webgpu';
import {
  abs, attribute, cameraPosition, cos, float, hash, instanceIndex, length, max, mrt, mx_noise_float, positionLocal, positionWorld,
  sin, smoothstep, time, uniform, uv, vec3, vec4,
} from 'three/tsl';
import type { Label } from './city';
import { CATEGORY } from './materials';
import { decorationTime, ink } from '../render/ink/params';

// Life in the painting: lanterns that light up on the snowy night, and flocks of crows (寒鸦).

function instanced(base: BufferGeometry, count: number, attrs: Record<string, number[]>, size: number) {
  const g = new InstancedBufferGeometry();
  g.index = base.index;
  for (const name of ['position', 'normal', 'uv']) if (base.getAttribute(name)) g.setAttribute(name, base.getAttribute(name));
  for (const [name, data] of Object.entries(attrs)) g.setAttribute(name, new InstancedBufferAttribute(new Float32Array(data), size));
  g.instanceCount = count;
  return g;
}

/** Lantern spots under the eaves of the landmarks: a cinnabar dot in the scene plus a soft warm halo in the overlay. */
export function createLanterns(labels: Label[]) {
  const spots: number[] = [];
  for (const l of labels) {
    if (l.tier !== 2 || !l.info?.height) continue;
    const [x, y, z] = l.position;
    const top = y - 4;
    const half = Math.max(6, l.size * 0.42);
    const h = Math.max(6, top * 0.55);
    // A pair on the south face, a pair on the north face.
    for (const [dx, dz] of [[-0.5, 0.6], [0.5, 0.6], [-0.5, -0.6], [0.5, -0.6]]) spots.push(x + dx * half, h, z + dz * half * 0.6);
  }
  const count = spots.length / 3;
  const dotGeometry = instanced(new PlaneGeometry(1, 1.3), count, { spot: spots }, 3);
  const dotMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const right = uniform(new Vector3(1, 0, 0)), up = uniform(new Vector3(0, 1, 0));
  const spot = attribute('spot', 'vec3');
  dotMaterial.positionNode = spot.add(right.mul(positionLocal.x).mul(1.4)).add(up.mul(positionLocal.y).mul(1.4));
  dotMaterial.mrtNode = mrt({ tone: vec4(0.25, 1, 0, CATEGORY.marker / 8), grain: vec4(0.5, 0.5, positionWorld.y, 0) });
  const dots = new Mesh(dotGeometry, dotMaterial);
  dots.frustumCulled = false;
  dots.name = 'lanterns';

  const haloGeometry = instanced(new PlaneGeometry(1, 1), count, { spot: spots }, 3);
  const haloMaterial = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending });
  const flicker = sin(time.mul(3.1).add(spot.x.mul(0.37))).mul(0.08).add(0.92);
  // Small halos that hug the eaves (a large soft halo read as a floating light orb).
  haloMaterial.positionNode = spot.add(right.mul(positionLocal.x).mul(9)).add(up.mul(positionLocal.y).mul(9));
  haloMaterial.colorNode = vec3(0, 0, smoothstep(0.5, 0.0, length(uv().sub(0.5))).pow(1.3).mul(1.0).mul(flicker));
  const halos = new Mesh(haloGeometry, haloMaterial);
  halos.frustumCulled = false;
  halos.name = 'lantern-halos';

  return {
    dots, halos, count,
    // The red lanterns hang by day as well (点红 in the snow); only the halos light up at night.
    set lit(v: boolean) { halos.visible = v; },
    update(camera: PerspectiveCamera) {
      right.value.setFromMatrixColumn(camera.matrixWorld, 0);
      up.value.setFromMatrixColumn(camera.matrixWorld, 1);
    },
  };
}

/** Flocks of crows circling over a few open places; positions come from time on the GPU. */
export function createCrows(centres: [number, number][], perFlock = 16, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const data = { flock: [] as number[], orbit: [] as number[] };
  for (const [cx, cz] of centres) {
    const radius = 90 + rnd() * 160, height = 60 + rnd() * 50, speed = (0.05 + rnd() * 0.04) * (rnd() < 0.5 ? -1 : 1);
    for (let i = 0; i < perFlock; i++) {
      data.flock.push(cx + (rnd() - 0.5) * 30, height + (rnd() - 0.5) * 14, cz + (rnd() - 0.5) * 30);
      data.orbit.push(radius * (0.85 + rnd() * 0.3), rnd() * 0.6, speed * (0.9 + rnd() * 0.2));
    }
  }
  // A crow: two swept wings as thin triangles (wingspan ~1, scaled below).
  const wing = new BufferGeometry();
  wing.setAttribute('position', new Float32BufferAttribute([0, 0, 0.15, -0.5, 0.05, -0.1, 0, 0, -0.1, 0, 0, 0.15, 0.5, 0.05, -0.1, 0, 0, -0.1], 3));
  wing.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', wing.getAttribute('position'));
  g.setAttribute('normal', wing.getAttribute('normal'));
  g.setAttribute('flock', new InstancedBufferAttribute(new Float32Array(data.flock), 3));
  g.setAttribute('orbit', new InstancedBufferAttribute(new Float32Array(data.orbit), 3));
  g.instanceCount = data.flock.length / 3;
  const flock = attribute('flock', 'vec3'), orbit = attribute('orbit', 'vec3');
  // Birds of one flock share a circle, a little spread along it.
  const angle = time.mul(orbit.z).add(orbit.y.mul(1.2));
  const span = float(5);
  // Flap: wing tips rise and fall; heading follows the circle's tangent.
  const local = positionLocal.mul(span);
  const flapped = vec3(local.x, local.y.add(abs(local.x).mul(sin(time.mul(7).add(orbit.y.mul(40))).mul(0.55))), local.z);
  const heading = angle.add(orbit.z.sign().mul(Math.PI / 2));
  const c = cos(heading), sn = sin(heading);
  const turned = vec3(flapped.x.mul(c).sub(flapped.z.mul(sn)), flapped.y, flapped.x.mul(sn).add(flapped.z.mul(c)));
  const centre = flock.add(vec3(cos(angle).mul(orbit.x), sin(time.mul(0.4).add(orbit.y.mul(9))).mul(5), sin(angle).mul(orbit.x)));
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = centre.add(turned);
  material.mrtNode = mrt({ tone: vec4(0.88, 0, 0, CATEGORY.building / 8), grain: vec4(0.5, 0.5, positionWorld.y, 0) });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.name = 'crows';
  return { mesh, count: g.instanceCount };
}

/** Decorative 北雁南飞: authored routes, not observed migration or geographic data.
 * Metres / seconds, height above cloudY; centres and route ends remain outside the plinth.
 */
/** Fraction of a route's height flown above the camera (see createGeese). */
export const GEESE_EYE_LIFT = 0.22;
/** Smallest on-screen wingspan, CSS pixels: below ~6 px a flock reads as dust, not 雁阵. */
export const GEESE_MIN_PX = 9;

export const GEESE_ROUTES = [
  // Heights are well above the camera of the low views, so the flocks cross the sky over the
  // ranges rather than skim the cloud sea.
  { x: -6500, z: -3500, height: 1300, heading: 0.12, length: 4800, speed: 17, count: 13, phase: 0 },
  { x: -1800, z: -7000, height: 1100, heading: 0.55, length: 2600, speed: 15, count: 11, phase: 280 },
  { x: 7300, z: 500, height: 950, heading: -0.08, length: 4800, speed: 19, count: 9, phase: -300 },
  { x: -7000, z: 2500, height: 1500, heading: 0.2, length: 4000, speed: 16, count: 11, phase: 900 },
  { x: 2500, z: -6800, height: 1650, heading: -0.3, length: 2600, speed: 18, count: 9, phase: -500 },
  { x: 6000, z: 4500, height: 1200, heading: 0.1, length: 2600, speed: 17, count: 13, phase: 400 },
] as const;

/** One GPU-instanced draw: straight flight / wrapping / V formation / slow wing beats.
 * Nominal span 2.3 m, spacing 7.5 m. At distance the whole glyph is magnified together,
 * preserving the V's spacing while keeping each bird >= GEESE_MIN_PX CSS pixels wide (a readable brush mark).
 */
export function createGeese() {
  const data = { route: [] as number[], flight: [] as number[], bird: [] as number[] };
  GEESE_ROUTES.forEach((r, flock) => {
    for (let i = 0; i < r.count; i++) {
      const rank = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? -1 : 1;
      data.route.push(r.x, r.height, r.z, r.heading);
      data.flight.push(r.length, r.speed, r.phase, flock);
      data.bird.push(rank, side, i * 0.73 + flock * 1.9, 7.5);
    }
  });
  // Swept wings with a short neck and tail: tiny 墨点 / short strokes, not tree cards.
  const vertices = [
    0, 0, 0.16, -0.5, 0.025, -0.18, -0.08, 0, -0.09,
    0, 0, 0.16, 0.08, 0, -0.09, 0.5, 0.025, -0.18,
    -0.045, 0, -0.25, 0, 0.015, 0.42, 0.045, 0, -0.25,
  ];
  const base = new BufferGeometry();
  base.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  base.setAttribute('normal', new Float32BufferAttribute(vertices.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  const g = instanced(base, data.route.length / 4, data, 4);
  const route = attribute('route', 'vec4'), flight = attribute('flight', 'vec4'), bird = attribute('bird', 'vec4');
  const forward = vec3(sin(route.w), 0, cos(route.w));
  const right = vec3(cos(route.w), 0, sin(route.w).negate());
  const travel = decorationTime.mul(flight.y).add(flight.z).add(flight.x.mul(0.5)).mod(flight.x).sub(flight.x.mul(0.5));
  // Decorative altitude: a little above the eye line (or the route height over the clouds, whichever
  // is higher), so the flocks cross the narrow band of sky that low views show above the ranges.
  const altitude = max(ink.cloudY.add(route.y), cameraPosition.y.add(route.y.mul(GEESE_EYE_LIFT)));
  const leader = vec3(route.x, altitude, route.z).add(forward.mul(travel));
  const pixelAngle = uniform(0.0006);
  const toCamera = cameraPosition.sub(leader);
  const projection = float(1).sub(right.dot(toCamera.normalize()).pow(2)).max(0.12).sqrt();
  const magnify = max(1, length(toCamera).mul(pixelAngle).mul(GEESE_MIN_PX).div(projection).div(2.3));
  const spacing = bird.w.mul(magnify);
  const centre = leader.add(right.mul(bird.x).mul(bird.y).mul(spacing))
    .sub(forward.mul(bird.x).mul(spacing));
  // Hide the seam in pale mist at each route end; no CPU instance / matrix updates.
  const end = smoothstep(0, 280, flight.x.mul(0.5).sub(abs(travel)));
  const local = positionLocal.mul(2.3).mul(magnify).mul(end);
  const beat = sin(decorationTime.mul(3.2).add(bird.z));
  const flappedY = local.y.add(abs(local.x).mul(beat).mul(0.42));
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = centre.add(right.mul(local.x)).add(forward.mul(local.z)).add(vec3(0, flappedY, 0));
  material.mrtNode = mrt({ tone: vec4(0.8, 0, 0, CATEGORY.building / 8), grain: vec4(0.5, 0.5, positionWorld.y, 0) });
  material.name = 'decorative-geese';
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.name = 'geese';
  return { mesh, count: g.instanceCount, pixelAngle };
}

/** Decorative 炊烟: thin wisps over a sample of hutong houses (positions are real small houses
 * from the map data, the smoke itself is a drawing choice). Rendered into the overlay pass as
 * red-only coverage (the pipeline reads r − min(r, g, b)); it writes overlay depth so the
 * pipeline can hide wisps behind nearer buildings.
 */
export function createSmoke(spots: number[]) {
  const count = spots.length / 3;
  const geometry = instanced(new PlaneGeometry(1, 1, 1, 10), Math.max(1, count), { spot: spots.length ? spots : [0, -1e4, 0] }, 3);
  const right = uniform(new Vector3(1, 0, 0));
  const spot = attribute('spot', 'vec3');
  const seed = hash(float(instanceIndex).add(3.7));
  const height = seed.mul(30).add(40), width = height.mul(0.4);
  const v = positionLocal.y.add(0.5);
  // The column leans downwind (world-fixed, towards the south-east) and sways a little.
  const t = decorationTime.mul(0.25).add(seed.mul(20));
  const lean = v.mul(v).mul(height).mul(0.28);
  const sway = sin(v.mul(5).sub(t.mul(2))).mul(v).mul(2.2);
  const wind = vec3(0.8, 0, 0.6);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: true, blending: AdditiveBlending, side: DoubleSide });
  material.positionNode = spot.add(wind.mul(lean.add(sway))).add(vec3(0, v.mul(height), 0))
    .add(right.mul(positionLocal.x).mul(width));
  const uvv = uv();
  const across = uvv.x.sub(0.5);
  const half = uvv.y.mul(0.3).add(0.1);
  const core = smoothstep(half, half.mul(0.15), abs(across.add(sin(uvv.y.mul(9).sub(t.mul(3))).mul(0.06).mul(uvv.y))));
  // Broken into drifting puffs, thinning as it rises; nothing at the very foot (the chimney).
  const puffs = smoothstep(-0.35, 0.35, mx_noise_float(vec3(across.mul(3), uvv.y.mul(4).sub(t.mul(1.6)), seed.mul(9))));
  const rise = smoothstep(0, 0.1, uvv.y).mul(float(1).sub(uvv.y).pow(1.4));
  material.colorNode = vec3(core.mul(puffs).mul(rise).mul(ink.smoke).mul(3.2), 0, 0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'chimney-smoke';
  mesh.renderOrder = 1;
  return {
    mesh, count,
    update(camera: PerspectiveCamera) {
      // Cylindrical billboard: face the camera about the vertical axis only.
      right.value.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    },
  };
}
