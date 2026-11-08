import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Label } from '../scene/city';

// Place-name labels over the map. Visibility depends on zoom: areas when far,
// landmarks at mid range, every named hall up close. Overlaps are resolved by priority.
// Labels never take pointer events (dragging or zooming over a name must still move
// the map); clicks and hover are hit-tested against the placed label boxes instead.

interface Item { label: Label; el: HTMLButtonElement; w: number; h: number; anchor: Vector3; shown: boolean }

export function createLabels(root: HTMLElement, labels: Label[], onSelect: (label: Label) => void) {
  root.innerHTML = '';
  const items: Item[] = labels.map(label => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `map-label tier-${label.tier}`;
    el.innerHTML = `<span>${label.name}</span>`;
    el.tabIndex = -1;
    root.append(el);
    return { label, el, w: 0, h: 0, anchor: new Vector3(...label.position), shown: false };
  });
  const p = new Vector3();
  const placed: [number, number, number, number][] = [];
  const placedItems: Item[] = [];
  let hovered: Item | null = null;
  let lastFade = '';
  const hit = (x: number, y: number) => {
    for (let i = placed.length - 1; i >= 0; i--) {
      const r = placed[i];
      if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return placedItems[i];
    }
    return null;
  };
  const priority = (tier: number, far: boolean) => far ? [0, 1, 2, 3][tier] : [0, 2, 1, 3][tier];

  return {
    update(camera: PerspectiveCamera, target: Vector3, distance: number) {
      const width = window.innerWidth, height = window.innerHeight;
      const far = distance > 1300;
      placed.length = 0;
      placedItems.length = 0;
      const visible = items.filter(({ label, anchor }) => {
        if (label.tier === 1) return distance > 650;
        if (label.tier === 2) return distance < 2800;
        return distance < 560 && anchor.distanceTo(target) < Math.max(220, distance * 0.9);
      });
      visible.sort((a, b) => priority(a.label.tier, far) - priority(b.label.tier, far)
        || a.anchor.distanceToSquared(camera.position) - b.anchor.distanceToSquared(camera.position));
      // Batch layout reads before any transforms / visibility writes.
      for (const item of visible) {
        if (!item.w) { item.w = item.el.offsetWidth || 60; item.h = item.el.offsetHeight || 20; }
      }
      const shown = new Set<Item>();
      for (const item of visible) {
        p.copy(item.anchor).project(camera);
        if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
        const x = (p.x + 1) / 2 * width, y = (1 - p.y) / 2 * height;
        const rect: [number, number, number, number] = [x - item.w / 2 - 4, y - item.h - 10, x + item.w / 2 + 4, y + 2];
        if (placed.some(r => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue;
        placed.push(rect);
        placedItems.push(item);
        item.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        shown.add(item);
      }
      // Hall names (tier 3) fade in over the last stretch of zoom instead of popping in.
      const tier3 = 1 - Math.min(1, Math.max(0, (distance - 430) / 130));
      const fade = tier3.toFixed(2);
      if (fade !== lastFade) { root.style.setProperty('--hall-fade', fade); lastFade = fade; }
      for (const item of items) {
        const show = shown.has(item);
        if (show !== item.shown) { item.el.classList.toggle('shown', show); item.shown = show; }
      }
    },
    /** Click at a screen point: selects the label there, if any. */
    pick(x: number, y: number) {
      const item = hit(x, y);
      if (item) onSelect(item.label);
      return item !== null;
    },
    /** Hover feedback; returns whether a label is under the pointer. */
    hover(x: number, y: number) {
      const item = hit(x, y);
      if (item !== hovered) { hovered?.el.classList.remove('hover'); item?.el.classList.add('hover'); hovered = item; }
      return item !== null;
    },
    dispose() { root.innerHTML = ''; },
  };
}
