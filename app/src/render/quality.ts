import type { WebGPURenderer } from 'three/webgpu';

export type RenderQuality = 'auto' | 'high';

const MOVING_BUDGET = 1_000_000;
const SETTLED_MAX = 2_600_000;
const SETTLED_MIN = 1_200_000;

/** Bound the cost of all MRT / ink passes, including on Retina and 4K screens.
 * Interaction uses ~1 MP. A settled view starts at ~2.6 MP and adapts to the measured frame rate
 * (down to ~1.2 MP on a slow GPU, back up when there is headroom), but never drops below one buffer
 * pixel per CSS pixel: below that the ink lines and far detail turn to mush. Explicit high quality
 * and PNG capture retain the native DPR (up to 2). All passes resize together.
 */
export function createRenderQuality(renderer: WebGPURenderer, mode: RenderQuality, onResize: () => void) {
  let active = false;
  let width = 0, height = 0, deviceRatio = 0;
  let settledBudget = SETTLED_MAX, lastAdapt = 0, fastSamples = 0;
  function update(moving: boolean, capture = false) {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    active = mode === 'auto' && moving && !capture;
    const high = mode === 'high' || capture;
    const fit = (budget: number) => Math.sqrt(budget / (w * h));
    const settled = Math.max(Math.min(dpr, 1), fit(settledBudget));
    const ratio = high ? Math.min(dpr, 2) : Math.min(dpr, active ? 1 : 1.5, active ? fit(MOVING_BUDGET) : settled);
    if (w === width && h === height && dpr === deviceRatio && Math.abs(renderer.getPixelRatio() - ratio) < 0.01) return;
    width = w; height = h; deviceRatio = dpr;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h);
    onResize();
  }
  /** Feed the settled frame rate (the loop is capped at 30 fps when idle). Changes at most every 2 s. */
  function adapt(fps: number, now: number) {
    if (mode !== 'auto' || active || now - lastAdapt < 2000) return;
    // Below ~10 fps the browser itself is throttling animation frames (background / occluded
    // window), which says nothing about the GPU: leave the resolution alone.
    if (fps < 10) return;
    if (fps < 24 && settledBudget > SETTLED_MIN) {
      settledBudget = Math.max(SETTLED_MIN, settledBudget * 0.8);
      lastAdapt = now; fastSamples = 0;
    } else if (fps >= 29 && settledBudget < SETTLED_MAX) {
      // Climb back slowly so a brief stall does not make the resolution oscillate.
      if (++fastSamples >= 6) { settledBudget = Math.min(SETTLED_MAX, settledBudget * 1.15); lastAdapt = now; fastSamples = 0; }
    } else fastSamples = 0;
  }
  return { update, adapt, get interacting() { return active; }, get settledBudget() { return settledBudget; }, mode };
}
