import { PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CONTROL_LIMITS, type MapView } from '../config/views';

const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

// Map interaction: left-drag pans, wheel / pinch zooms toward the cursor,
// right-drag (or two fingers) rotates and tilts. The target is kept inside the map bounds.
export function createMapCamera(canvas: HTMLCanvasElement, bounds: [number, number, number, number]) {
  const camera = new PerspectiveCamera(36, window.innerWidth / window.innerHeight, 1, 14000);
  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minDistance = CONTROL_LIMITS.minDistance;
  controls.maxDistance = CONTROL_LIMITS.maxDistance;
  controls.maxPolarAngle = CONTROL_LIMITS.maxPolar * Math.PI / 180;
  controls.minPolarAngle = CONTROL_LIMITS.minPolar * Math.PI / 180;
  controls.zoomSpeed = 1.2;

  const [x0, x1, z0, z1] = bounds;
  const shift = new Vector3();
  controls.addEventListener('change', () => {
    // Clamp the ground target into the map; move the camera by the same amount.
    const t = controls.target;
    shift.set(Math.min(x1, Math.max(x0, t.x)) - t.x, 0, Math.min(z1, Math.max(z0, t.z)) - t.z);
    if (shift.lengthSq() > 0) { t.add(shift); camera.position.add(shift); }
    if (camera.position.y < 4) camera.position.y = 4;
  });

  let flight: { from: Vector3; to: Vector3; fromS: Spherical; toS: Spherical; start: number; seconds: number } | null = null;
  let interacting = false, lastChange = -Infinity;
  controls.addEventListener('start', () => { flight = null; interacting = true; lastChange = performance.now(); });
  controls.addEventListener('end', () => { interacting = false; lastChange = performance.now(); });
  controls.addEventListener('change', () => { lastChange = performance.now(); });
  const offset = new Vector3();

  function viewSpherical(view: Pick<MapView, 'distance' | 'polar' | 'azimuth'>) {
    // Azimuth 0 = camera south of the target, looking north (−Z).
    return new Spherical(view.distance, view.polar * Math.PI / 180, -view.azimuth * Math.PI / 180);
  }
  function current() {
    offset.copy(camera.position).sub(controls.target);
    return new Spherical().setFromVector3(offset);
  }
  return {
    camera, controls,
    get azimuth() { return controls.getAzimuthalAngle(); },
    get distance() { return camera.position.distanceTo(controls.target); },
    get flying() { return flight !== null; },
    // Include damping and wheel bursts, so quality / detail work do not oscillate per event.
    get moving() { return flight !== null || interacting || performance.now() - lastChange < 220; },
    flyTo(view: Pick<MapView, 'target' | 'distance' | 'polar' | 'azimuth'>, seconds = 1.4, keepAzimuth = false) {
      const to = viewSpherical(view);
      const from = current();
      if (keepAzimuth) to.theta = from.theta;
      // Turn the short way round.
      while (to.theta - from.theta > Math.PI) to.theta -= 2 * Math.PI;
      while (to.theta - from.theta < -Math.PI) to.theta += 2 * Math.PI;
      flight = { from: controls.target.clone(), to: new Vector3(...view.target), fromS: from, toS: to, start: performance.now(), seconds };
    },
    jumpTo(view: MapView) {
      controls.target.set(...view.target);
      camera.position.setFromSpherical(viewSpherical(view)).add(controls.target);
      flight = null;
      controls.update();
    },
    update(reducedMotion: boolean) {
      if (flight) {
        const raw = Math.min(1, (performance.now() - flight.start) / 1000 / (reducedMotion ? 0.01 : flight.seconds));
        const t = easeInOut(raw);
        controls.target.lerpVectors(flight.from, flight.to, t);
        const s = new Spherical(
          flight.fromS.radius * (flight.toS.radius / flight.fromS.radius) ** t,
          flight.fromS.phi + (flight.toS.phi - flight.fromS.phi) * t,
          flight.fromS.theta + (flight.toS.theta - flight.fromS.theta) * t,
        );
        camera.position.setFromSpherical(s).add(controls.target);
        if (raw >= 1) flight = null;
      }
      controls.update();
      // Depth precision: a 1 m near plane at a 3 km view leaves decimetre-sized depth steps, and the
      // road / water layers (a few centimetres apart) z-fight. Push the near plane out with distance.
      const d = camera.position.distanceTo(controls.target);
      const near = Math.min(400, Math.max(1, d * 0.04));
      // The far plane follows too, so the far side of the sandbox (≈ 12.8 km corner to corner) stays in view.
      const far = d + 13000;
      if (Math.abs(near - camera.near) > camera.near * 0.05 || Math.abs(far - camera.far) > 500) {
        camera.near = near; camera.far = far; camera.updateProjectionMatrix();
      }
    },
    resize() { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); },
    dispose() { controls.dispose(); },
  };
}

export type MapCamera = ReturnType<typeof createMapCamera>;
