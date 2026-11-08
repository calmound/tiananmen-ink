import './style.css';
import { Mesh, Vector2 } from 'three/webgpu';
import { overviewFor, VIEWS } from './config/views';
import { createWorld } from './scene/world';
import { PLINTH_DEPTH, type CityData, type Label } from './scene/city';
import { createMapCamera } from './camera/map';
import { createRenderer } from './render/renderer';
import { createRenderQuality } from './render/quality';
import { createInkPipeline } from './render/ink/pipeline';
import { loadPreset } from './render/ink/presets';
import { decorationClock, inkFocus, inkView } from './render/ink/params';
import { createLabels } from './ui/labels';
import { createCard, createMinimap, createScale, createSearch } from './ui/panels';
import { createSnow } from './scene/snow';
import { createMarker } from './scene/marker';
import { createCrows, createGeese, createLanterns, createSmoke } from './scene/life';
import { createFrameBranch } from './ui/frame-branch';
import { ink } from './render/ink/params';

interface InspectionApi {
  view: (id: string, immediate?: boolean) => void;
  inspect: () => Record<string, unknown>;
}
declare global {
  interface Window { __ready: boolean; __map?: InspectionApi; __error?: string; }
}

async function main() {
  const query = new URLSearchParams(location.search);
  const fixedTime = query.has('time') ? Number(query.get('time')) : query.has('shot') ? 0 : -1;
  decorationClock.value = Number.isFinite(fixedTime) && fixedTime >= 0 ? fixedTime : -1;
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const { renderer, backend } = await createRenderer(canvas, query.get('backend') === 'webgl');
  const cityData = await (await fetch(`${import.meta.env.BASE_URL}data/city.json`)).json() as CityData;
  const world = createWorld(cityData);
  const map = createMapCamera(canvas, cityData.bounds);
  if (cityData.ring) VIEWS[0] = overviewFor(cityData.bounds, window.innerWidth / window.innerHeight);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sky = { top: world.materials.skyTop, horizon: world.materials.skyHorizon };
  const snow = createSnow();
  snow.mesh.visible = query.get('snow') !== '0';
  // The plinth outline is the ring the data is clipped to (scene/city.ts).
  const ring = cityData.ring;
  const stage = ring ? { bounds: [Math.min(...ring.map(p => p[0])), Math.max(...ring.map(p => p[0])),
    Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[1]))] as [number, number, number, number], depth: PLINTH_DEPTH, ring } : undefined;
  const inkPass = createInkPipeline(renderer, world.scene, map.camera, sky, snow.scene, stage);
  const preset = query.get('preset');
  if (preset && !loadPreset(preset)) console.warn(`未找到预设 ${preset}`);
  inkView.value = Number(query.get('channel') ?? 0) || 0;

  const hint = document.querySelector<HTMLElement>('#hint')!;
  const compass = document.querySelector<HTMLButtonElement>('#compass')!;
  const needle = compass.querySelector<SVGElement>('svg')!;
  const dismissHint = () => hint.classList.remove('visible');
  const marker = createMarker();
  snow.scene.add(marker.mesh);
  const card = createCard(document.querySelector<HTMLElement>('#card')!, () => marker.hide());
  const flyToLabel = (label: Label) => {
    const distance = Math.min(900, Math.max(label.tier === 3 ? 110 : 170, label.size * (label.tier === 1 ? 2.2 : 4.5)));
    map.flyTo({ target: [label.position[0], Math.max(0, label.position[1] - 12), label.position[2]], distance,
      polar: 58, azimuth: 0 }, 1.4, true);
    card.show(label);
    marker.show(label.position[0], label.position[2], label.size, label.position[1]);
    dismissHint();
  };
  createSearch(document.querySelector<HTMLFormElement>('#search')!, world.city.labels, flyToLabel);
  const minimap = createMinimap(document.querySelector<SVGSVGElement>('#minimap')!, cityData, (x, z) => {
    map.flyTo({ target: [x, 0, z], distance: Math.min(map.distance, 1400),
      polar: map.controls.getPolarAngle() * 180 / Math.PI, azimuth: 0 }, 1.1, true);
    dismissHint();
  });
  const scale = createScale(document.querySelector<HTMLElement>('#scale')!);

  // Life: lanterns for the snowy night, crows circling over open places.
  const lanterns = createLanterns(world.city.labels);
  world.scene.add(lanterns.dots);
  snow.scene.add(lanterns.halos);
  lanterns.lit = false;
  // 炊烟 over a deterministic sample of small untagged houses (hutong courtyards), outside the palace.
  const chimneys: number[] = [];
  cityData.buildings.forEach((b, i) => {
    if (b.h || b.levels || (b.type && !['yes', 'house', 'residential'].includes(b.type)) || b.area < 60 || b.area > 320) return;
    const cx = b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length, cz = b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length;
    if (Math.abs(cx) < 410 && cz > -1560 && cz < -20) return;
    if (((i * 2654435761) >>> 0) % 1000 < 300) chimneys.push(cx, 6, cz);
  });
  const smoke = createSmoke(chimneys.slice(0, 3 * 1100));
  const frameBranch = createFrameBranch(document.querySelector<HTMLCanvasElement>('#frame-branch')!);
  snow.scene.add(smoke.mesh);
  const crows = createCrows([[14, -1790], [0, -1150], [1178, 2835], [-700, -3050], [-600, -1950], [-3, -260],
    [0, 600], [-560, -2350], [1500, 2400], [30, -3630], [-1500, -900], [900, -2200]], 18);
  world.scene.add(crows.mesh);
  const geese = createGeese();
  world.scene.add(geese.mesh);
  const drawingSize = new Vector2();
  const updateGeeseScale = () => {
    renderer.getDrawingBufferSize(drawingSize);
    const screenHeight = drawingSize.y / renderer.getPixelRatio();
    geese.pixelAngle.value = 2 * Math.tan(map.camera.fov * Math.PI / 360) / Math.max(1, screenHeight);
  };
  updateGeeseScale();

  // Moods (时令): values ease over ~1.5 s.
  type Mood = 'snow' | 'clear' | 'night';
  // cinnabarStrength follows the deeper red of the 2026-11-04 wall colour (default 0.62).
  // ice: 1 = frozen lakes (snowy day and night), 0 = open water with ripples (clear day).
  const MOOD_KEYS = ['snowOn', 'night', 'mistStrength', 'cinnabarStrength', 'ice', 'cloudCoverage', 'cloudInk', 'hillInk', 'sun', 'skyWarm'] as const;
  type MoodValues = Record<(typeof MOOD_KEYS)[number], number>;
  const MOODS: Record<Mood, MoodValues & { snowfall: boolean }> = {
    snow: { snowOn: 1, night: 0, mistStrength: 0.55, cinnabarStrength: 0.62, ice: 1, snowfall: true,
      cloudCoverage: 0.85, cloudInk: 0.14, hillInk: 0.42, sun: 0, skyWarm: 0.35 },
    clear: { snowOn: 0, night: 0, mistStrength: 0.3, cinnabarStrength: 0.72, ice: 0, snowfall: false,
      cloudCoverage: 0.48, cloudInk: 0.08, hillInk: 0.5, sun: 1, skyWarm: 0.7 },
    night: { snowOn: 1, night: 1, mistStrength: 0.45, cinnabarStrength: 0.55, ice: 1, snowfall: true,
      cloudCoverage: 0.9, cloudInk: 0.16, hillInk: 0.42, sun: 0, skyWarm: 0 },
  };
  let moodFrom: MoodValues = { ...MOODS.snow }, moodTo: MoodValues = moodFrom, moodStart = -1;
  const moodButtons = [...document.querySelectorAll<HTMLButtonElement>('.moods button')];
  const setMood = (mood: Mood, immediate = false) => {
    const m = MOODS[mood];
    moodFrom = Object.fromEntries(MOOD_KEYS.map(k => [k, ink[k].value])) as MoodValues;
    moodTo = m;
    moodStart = immediate ? -Infinity : performance.now();
    snow.mesh.visible = m.snowfall && query.get('snow') !== '0';
    lanterns.lit = mood === 'night';
    document.body.classList.toggle('night', mood === 'night');
    moodButtons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.mood === mood)));
  };
  moodButtons.forEach(b => b.addEventListener('click', () => setMood(b.dataset.mood as Mood)));
  // Runs only while a mood change is in progress, so the debug panel stays in charge otherwise.
  const easeMood = (now: number) => {
    if (moodStart === -1) return;
    const t = moodStart === -Infinity ? 1 : Math.min(1, (now - moodStart) / 1500);
    if (t >= 1) moodStart = -1;
    const e = t * t * (3 - 2 * t);
    for (const k of MOOD_KEYS) {
      ink[k].value = moodFrom[k] + (moodTo[k] - moodFrom[k]) * e;
    }
  };
  if (query.get('mood') && query.get('mood')! in MOODS) setMood(query.get('mood') as Mood, true);

  // 漫游: slow orbit round the current target; any drag stops it.
  const wander = document.querySelector<HTMLButtonElement>('#wander')!;
  const setWander = (on: boolean) => { map.controls.autoRotate = on; map.controls.autoRotateSpeed = 0.35; wander.setAttribute('aria-pressed', String(on)); };
  wander.addEventListener('click', () => setWander(!map.controls.autoRotate));
  map.controls.addEventListener('start', () => { if (map.controls.autoRotate) setWander(false); });

  // 存图: the painted frame (without the HTML labels) as a PNG.
  let captureNext = false;
  document.querySelector('#capture')!.addEventListener('click', () => { captureNext = true; });
  const zoom = (factor: number) => map.flyTo({ target: map.controls.target.toArray() as [number, number, number],
    distance: map.distance * factor, polar: map.controls.getPolarAngle() * 180 / Math.PI, azimuth: 0 }, 0.5, true);
  document.querySelector('#zoom-in')!.addEventListener('click', () => zoom(0.6));
  document.querySelector('#zoom-out')!.addEventListener('click', () => zoom(1.65));

  const labels = createLabels(document.querySelector<HTMLElement>('#labels')!, world.city.labels, flyToLabel);
  document.querySelector<HTMLButtonElement>('#home')!.addEventListener('click', () => { map.flyTo(VIEWS[0]); dismissHint(); });
  compass.addEventListener('click', () => {
    map.flyTo({ target: map.controls.target.toArray() as [number, number, number], distance: map.distance,
      polar: map.controls.getPolarAngle() * 180 / Math.PI, azimuth: 0 }, 0.8);
  });
  map.controls.addEventListener('start', dismissHint);
  // A click (press and release without moving) on a label flies to it.
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', event => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) labels.pick(event.clientX, event.clientY);
    down = null;
  });
  canvas.addEventListener('pointermove', event => {
    if (event.buttons) return;
    canvas.classList.toggle('over-label', labels.hover(event.clientX, event.clientY));
  });

  // ?view=id starts at a preset view; ?shot=id does the same without the hint (for screenshots).
  const shot = query.get('shot');
  const startView = VIEWS.find(v => v.id === (shot ?? query.get('view'))) ?? VIEWS[0];
  // ?cam=x,z,distance,polar,azimuth overrides the start view (for reproducing a reported framing).
  const cam = query.get('cam')?.split(',').map(Number);
  map.jumpTo(cam?.length === 5 && cam.every(Number.isFinite)
    ? { ...startView, target: [cam[0], 0, cam[1]], distance: cam[2], polar: cam[3], azimuth: cam[4] } : startView);
  // Opening: from the whole ring down onto the heart of the city, unless a view was asked for.
  const plainStart = !shot && !query.get('view') && !query.get('select');
  if (plainStart && !motion.matches) setTimeout(() => { if (!map.flying) map.flyTo(VIEWS.find(v => v.id === 'center')!, 5.5); }, 1400);
  if (shot) hint.hidden = true; else setTimeout(() => hint.classList.add('visible'), 600);
  // ?select=名称 opens a place directly (handy for screenshots of the card).
  const selected = query.get('select') && [...world.city.labels].sort((a, b) => a.tier - b.tier).find(l => l.name === query.get('select'));
  if (selected) {
    flyToLabel(selected);
    map.update(true);
  }
  if (world.city.notes.length) console.info('城市数据说明：\n' + world.city.notes.join('\n'));

  let debug: { update: (fps: number) => void; dispose: () => void } | undefined;
  if (query.has('debug')) {
    const { createDebug } = await import('./ui/debug');
    debug = createDebug({ world, map, renderer, backend, snow: snow.mesh });
  }
  let frames = 0, sampleFrames = 0, elapsed = 0, fps = 0;
  let disposed = false;
  let previous = performance.now();
  let lastYaw = NaN, lastUiUpdate = -Infinity;
  let uiDirty = true;
  map.controls.addEventListener('change', () => { uiDirty = true; });
  window.__ready = false;

  const quality = createRenderQuality(renderer, query.get('quality') === 'high' ? 'high' : 'auto', () => {
    map.resize(); inkPass.resize(); updateGeeseScale(); uiDirty = true;
  });
  quality.update(false);

  const resolution = new Vector2();
  window.__map = {
    view(id, immediate = true) {
      const v = VIEWS.find(view => view.id === id);
      if (!v) return;
      if (immediate) map.jumpTo(v); else map.flyTo(v);
    },
    inspect() {
      renderer.getDrawingBufferSize(resolution);
      let meshCount = 0;
      world.scene.traverse(object => { if (object instanceof Mesh) meshCount++; });
      return { backend, fps, frames, resolution: resolution.toArray(), pixelRatio: renderer.getPixelRatio(),
        quality: quality.mode, interacting: quality.interacting, settledBudget: quality.settledBudget,
        stageMode: ink.stageMode.value, decorationTime: decorationClock.value, geese: geese.count,
        calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, meshCount,
        target: map.controls.target.toArray(), distance: map.distance, labels: world.city.labels.length,
        buildings: cityData.buildings.length, nearTiles: world.city.nearTiles, pendingTiles: world.city.pendingTiles,
        tiles: world.city.tiles.length, trees: world.trees.plan.length, notes: world.city.notes };
    },
  };

  function resize() {
    quality.update(map.moving);
  }
  window.addEventListener('resize', resize);

  const IDLE_FRAME_MS = 1000 / 30 - 2;
  let lastFrame = -Infinity, lastMoving = true;
  map.controls.addEventListener('start', () => { lastMoving = true; });
  renderer.setAnimationLoop(() => {
    if (disposed) return;
    // A hidden or collapsed window has a 0×0 drawing buffer; WebGPU rejects that swapchain.
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    const now = performance.now();
    // A settled camera only animates snow, birds and mist: 30 fps is enough there and halves
    // the GPU load of the full-resolution ink passes. Interaction and mood changes run at full rate.
    if (!lastMoving && !captureNext && moodStart === -1 && now - lastFrame < IDLE_FRAME_MS) return;
    lastFrame = now;
    const dt = (now - previous) / 1000;
    previous = now;
    map.update(motion.matches);
    const moving = map.moving;
    lastMoving = moving;
    quality.update(moving, captureNext);
    inkFocus.value = map.distance;
    // Keep far stand-ins during interaction; generate detailed roofs after the camera settles.
    world.city.update(map.controls.target.x, map.controls.target.z, map.distance, moving ? 0 : 1, 4);
    // Tree cards turn in the vertex shader, without rebuilding instance matrices.
    const yaw = map.azimuth;
    world.trees.face(yaw);
    if (yaw !== lastYaw) {
      lastYaw = yaw;
      needle.style.transform = `rotate(${(yaw * 180 / Math.PI).toFixed(1)}deg)`;
    }
    snow.update(map.camera, map.distance, motion.matches);
    lanterns.update(map.camera);
    smoke.update(map.camera);
    frameBranch.update(map.controls.getPolarAngle(), document.body.classList.contains('night'));
    geese.mesh.visible = ink.stageMode.value !== 1 && query.get('geese') !== '0';
    easeMood(now);
    inkPass.render();
    if (captureNext) {
      captureNext = false;
      canvas.toBlob(blob => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `雪中京城-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
    }
    // DOM overlays need no work for a stationary camera; while moving, update at most 30 Hz.
    if (uiDirty && (!moving || now - lastUiUpdate >= 1000 / 30)) {
      labels.update(map.camera, map.controls.target, map.distance);
      minimap.update(map.camera, map.controls.target);
      scale.update(map.camera, map.distance);
      uiDirty = false; lastUiUpdate = now;
    }

    frames++; sampleFrames++; elapsed += dt;
    if (elapsed >= 0.5) {
      fps = sampleFrames / elapsed;
      debug?.update(fps);
      if (!moving && !query.has('shot') && document.visibilityState === 'visible') quality.adapt(fps, now);
      sampleFrames = 0; elapsed = 0;
    }
    if (frames === 1) document.querySelector<HTMLElement>('#loading')!.hidden = true;
    // Ready for screenshots once 30 frames have rendered and no detail tile is still being built.
    if (frames >= 30 && !moving && world.city.pendingTiles === 0) window.__ready = true;
  });

  function dispose() {
    disposed = true;
    renderer.setAnimationLoop(null);
    debug?.dispose(); labels.dispose(); snow.dispose(); map.dispose(); inkPass.dispose(); world.dispose(); renderer.dispose();
    window.removeEventListener('resize', resize);
    delete window.__map;
  }
  import.meta.hot?.dispose(dispose);
}

main().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  window.__error = message;
  document.querySelector<HTMLElement>('#loading')!.hidden = true;
  const panel = document.querySelector<HTMLElement>('#error')!;
  panel.hidden = false;
  const text = document.createElement('p');
  text.textContent = `渲染器启动失败：${message}`;
  panel.append(text);
  if (new URLSearchParams(location.search).get('backend') !== 'webgl') {
    const link = document.createElement('a');
    const target = new URL(location.href);
    target.searchParams.set('backend', 'webgl');
    link.href = target.href;
    link.textContent = '使用 WebGL2 后端重试';
    panel.append(link);
  }
});
