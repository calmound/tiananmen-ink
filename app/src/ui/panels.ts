import { Raycaster, Vector2, Vector3, Plane, type PerspectiveCamera } from 'three/webgpu';
import type { CityData, Label } from '../scene/city';

// Map chrome: the info card, place search, minimap and scale bar.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const metres = (v: number) => v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '');

/** Info card: only facts we hold (kind, height and where it comes from, footprint). */
export function createCard(root: HTMLElement, onHide: () => void = () => {}) {
  root.addEventListener('click', event => { if ((event.target as HTMLElement).closest('.card-close')) hide(); });
  function hide() { root.classList.remove('open'); root.setAttribute('aria-hidden', 'true'); onHide(); }
  return {
    show(label: Label) {
      const info = label.info;
      const rows: string[] = [];
      if (info?.height) {
        const from = info.heightFrom === 'known'
          ? `<a href="${esc(info.source ?? '#')}" target="_blank" rel="noreferrer">资料</a>`
          : info.heightFrom === 'osm' ? '<span>地图数据</span>' : '<span class="est">估计</span>';
        rows.push(`<dt>高度</dt><dd>约 ${metres(info.height)} 米 ${from}</dd>`);
      }
      if (info?.footprint) rows.push(`<dt>平面</dt><dd>${metres(info.footprint[0])} × ${metres(info.footprint[1])} 米 <span>外接矩形</span></dd>`);
      root.innerHTML = `
        <button class="card-close" type="button" aria-label="关闭">×</button>
        <p class="card-kind">${esc(info?.kind ?? '地点')}</p>
        <h2 class="card-name">${esc(label.name)}</h2>
        ${rows.length ? `<dl>${rows.join('')}</dl>` : ''}
        <p class="card-note">轮廓与位置来自 OpenStreetMap；标“估计”的高度为按规则推算，未经核实。</p>`;
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
    },
    hide,
    get open() { return root.classList.contains('open'); },
  };
}

/** Place search over the map's labels. */
export function createSearch(form: HTMLFormElement, labels: Label[], onPick: (label: Label) => void) {
  const input = form.querySelector('input')!;
  const list = form.querySelector('ul')!;
  // One entry per name; prefer areas, then landmarks, then halls.
  const byName = new Map<string, Label>();
  for (const l of [...labels].sort((a, b) => a.tier - b.tier)) if (!byName.has(l.name)) byName.set(l.name, l);
  const entries = [...byName.values()];
  let matches: Label[] = [];
  let active = 0;
  const render = () => {
    list.innerHTML = matches.map((l, i) =>
      `<li role="option" data-i="${i}" aria-selected="${i === active}"><span>${esc(l.name)}</span><em>${esc(l.info?.kind ?? '')}</em></li>`).join('');
    list.hidden = matches.length === 0;
  };
  const pick = (l: Label | undefined) => {
    if (!l) return;
    onPick(l);
    input.value = l.name;
    matches = []; render(); input.blur();
  };
  input.addEventListener('input', () => {
    const q = input.value.trim();
    matches = q ? entries.filter(l => l.name.includes(q)).sort((a, b) =>
      Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)) || a.tier - b.tier || a.name.length - b.name.length).slice(0, 8) : [];
    active = 0; render();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { active = Math.min(matches.length - 1, active + 1); render(); event.preventDefault(); }
    if (event.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); event.preventDefault(); }
    if (event.key === 'Escape') { matches = []; render(); input.blur(); }
    if (event.key === 'Enter') { event.preventDefault(); pick(matches[active]); }
  });
  form.addEventListener('submit', event => { event.preventDefault(); pick(matches[active]); });
  list.addEventListener('pointerdown', event => {
    const li = (event.target as HTMLElement).closest('li');
    if (li) { event.preventDefault(); pick(matches[Number(li.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(() => { matches = []; render(); }, 120));
  return { entries };
}

/** North-up overview of the ring with the current view's ground footprint. */
export function createMinimap(svg: SVGSVGElement, city: CityData, onJump: (x: number, z: number) => void) {
  const [x0, x1, z0, z1] = city.bounds;
  const pad = 60;
  svg.setAttribute('viewBox', `${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}`);
  const path = (pts: [number, number][], close = true) => `M${pts.map(p => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join('L')}${close ? 'Z' : ''}`;
  const water = city.water.filter(w => w.poly.length > 2).map(w => path(w.poly)).join('');
  const roads = city.roads.filter(r => ['trunk', 'primary', 'motorway'].includes(r.cls)).map(r => path(r.line, false)).join('');
  const palace = (city.walls ?? []).filter(w => w.kind === 'palace').map(w => path(w.line, false)).join('');
  const ring = city.ring ? path(city.ring) : path([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  svg.innerHTML = `
    <path class="mm-ring" d="${ring}"/>
    <path class="mm-water" d="${water}"/>
    <path class="mm-road" d="${roads}"/>
    <path class="mm-palace" d="${palace}"/>
    <path class="mm-view" d=""/>
    <circle class="mm-target" r="55"/>`;
  const view = svg.querySelector<SVGPathElement>('.mm-view')!;
  const dot = svg.querySelector<SVGCircleElement>('.mm-target')!;
  const ray = new Raycaster(), ground = new Plane(new Vector3(0, 1, 0), 0), hit = new Vector3(), ndc = new Vector2();
  svg.addEventListener('click', event => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX; pt.y = event.clientY;
    const local = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    onJump(local.x, local.y);
  });
  return {
    update(camera: PerspectiveCamera, target: Vector3) {
      // Ground footprint of the screen corners (rays above the horizon are cut off at 20 km).
      const corners: [number, number][] = [];
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ndc.set(x, y);
        ray.setFromCamera(ndc, camera);
        const t = ray.ray.intersectPlane(ground, hit) ? ray.ray.origin.distanceTo(hit) : Infinity;
        const p = ray.ray.at(Math.min(t, 20000), hit);
        corners.push([p.x, p.z]);
      }
      // A zero-size (hidden) canvas gives a NaN projection; keep the last footprint.
      if (corners.every(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))) view.setAttribute('d', path(corners));
      dot.setAttribute('cx', target.x.toFixed(0));
      dot.setAttribute('cy', target.z.toFixed(0));
    },
  };
}

/** Scale bar: a round length that fits ~110 px at the map target. */
export function createScale(root: HTMLElement) {
  const bar = root.querySelector<HTMLElement>('.scale-bar')!;
  const text = root.querySelector<HTMLElement>('.scale-text')!;
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let last = '';
  return {
    update(camera: PerspectiveCamera, distance: number) {
      const perPixel = 2 * distance * Math.tan(camera.fov * Math.PI / 360) / window.innerHeight;
      const length = steps.find(s => s / perPixel >= 70) ?? steps[steps.length - 1];
      const px = Math.round(length / perPixel);
      const label = length >= 1000 ? `${length / 1000} 公里` : `${length} 米`;
      const key = `${px}|${label}`;
      if (key === last) return;
      last = key;
      bar.style.width = `${px}px`;
      text.textContent = label;
    },
  };
}
