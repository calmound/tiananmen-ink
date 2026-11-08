import { palette } from '../config/palette';

/**
 * 框景 (decorative): an ink plum branch reaching in from the top-right corner when the camera looks
 * low across the city, as if seen past a near tree. It is painted once on a 2D canvas beside the map
 * (no effect on the 3D scene) and fades with the camera's tilt. Not part of the map data.
 */
export function createFrameBranch(root: HTMLCanvasElement, seed = 7) {
  const W = 460, H = 320;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  root.width = W * dpr; root.height = H * dpr;
  root.style.width = `${W}px`; root.style.height = `${H}px`;
  const g = root.getContext('2d')!;
  g.scale(dpr, dpr);
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  // One stroke: a quadratic path drawn as overlapping dabs that thin towards the tip (干湿 by alpha).
  type Twig = { x: number; y: number; angle: number; length: number; width: number; depth: number };
  const tips: [number, number][] = [];
  const snow: [number, number, number, number][] = [];
  function stroke(t: Twig) {
    const bend = (random() - 0.5) * 0.9;
    let x = t.x, y = t.y, a = t.angle;
    const steps = Math.max(8, Math.round(t.length / 3));
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const w = Math.max(1.2, t.width * (1 - k * 0.8));
      g.globalAlpha = 0.55 + random() * 0.35;
      g.beginPath();
      g.ellipse(x, y, w * 0.5, w * 0.42, a, 0, Math.PI * 2);
      g.fill();
      // A line of snow along the top of the thicker limbs.
      if (w > 3 && i % 2 === 0) snow.push([x, y - w * 0.45, w * 0.55, a]);
      a += bend / steps + (random() - 0.5) * 0.12;
      x += Math.cos(a) * t.length / steps;
      y += Math.sin(a) * t.length / steps;
      // 蟹爪: short side twigs off the limb.
      if (t.depth < 3 && i > 2 && random() < 0.11) {
        const side = random() < 0.5 ? -1 : 1;
        stroke({ x, y, angle: a + side * (0.5 + random() * 0.6), length: t.length * (0.3 + random() * 0.35), width: w * 0.6, depth: t.depth + 1 });
      }
    }
    tips.push([x, y]);
  }

  g.fillStyle = palette.ink;
  stroke({ x: W + 10, y: 40, angle: Math.PI * 0.86, length: 330, width: 22, depth: 0 });
  stroke({ x: W + 6, y: 12, angle: Math.PI * 0.96, length: 170, width: 11, depth: 1 });
  // Snow on the limbs: paper-coloured caps.
  g.fillStyle = palette.paper;
  for (const [x, y, r, a] of snow) {
    g.globalAlpha = 0.85;
    g.beginPath();
    g.ellipse(x, y, r * 1.1, r * 0.45, a, 0, Math.PI * 2);
    g.fill();
  }
  // 红梅: a few blossoms near the tips, five dabs of cinnabar with a dark eye.
  for (const [tx, ty] of tips) {
    if (random() < 0.6) continue;
    const n = 1 + Math.floor(random() * 2);
    for (let i = 0; i < n; i++) {
      const bx = tx + (random() - 0.5) * 22, by = ty + (random() - 0.5) * 18, r = 2.6 + random() * 1.8;
      g.fillStyle = palette.cinnabar;
      for (let p = 0; p < 5; p++) {
        const pa = p / 5 * Math.PI * 2 + random() * 0.4;
        g.globalAlpha = 0.6 + random() * 0.3;
        g.beginPath();
        g.arc(bx + Math.cos(pa) * r * 0.75, by + Math.sin(pa) * r * 0.75, r * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = palette.ink;
      g.globalAlpha = 0.8;
      g.beginPath();
      g.arc(bx, by, r * 0.22, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;

  let shown = -1;
  return {
    /** polar: the camera's tilt from straight down, in radians. */
    update(polar: number, night: boolean) {
      const deg = polar * 180 / Math.PI;
      const t = Math.min(1, Math.max(0, (deg - 66) / 10));
      const opacity = Math.round(t * t * (3 - 2 * t) * (night ? 0.55 : 0.9) * 100) / 100;
      if (opacity === shown) return;
      shown = opacity;
      root.style.opacity = String(opacity);
    },
  };
}
