import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, InstancedMesh, Mesh, PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu';
import { layout } from '../src/data/layout';
import { createWorld } from '../src/scene/world';
import { landmarkHeight, orientedRect, PLINTH_DEPTH, pointInPolygon, polygonArea, terrainY, type CityData } from '../src/scene/city';
import { treePlan } from '../src/scene/trees';
import { createRoof } from '../src/scene/geometry';
import { hallPlans } from '../src/scene/gates';
import { emptyBucket, mergeSlot } from '../src/scene/kit/build';
import { buildRoof, buildSkirt, KIT_DEFAULTS } from '../src/scene/kit/roof';
import { LANDMARKS } from '../src/config/landmarks';
import { CONTROL_LIMITS, VIEWS } from '../src/config/views';
import { INK_DEFAULTS } from '../src/config/ink-defaults';
import { createGeese, GEESE_EYE_LIFT, GEESE_ROUTES } from '../src/scene/life';
import { applyInk, ink } from '../src/render/ink/params';

const approximately = (a: number, b: number, epsilon = 0.001) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const cityText = readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8');
const city = JSON.parse(cityText) as CityData;
const world = createWorld(city);

// ── Axis data (P0) ───────────────────────────────────────────────────────
assert.equal(layout.bridges.length, 5);
assert.equal(layout.columns.length, 4);
assert.equal(layout.corrections.length, 11);
assert.equal(layout.gates.reduce((n, gate) => n + gate.parts.length, 0), 68);
assert.deepEqual(layout.gates.map(g => g.platformHeight), [13, 13, 17]);
assert.deepEqual(layout.gates.map(g => g.height), [35, 35, 45]);
for (const gate of layout.gates) {
  const bounds = new Box3().setFromObject(world.gates.getObjectByName(gate.id)!);
  approximately(bounds.min.y, 0, 0.05);
  assert.ok(bounds.max.y >= gate.height && bounds.max.y <= gate.height + 3.2, `${gate.id} 顶高 ${bounds.max.y}`);
  for (const part of gate.parts) if (part.roof) for (const polygon of part.polygons) {
    const roof = createRoof(part, polygon);
    roof.computeBoundingBox();
    approximately(roof.boundingBox!.max.y, part.top, 0.03);
    roof.dispose();
  }
}

// ── Architecture kit (P2): roofs meet the data's eave and ridge heights ──
assert.equal(hallPlans.length, 12);
for (const plan of hallPlans) {
  const top = emptyBucket();
  buildRoof(top, KIT_DEFAULTS, plan.roof, plan.top.outer, plan.upperBody ?? plan.body, plan.top.eaveY, plan.top.ridgeY);
  const roof = mergeSlot(top.roof)!;
  roof.computeBoundingBox();
  assert.ok(Math.abs(roof.boundingBox!.min.y - plan.top.eaveY) < 1, `${plan.id} 檐口`);
  assert.ok(Math.abs(roof.boundingBox!.max.y - plan.top.ridgeY) < 1, `${plan.id} 屋脊`);
  if (plan.skirt) {
    const lower = emptyBucket();
    buildSkirt(lower, KIT_DEFAULTS, plan.skirt.outer, plan.skirt.inner, plan.body, plan.skirt.eaveY, plan.skirt.topY);
    const skirt = mergeSlot(lower.roof)!;
    skirt.computeBoundingBox();
    assert.ok(skirt.boundingBox!.max.y <= plan.skirt.topY + 1e-3, `${plan.id} 下檐顶`);
    skirt.dispose();
  }
  roof.dispose();
}

// ── City data (map step 1) ──────────────────────────────────────────────
assert.ok(!/"lat"|"lon"/.test(cityText), '城市数据中不得出现经纬度');
assert.ok(city.buildings.length > 2500, `建筑数 ${city.buildings.length}`);
const [x0, x1, z0, z1] = city.bounds;
for (const b of city.buildings) {
  assert.ok(b.poly.length >= 3 && b.poly.every(p => p.every(Number.isFinite)));
  const [cx, cz] = [b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length, b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length];
  assert.ok(cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1, `${b.id} 超出地图范围`);
  if (city.ring) assert.ok(pointInPolygon([cx, cz], city.ring), `${b.id} 不在二环内`);
}
// Oriented rectangle sanity: a rotated 20 × 8 m box.
const a = Math.PI / 7, c = Math.cos(a), s = Math.sin(a);
const box: [number, number][] = [[-10, -4], [10, -4], [10, 4], [-10, 4]].map(([x, z]) => [x * c - z * s + 50, x * s + z * c - 30]);
const rect = orientedRect(box);
approximately(rect.a, 10, 1e-6); approximately(rect.b, 4, 1e-6); approximately(polygonArea(box), 160, 1e-6);
approximately(Math.abs(Math.cos(rect.angle - a)), 1, 1e-6);
assert.ok(terrainY(14, -1790) > 40 && terrainY(0, 0) === 0, '景山地形');

// Landmarks: each one in the list must be found in the data, and be labelled.
const labels = world.city.labels;
// (With only the central extract, landmarks further out are simply not in the data.)
const inData = new Set(city.buildings.map(b => b.name));
const missing = LANDMARKS.filter(l => (city.ring || inData.has(l.name)) && !labels.some(x => x.name === l.name)).map(l => l.name);
assert.deepEqual(missing, [], `缺少地标 ${missing.join('、')}`);
for (const name of ['天安门', '端门', '午门', '故宫', '天安门广场']) assert.ok(labels.some(l => l.name === name), `缺少标签 ${name}`);
for (const l of labels) assert.ok(l.position.every(Number.isFinite));

// Restricted compound around 中海 / 南海: water only, no buildings or labels there.
const lakes = city.water.filter(w => w.name === '中海' || w.name === '南海').flatMap(w => w.poly);
if (lakes.length && city.ring) {
  const lx0 = Math.min(...lakes.map(p => p[0])) - 150, lx1 = Math.max(...lakes.map(p => p[0])) + 50;
  const lz0 = Math.min(...lakes.map(p => p[1])) + 20, lz1 = Math.min(Math.max(...lakes.map(p => p[1])) + 50, 130);
  const inside = ([x, z]: [number, number]) => x > lx0 && x < lx1 && z > lz0 && z < lz1;
  for (const b of city.buildings) {
    const c: [number, number] = [b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length, b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length];
    assert.ok(!inside(c), `${b.id} 位于不建模区域`);
  }
  for (const l of world.city.labels) assert.ok(!inside([l.position[0], l.position[2]]), `标签 ${l.name} 位于不建模区域`);
}

// Detail tiles: generated around the target, released when it moves away.
world.city.update(0, -900, 400, 0);
assert.equal(world.city.nearTiles, 0, '交互期间不得同步生成细节区块');
assert.ok(world.city.pendingTiles > 0, '暂停生成时应保留待建任务');
assert.ok(world.city.tiles.every(t => !world.city.isHidden(t.index)), '细节就绪前必须保留远景建筑');
// A tiny frame budget starts a tile but keeps its far geometry until the whole tile is ready.
world.city.update(0, -900, 400, 1, 0.5);
world.city.update(0, -900, 6000, 0);
assert.equal(world.city.pendingTiles, 0, '离开区域应取消未完成的细节任务');
assert.ok(world.city.tiles.every(t => !world.city.isHidden(t.index)), '取消后不得留下空洞');
const built = world.city.update(0, -900, 400, 99);
assert.ok(built > 0 && world.city.nearTiles === built, '近处应生成细节区块');
// The far stand-in of every detailed tile is hidden (no double geometry), and only those.
for (const t of world.city.tiles) assert.equal(world.city.isHidden(t.index), t.near !== null, `分块 ${t.key} 远景隐藏状态`);
assert.ok(world.city.farMeshes < 120, `远景网格过多 ${world.city.farMeshes}`);
world.city.update(0, -900, 6000, 99);
assert.equal(world.city.nearTiles, 0, '拉远后应释放细节区块');
assert.ok(world.city.tiles.every(t => !world.city.isHidden(t.index)), '拉远后远景应全部显示');

// Rotating tree cards must leave the static instance placement and upload versions intact.
const treeInstances = world.trees.root.children.filter((o): o is InstancedMesh => o instanceof InstancedMesh);
const treeMatrices = treeInstances.map(o => ({ array: Array.from(o.instanceMatrix.array), version: o.instanceMatrix.version }));
world.trees.face(1.2);
treeInstances.forEach((o, i) => {
  assert.deepEqual(Array.from(o.instanceMatrix.array), treeMatrices[i].array, '树木转向不得改变树根位置');
  assert.equal(o.instanceMatrix.version, treeMatrices[i].version, '树木转向不得重新上传实例矩阵');
});
world.trees.face(0);

// 云上: authored routes stay clear of the ring, and add exactly one instanced mesh (66 birds).
assert.equal(INK_DEFAULTS.stageMode, 2);
assert.ok(INK_DEFAULTS.cloudY < 0 && INK_DEFAULTS.cloudY > -PLINTH_DEPTH, '云面应在地面以下、台底以上');
applyInk({ sandbox: 1 }); assert.equal(ink.stageMode.value, 1, '旧案面预设迁移');
applyInk({ sandbox: 1, stageMode: 2 }); assert.equal(ink.stageMode.value, 2, '新舞台参数优先');
const geese = createGeese();
assert.equal(geese.count, 66);
assert.equal(geese.mesh.geometry.instanceCount, GEESE_ROUTES.reduce((n, r) => n + r.count, 0));
assert.equal(geese.mesh.geometry.groups.length, 0, '雁阵不得拆成额外绘制组');
for (const r of GEESE_ROUTES) {
  assert.ok(r.count >= 9 && r.count <= 15 && r.count % 2 === 1);
  assert.ok(r.height >= 600 && r.height <= 1800 && r.speed >= 15 && r.speed <= 20);
  for (let t = -0.5; t <= 0.5; t += 0.1) {
    const p: [number, number] = [r.x + Math.sin(r.heading) * r.length * t, r.z + Math.cos(r.heading) * r.length * t];
    assert.ok(Math.hypot(...p) >= 4000 && Math.hypot(...p) <= 9000, '雁阵航线应在台外 4–9 km');
    if (city.ring) assert.ok(!pointInPolygon(p, city.ring), '雁阵航线不得穿过台座');
  }
}
for (const attr of ['route', 'flight', 'bird']) {
  const a = geese.mesh.geometry.getAttribute(attr);
  assert.equal(a.count, geese.count);
  assert.ok(Array.from(a.array).every(Number.isFinite));
}
world.scene.add(geese.mesh);

let meshes = 0, vertices = 0;
world.scene.traverse(object => {
  if (!(object instanceof Mesh)) return;
  meshes++;
  const position = object.geometry.getAttribute('position');
  vertices += position.count;
  assert.ok(Array.from(position.array as ArrayLike<number>).every(Number.isFinite), `${object.name} 含无效顶点`);
});
const trees = treePlan(world.city.trees);
assert.deepEqual(trees, treePlan(world.city.trees));
assert.ok(trees.length > 300 && trees.length <= 32000, `树 ${trees.length}`);

// Walls (OSM): four palace sides with corner towers, imperial red wall, courtyard walls.
const wallInfo = world.wallInfo;
assert.equal(wallInfo.counts.palace, 4, '故宫城墙应为四段');
assert.ok(wallInfo.counts.imperial >= 1 && wallInfo.counts.palaceCourt + wallInfo.counts.other > 100);
assert.ok(wallInfo.palace && wallInfo.palace.x1 - wallInfo.palace.x0 > 700 && wallInfo.palace.z1 - wallInfo.palace.z0 > 900,
  `故宫城墙范围 ${JSON.stringify(wallInfo.palace)}`);
assert.equal(labels.filter(l => l.name === '角楼').length, 4);
// Published heights take precedence over OSM levels (e.g. the Great Hall: 46.5 m, not 4 levels).
for (const spec of LANDMARKS.filter(l => l.known)) {
  const b = city.buildings.find(x => x.name === spec.name)!;
  approximately(landmarkHeight(b, spec), spec.known!.height);
}

// Views stay inside the controls' limits and the map.
assert.equal(new Set(VIEWS.map(v => v.id)).size, VIEWS.length, '视角 ID 不得重复');
assert.ok(VIEWS.some(v => v.id === 'yunhai'), '缺少云海封面视角');
for (const v of VIEWS) {
  assert.ok(v.distance >= CONTROL_LIMITS.minDistance && v.distance <= CONTROL_LIMITS.maxDistance, v.id);
  assert.ok(v.polar <= CONTROL_LIMITS.maxPolar, v.id);
  assert.ok(v.target[0] >= x0 && v.target[0] <= x1 && v.target[2] >= z0 && v.target[2] <= z1, v.id);
  assert.ok(new Vector3(...v.target).y >= 0);
}

// Analytical framing at ?shot time 0. This checks projection, not rendered appearance.
const cameraFor = (id: string, aspect: number) => {
  const v = VIEWS.find(v => v.id === id)!;
  const camera = new PerspectiveCamera(36, aspect, Math.min(400, Math.max(1, v.distance * 0.04)), v.distance + 13000);
  camera.position.setFromSpherical(new Spherical(v.distance, v.polar * Math.PI / 180, -v.azimuth * Math.PI / 180)).add(new Vector3(...v.target));
  camera.lookAt(new Vector3(...v.target)); camera.updateMatrixWorld();
  return camera;
};
const inFrame = (p: Vector3) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > -1 && p.z < 1;
for (const aspect of [16 / 9, 390 / 844]) {
  const cover = cameraFor('yunhai', aspect);
  const visible = GEESE_ROUTES.filter(r => {
    const p = new Vector3(r.x + Math.sin(r.heading) * r.phase, Math.max(INK_DEFAULTS.cloudY + r.height, cover.position.y + r.height * GEESE_EYE_LIFT), r.z + Math.cos(r.heading) * r.phase);
    return inFrame(p.project(cover));
  });
  assert.ok(visible.length >= 1, '云海封面默认时刻应至少有一队雁阵进入取景范围');
  const east = cameraFor('dongwang', aspect);
  const elevation = -Math.atan2(east.position.y - INK_DEFAULTS.cloudY, INK_DEFAULTS.horizonDistance) + 0.12;
  for (const edge of [-0.024, 0, 0.024]) {
    const el = elevation + edge;
    const p = new Vector3(Math.sin(2) * Math.cos(el), Math.sin(el), -Math.cos(2) * Math.cos(el)).multiplyScalar(10000).add(east.position);
    assert.ok(inFrame(p.project(east)), '东望月轮上下边缘应完整入镜');
  }
}

world.dispose();
console.log(`PASS: walls (${JSON.stringify(wallInfo.counts)}), ${LANDMARKS.filter(l => l.known).length} sourced heights, axis data, 12 kit halls, ${city.buildings.length} city buildings in bounds, no lat/lon, ${LANDMARKS.length} landmarks + ${labels.length} labels, ${meshes} meshes / ${(vertices / 1e6).toFixed(2)}M vertices, ${trees.length} trees, ${VIEWS.length} views.`);
console.log('City notes:\n' + world.city.notes.join('\n'));
console.log('PASS: 云上 defaults, legacy stage migration, 66 GPU geese / 1 mesh, routes outside ring, yunhai flock and dongwang moon framing (landscape / portrait).');
