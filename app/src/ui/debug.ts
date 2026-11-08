import GUI from 'lil-gui';
import { Vector2, type WebGPURenderer } from 'three/webgpu';
import { VIEWS } from '../config/views';
import type { MapCamera } from '../camera/map';
import type { World } from '../scene/world';
import { VALUE_DEFAULTS, VALUE_KEYS, type ValueKey } from '../scene/materials';
import { FOREST_SEED } from '../scene/trees';
import { addInkPanel } from './ink-panel';

export function createDebug({ world, map, renderer, backend, snow }: {
  world: World; map: MapCamera; renderer: WebGPURenderer; backend: string; snow: { visible: boolean };
}) {
  const gui = new GUI({ title: '水墨地图', width: 300 });
  const state = {
    view: VIEWS[0].title,
    trees: true, walls: true, city: true, wireframe: false, seed: FOREST_SEED,
    resolution: '', fps: '—', calls: '—', triangles: '—', distance: '', backend,
    ...VALUE_DEFAULTS,
  };
  addInkPanel(gui);
  const camera = gui.addFolder('视角');
  camera.close();
  camera.add(state, 'view', VIEWS.map(v => v.title)).name('预设视角')
    .onChange((title: string) => map.flyTo(VIEWS.find(v => v.title === title)!));

  const values = gui.addFolder('明暗基线（0 纸 → 1 焦墨）');
  values.close();
  const names: Record<ValueKey, string> = {
    ground: '地面雪', roof: '屋顶积雪', stone: '汉白玉台基', platform: '城台红墙', timber: '殿身与檐底',
    column: '檐柱', bracket: '斗拱带', ridge: '屋脊', gable: '山花', door: '门洞', water: '水面',
    brick: '胡同砖墙', modern: '现代建筑', road: '道路', plinth: '沙盘台座剖面',
  };
  VALUE_KEYS.forEach(key => {
    values.add(state, key, 0, 1, 0.01).name(names[key]).onChange((v: number) => { world.materials.uniforms[key].value = v; });
  });
  values.add(state, 'shading', 0, 0.5, 0.01).name('背光加深').onChange((v: number) => { world.materials.shading.value = v; });
  values.add(state, 'skyTop', 0, 0.6, 0.01).name('卷首天空·顶').onChange((v: number) => { world.materials.skyTop.value = v; });
  values.add(state, 'skyHorizon', 0, 0.6, 0.01).name('卷首天空·地平线').onChange((v: number) => { world.materials.skyHorizon.value = v; });
  values.add(state, 'tileSpacing', 0.3, 1, 0.01).name('瓦垄间距 米').onChange((v: number) => { world.materials.tileSpacing.value = v; });
  values.add(state, 'tileStrength', 0, 1, 0.01).name('瓦垄浓度').onChange((v: number) => { world.materials.tileStrength.value = v; });

  // SPEC 11.1 古建组件: geometry is regenerated on release of each slider.
  const kit = gui.addFolder('古建组件');
  kit.close();
  const kitState = { ...world.style, osm: false };
  const rebuild = (key: keyof typeof world.style) => (v: number) => {
    world.rebuildGates({ [key]: v });
    world.setWireframe(state.wireframe);
  };
  kit.add(kitState, 'sag', 0, 0.9, 0.01).name('举折（屋面下凹）').onFinishChange(rebuild('sag'));
  kit.add(kitState, 'cornerLift', 0, 2, 0.05).name('起翘高度 米').onFinishChange(rebuild('cornerLift'));
  kit.add(kitState, 'cornerFlare', 0, 2.5, 0.05).name('角部外伸 米').onFinishChange(rebuild('cornerFlare'));
  kit.add(kitState, 'xieshanBreak', 0.3, 0.7, 0.01).name('歇山转折位置').onFinishChange(rebuild('xieshanBreak'));
  kit.add(kitState, 'eaveThickness', 0.2, 1, 0.05).name('檐口厚度 米').onFinishChange(rebuild('eaveThickness'));
  kit.add(kitState, 'batter', 0, 1.5, 0.05).name('城台收分 米/10米').onFinishChange(rebuild('batter'));
  kit.add(kitState, 'osm').name('显示 OSM 数据叠加').onChange((v: boolean) => { world.osm.visible = v; });

  const scene = gui.addFolder('场景检查');
  scene.close();
  scene.add(state, 'trees').name('古柏').onChange((v: boolean) => world.setTreesVisible(v));
  scene.add(state, 'walls').name('城墙与院墙').onChange((v: boolean) => { world.walls.visible = v; });
  scene.add({ snow: snow.visible }, 'snow').name('飘雪').onChange((v: boolean) => { snow.visible = v; });
  scene.add(state, 'city').name('城市建筑与地面').onChange((v: boolean) => { world.city.root.visible = v; });
  scene.add(state, 'wireframe').name('线框').onChange((v: boolean) => world.setWireframe(v));
  scene.add(state, 'seed', 1, 99999999, 1).name('树木种子').onFinishChange((v: number) => {
    world.setSeed(v); world.setWireframe(state.wireframe);
  });

  const metrics = gui.addFolder('运行信息');
  for (const [key, name] of Object.entries({ backend: '渲染后端', resolution: '实际分辨率', fps: '帧率', calls: '绘制次数', triangles: '三角形', distance: '观察距离' })) {
    metrics.add(state, key as keyof typeof state).name(name).listen().disable();
  }
  const size = new Vector2();
  return {
    update(fps: number) {
      state.distance = `${map.distance.toFixed(0)} 米`;
      renderer.getDrawingBufferSize(size);
      state.resolution = `${size.x} × ${size.y}`;
      state.fps = `${fps.toFixed(0)} fps`;
      state.calls = String(renderer.info.render.drawCalls);
      state.triangles = renderer.info.render.triangles.toLocaleString();
    },
    dispose() { gui.destroy(); document.querySelector('.target-overlay')?.remove(); },
  };
}
