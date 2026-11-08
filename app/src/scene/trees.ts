import {
  CanvasTexture, DoubleSide, Group, InstancedMesh, Matrix4, MeshBasicNodeMaterial,
  PlaneGeometry, SRGBColorSpace, Vector2, Vector3, type Node,
} from 'three/webgpu';
import { palette } from '../config/palette';
import { color, float, floor, fract, Fn, fwidth, hash, instanceIndex, length, luminance, mat4, max, normalLocal, positionGeometry, referenceAttribute, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import { CATEGORY, inkOutputs } from './materials';

export const FOREST_SEED = 20261102;
/**
 * Card variants by species (winter in old Beijing): 0–1 cypress (柏), 2–3 round crowns painted
 * with dots (点叶, e.g. pagoda trees), 4 pine with flat needle plates (松), 5 bare winter tree (寒林).
 */
export const VARIANTS = 6;
const SPECIES = [
  { variants: [0, 1], weight: 0.4, height: [10, 17], width: [0.62, 0.85] },
  { variants: [2, 3], weight: 0.3, height: [9, 15], width: [0.95, 1.2] },
  { variants: [4], weight: 0.15, height: [12, 18], width: [0.95, 1.15] },
  { variants: [5], weight: 0.15, height: [8, 14], width: [0.85, 1.05] },
];

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export interface TreePlan { x: number; y: number; z: number; height: number; width: number; variant: number }

const pickSpecies = (r: number) => {
  let acc = 0;
  for (const sp of SPECIES) { acc += sp.weight; if (r < acc) return sp; }
  return SPECIES[0];
};

/**
 * Heights, widths and card variants (deterministic by seed). Trees of one grove (`group`) mostly
 * share a species and a size, so groves read as masses; a few old trees stand taller.
 */
export function treePlan(points: { x: number; y: number; z: number; group?: number }[], seed = FOREST_SEED): TreePlan[] {
  const random = seededRandom(seed);
  const groves = new Map<number, { species: (typeof SPECIES)[number]; scale: number }>();
  const grove = (g: number) => {
    if (!groves.has(g)) {
      const r = seededRandom(seed ^ Math.imul(g + 1, 2654435761));
      groves.set(g, { species: pickSpecies(r()), scale: 0.85 + r() * 0.35 });
    }
    return groves.get(g)!;
  };
  return points.map(p => {
    const own = p.group === undefined || p.group < 0 || random() < 0.25;
    const g = p.group !== undefined && p.group >= 0 ? grove(p.group) : null;
    const species = own || !g ? pickSpecies(random()) : g.species;
    const old = random() < 0.05 ? 1.4 : 1;
    const scale = (g?.scale ?? 1) * old;
    const [h0, h1] = species.height, [w0, w1] = species.width;
    const height = (h0 + random() * (h1 - h0)) * scale;
    const variant = species.variants[Math.floor(random() * species.variants.length)];
    return { x: p.x, y: p.y, z: p.z, height, width: height * (w0 + random() * (w1 - w0)), variant };
  });
}

type Painter = (g: CanvasRenderingContext2D, random: () => number, tone: (amount: number) => string) => void;

/** Snow resting on the upper edge of a clump. */
function snowCap(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  g.fillStyle = palette.paper;
  g.beginPath();
  g.ellipse(x, y - ry * 0.5, rx * 0.66, ry * 0.34, 0, Math.PI, Math.PI * 2);
  g.fill();
}

function trunk(g: CanvasRenderingContext2D, tone: (a: number) => string, width: number, lean: number, top: number) {
  g.strokeStyle = tone(0.82);
  g.lineCap = 'round';
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(128, 512);
  g.bezierCurveTo(128 + lean * 0.2, 430, 128 + lean * 0.7, (512 + top) / 2, 128 + lean, top);
  g.stroke();
}

/** 柏: a tall column of dark clumps. */
const cypress: Painter = (g, random, tone) => {
  const lean = (random() - 0.5) * 40;
  trunk(g, tone, 9 + random() * 5, lean, 200);
  const blobs: [number, number, number, number][] = [];
  const count = 9 + Math.floor(random() * 6);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const y = 60 + t * 330 + (random() - 0.5) * 24;
    const spread = 34 + Math.sin(t * Math.PI) * 52;
    const x = 128 + lean * (1 - t) * 0.8 + (random() - 0.5) * spread * 1.2;
    blobs.push([x, y, 26 + random() * 26 + Math.sin(t * Math.PI) * 18, 16 + random() * 16]);
  }
  for (const [x, y, rx, ry] of blobs) {
    g.fillStyle = tone(0.55 + random() * 0.35);
    g.beginPath();
    g.ellipse(x, y, rx, ry, (random() - 0.5) * 0.6, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y, rx, ry] of blobs) if (random() > 0.45) snowCap(g, x + (random() - 0.5) * rx * 0.4, y, rx, ry);
};

/** 点叶: a round crown built from many short horizontal dabs in clumps, over a forked trunk. */
const dotted: Painter = (g, random, tone) => {
  const lean = (random() - 0.5) * 30;
  trunk(g, tone, 11 + random() * 5, lean, 300);
  g.lineWidth = 6;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(128 + lean, 310);
    g.quadraticCurveTo(128 + lean + side * 40, 260, 128 + lean + side * (60 + random() * 30), 200);
    g.stroke();
  }
  const clumps = 6 + Math.floor(random() * 4);
  const caps: [number, number, number, number][] = [];
  for (let c = 0; c < clumps; c++) {
    const a = (c / clumps) * Math.PI * 2 + random() * 0.6;
    const cx = 128 + lean * 0.8 + Math.cos(a) * (40 + random() * 30), cy = 175 + Math.sin(a) * (55 + random() * 25);
    const rx = 34 + random() * 18, ry = 24 + random() * 12;
    caps.push([cx, cy, rx, ry]);
    const dabs = 26 + Math.floor(random() * 14);
    for (let d = 0; d < dabs; d++) {
      const r = Math.sqrt(random()), t = random() * Math.PI * 2;
      g.fillStyle = tone(0.5 + random() * 0.45);
      g.beginPath();
      g.ellipse(cx + Math.cos(t) * r * rx, cy + Math.sin(t) * r * ry, 7 + random() * 5, 3.5 + random() * 2.5, (random() - 0.5) * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const [x, y, rx, ry] of caps) if (y < 190 && random() > 0.3) snowCap(g, x, y, rx, ry);
};

/** 松: a leaning trunk with flat plates of needles, snow lying on each plate. */
const pine: Painter = (g, random, tone) => {
  const lean = (random() - 0.5) * 70;
  trunk(g, tone, 12 + random() * 4, lean, 90);
  const plates = 4 + Math.floor(random() * 2);
  for (let i = 0; i < plates; i++) {
    const t = i / (plates - 1);
    const y = 90 + t * 260;
    const x = 128 + lean * (1 - (y - 90) / 422) + (random() - 0.5) * 50;
    const rx = 52 + Math.sin(t * Math.PI * 0.9 + 0.3) * 40 + random() * 15, ry = 15 + random() * 8;
    g.fillStyle = tone(0.6 + random() * 0.3);
    g.beginPath();
    g.ellipse(x, y, rx, ry, (random() - 0.5) * 0.25, 0, Math.PI * 2);
    g.fill();
    // Needle strokes along the underside.
    g.strokeStyle = tone(0.9);
    g.lineWidth = 3;
    for (let n = 0; n < 12; n++) {
      const nx = x + (random() - 0.5) * rx * 1.7;
      g.beginPath(); g.moveTo(nx, y); g.lineTo(nx + (random() - 0.5) * 8, y + ry + 4); g.stroke();
    }
    g.fillStyle = palette.paper;
    g.beginPath();
    g.ellipse(x, y - ry * 0.45, rx * 0.85, ry * 0.45, 0, Math.PI, Math.PI * 2);
    g.fill();
  }
};

/** 寒林: a bare winter tree, branches forking like crab claws (蟹爪), a line of snow on the larger ones. */
const bare: Painter = (g, random, tone) => {
  g.lineCap = 'round';
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number) => {
    const x2 = x + Math.cos(angle) * length, y2 = y + Math.sin(angle) * length;
    g.strokeStyle = tone(0.85);
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo((x + x2) / 2 + (random() - 0.5) * length * 0.3, (y + y2) / 2, x2, y2);
    g.stroke();
    if (width > 5 && angle < -0.4 && angle > -2.7) {
      g.strokeStyle = palette.paper;
      g.lineWidth = Math.max(2, width * 0.35);
      g.beginPath(); g.moveTo(x, y - width * 0.45); g.lineTo(x2, y2 - width * 0.45); g.stroke();
    }
    if (depth <= 0) return;
    const forks = 2 + (random() < 0.4 ? 1 : 0);
    for (let i = 0; i < forks; i++) {
      branch(x2, y2, angle + (random() - 0.5) * 1.3, length * (0.6 + random() * 0.15), Math.max(2.5, width * 0.62), depth - 1);
    }
  };
  branch(128, 512, -Math.PI / 2 + (random() - 0.5) * 0.25, 170 + random() * 40, 15, 4);
};

const PAINTERS: Painter[] = [cypress, cypress, dotted, dotted, pine, bare];

function paintCard(seed: number, variant: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 512;
  const g = canvas.getContext('2d')!;
  const random = seededRandom(seed);
  const tone = (amount: number) => {
    const p = [239, 232, 218], k = [26, 23, 20];
    return `rgb(${p.map((v, i) => Math.round(v + (k[i] - v) * amount)).join(',')})`;
  };
  PAINTERS[variant](g, random, tone);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createTrees(points: { x: number; y: number; z: number }[], seed = FOREST_SEED) {
  const root = new Group();
  root.name = 'cypress-cards';
  const plan = treePlan(points, seed);
  const geometry = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  // One shared yaw replaces rewriting / uploading 32,000 instance matrices on every turn.
  const facing = uniform(new Vector2(1, 0));
  const meshes = Array.from({ length: VARIANTS }, (_, variant) => {
    const material = new MeshBasicNodeMaterial({ side: DoubleSide, alphaTest: 0.5 });
    material.positionNode = Fn(() => {
      // positionNode runs AFTER Three's default instancing. Start from geometry coordinates,
      // rotate only the card, then apply the static instance matrix so its root stays planted.
      normalLocal.assign(vec3(facing.y, 0, facing.x));
      const card = vec3(positionGeometry.x.mul(facing.x), positionGeometry.y, positionGeometry.x.mul(facing.y).negate());
      // r187's referenceAttribute typings omit the TSL matrix proxy returned by mat4().
      return mat4(referenceAttribute('instanceMatrix', 'mat4') as unknown as Node<'mat4'>).mul(card).xyz;
    })();
    if (typeof document !== 'undefined') {
      material.map = paintCard(seed + variant * 7919, variant);
      // Recover the painted ink amount from the card's paper-to-ink colour.
      const paperL = luminance(color(palette.paper)), inkL = luminance(color(palette.ink));
      // Cards are painted dark; in the map they sit a step lighter so groves read as masses, not specks.
      const inkAt = (q: Node<'vec2'>) => paperL.sub(luminance(texture(material.map!, q).rgb)).div(paperL.sub(inkL)).clamp(0, 1);
      let amount: Node<'float'> = inkAt(uv()).mul(0.82);
      let wash: Node<'float'> | number = 0;
      if (variant === 5) {
        // 红梅 (decorative): about a third of the bare winter trees carry red blossoms — small
        // dots wherever a twig passes the centre of a cell. They fade out before they reach pixel size.
        // Per-tree choice made in the vertex stage (instanceIndex is not available per fragment).
        const treeSeed = varying(hash(float(instanceIndex).add(19.7)));
        const picked = treeSeed.lessThan(0.35).select(1, 0);
        // Two dot scales: fine blossoms up close, a few larger clusters from mid distance, each fading
        // out before its dots shrink below a couple of pixels.
        const dots = (cells: number, radius: number, keep: number, salt: number) => {
          const grid = uv().mul(cells);
          const cell = floor(grid);
          const jitter = vec2(hash(cell.x.add(cell.y.mul(57)).add(salt)), hash(cell.x.mul(31).add(cell.y).add(salt * 3.1))).sub(0.5).mul(0.5);
          const onTwig = smoothstep(0.08, 0.2, inkAt(cell.add(0.5).add(jitter).div(cells)));
          const sparse = hash(cell.x.mul(13).add(cell.y.mul(101)).add(treeSeed.mul(97)).add(salt)).lessThan(keep).select(1, 0);
          const size = fwidth(grid.y);
          return smoothstep(radius, radius * 0.6, length(fract(grid).sub(0.5).sub(jitter))).mul(onTwig).mul(sparse)
            .mul(float(1).sub(smoothstep(radius * 0.7, radius * 1.1, size)));
        };
        const fine = dots(15, 0.3, 0.6, 1.3);
        const coarse = dots(4, 0.36, 0.55, 5.7).mul(smoothstep(0.1, 0.2, fwidth(uv().y).mul(15)));
        const blossom = fine.max(coarse).mul(picked);
        amount = amount.mul(float(1).sub(blossom)).add(blossom.mul(0.1));
        wash = blossom;
        // Diffuse alpha is map.a × opacity, so the blossom has to widen the colour's own alpha.
        const painted = texture(material.map!, uv());
        material.colorNode = vec4(painted.rgb, max(painted.a, blossom));
      }
      material.mrtNode = inkOutputs(amount, wash, amount.mul(0), CATEGORY.plant);
    }
    const trees = plan.filter(t => t.variant === variant);
    const mesh = new InstancedMesh(geometry, material, Math.max(1, trees.length));
    mesh.count = trees.length;
    mesh.name = `cypress-cards-${variant}`;
    mesh.userData = { category: 3, trees };
    mesh.frustumCulled = false;
    root.add(mesh);
    return mesh;
  });
  const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3();
  for (const mesh of meshes) {
    (mesh.userData.trees as TreePlan[]).forEach((tree, i) => {
      position.set(tree.x, tree.y, tree.z);
      // Equal horizontal scales let the vertex shader rotate the card before instancing.
      scale.set(tree.width, tree.height, tree.width);
      mesh.setMatrixAt(i, matrix.makeScale(scale.x, scale.y, scale.z).setPosition(position));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  /** Turn every card to face a camera with this horizontal yaw. */
  function face(value: number) {
    facing.value.set(Math.cos(value), Math.sin(value));
  }
  return { root, plan, face };
}
