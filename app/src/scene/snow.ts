import { AdditiveBlending, Color, InstancedBufferGeometry, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, Vector3, type PerspectiveCamera } from 'three/webgpu';
import {
  cos, float, fract, hash, instanceIndex, length, mix, positionLocal, pow, sin, smoothstep, time, uniform, uv, vec3,
} from 'three/tsl';

// SPEC 6.5 snowfall: paper-white flakes in a box in front of the camera. Positions come
// from the instance index and time on the GPU, so nothing is updated per flake on the CPU.
// Rendered in a separate pass as coverage (additive white on black) that the ink pipeline
// composites as paper over the finished painting, so flakes never take part in outlines or
// bleed. The box sits between the camera and its target, so flakes are in front of the scene
// and need no depth test against it.

export function createSnow(count = 2600) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.setAttribute('normal', plane.getAttribute('normal'));
  geometry.setAttribute('uv', plane.getAttribute('uv'));
  geometry.instanceCount = count;

  const centre = uniform(new Vector3());
  const box = uniform(400);
  const right = uniform(new Vector3(1, 0, 0)), up = uniform(new Vector3(0, 1, 0));
  const speed = uniform(1);
  const i = float(instanceIndex);
  const h1 = hash(i.add(0.5)), h2 = hash(i.add(17.3)), h3 = hash(i.add(41.9)), h4 = hash(i.add(73.1));
  const t = time.mul(speed);
  // Wind in gusts (阵风): the sideways drift is the integral of a slowly varying wind, so the
  // snow slants, eases off and slants again instead of sliding at one steady speed.
  const gust = cos(t.mul(0.23)).mul(-0.026).add(cos(t.mul(0.071).add(1.3)).mul(-0.05));
  const drift = t.mul(0.008).add(gust).mul(h4.mul(0.6).add(0.7));
  // Fall through the box and wrap; a little sideways sway on top of the drift.
  const fall = fract(h2.sub(t.mul(0.07)));
  const sway = sin(time.mul(0.7).add(h1.mul(6.283))).mul(0.012);
  const across = fract(h1.add(drift)).sub(0.5).add(sway);
  const base = centre.add(vec3(across, fall.sub(0.5), h3.sub(0.5)).mul(box));
  // Sizes follow a steep power law: many small flakes, a few large ones close to the lens.
  const big = pow(h4, 6);
  const size = box.mul(0.0036).mul(big.mul(1.7).add(0.6));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  material.positionNode = base.add(right.mul(positionLocal.x).mul(size)).add(up.mul(positionLocal.y).mul(size));
  // Soft-edged dab of white: large (near, out of focus) flakes are softer and fainter.
  const r = length(uv().sub(0.5));
  material.colorNode = vec3(smoothstep(0.5, mix(0.28, 0.05, big), r).mul(mix(0.92, 0.4, big)));
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.background = new Color(0, 0, 0);
  scene.add(mesh);
  mesh.name = 'snowfall';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const forward = new Vector3();
  return {
    mesh, scene,
    update(camera: PerspectiveCamera, distance: number, reducedMotion: boolean) {
      const b = Math.min(1600, Math.max(40, distance * 0.6));
      box.value = b;
      camera.getWorldDirection(forward);
      centre.value.copy(camera.position).addScaledVector(forward, b * 0.55);
      right.value.setFromMatrixColumn(camera.matrixWorld, 0);
      up.value.setFromMatrixColumn(camera.matrixWorld, 1);
      speed.value = reducedMotion ? 0.5 : 1;
    },
    dispose() { geometry.dispose(); plane.dispose(); material.dispose(); },
  };
}
