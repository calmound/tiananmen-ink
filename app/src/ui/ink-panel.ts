import type GUI from 'lil-gui';
import { INK_DEFAULTS, INK_VIEWS, type InkKey } from '../config/ink-defaults';
import { ink, inkView, readInk } from '../render/ink/params';
import { applyPresetObject, exportPreset, loadPreset, PRESETS } from '../render/ink/presets';

// SPEC 11.1: one folder per pipeline step, channel views, presets, and a
// translucent target-image overlay for comparing against docs/targets/T*.png.

const targets = import.meta.glob<string>('../../../docs/targets/T*.{png,jpg,jpeg,webp}', {
  eager: true, query: '?url', import: 'default',
});
const targetFor = (index: number) =>
  Object.entries(targets).find(([path]) => new RegExp(`/T${index}\\.`).test(path))?.[1];

type Range = [InkKey, string, number, number, number?];
const GROUPS: [string, Range[]][] = [
  ['① 墨色分级', [
    ['t1', '阈值 1', 0, 1], ['t2', '阈值 2', 0, 1], ['t3', '阈值 3', 0, 1], ['t4', '阈值 4', 0, 1],
    ['d0', '清', 0, 1], ['d1', '淡', 0, 1], ['d2', '重', 0, 1], ['d3', '浓', 0, 1], ['d4', '焦', 0, 1],
    ['levelSoftness', '级间柔和', 0, 0.2, 0.005], ['noiseScale', '干湿噪声尺度 /米', 0.01, 1, 0.005], ['noiseStrength', '干湿噪声强度', 0, 0.5],
  ]],
  ['② 界画线', [
    ['archWidth', '线宽 px', 0.5, 4, 0.1], ['depthThreshold', '深度阈值', 0.002, 0.1, 0.001],
    ['normalThreshold', '法线阈值', 0.05, 1], ['archBreak', '断线概率', 0, 0.2],
  ]],
  ['② 写意线', [
    ['freeWidth', '线宽 px', 0.5, 6, 0.1], ['freeJitter', '抖动 px', 0, 4, 0.1], ['freeBreak', '断线概率', 0, 0.6],
    ['lineFade', '线条远淡', 0, 1],
    ['detailNear', '细线开始减少（米/像素）', 0.05, 2, 0.01], ['detailFar', '细线基本消失（米/像素）', 0.2, 5, 0.05],
  ]],
  ['② 笔意', [
    ['pressure', '提按（线宽变化）', 0, 1], ['dryBrush', '飞白', 0, 1], ['texture', '皴擦（墙面）', 0, 0.5],
    ['roadLine', '道路边线', 0, 1], ['shoreLine', '岸线', 0, 1],
  ]],
  ['水面与道路', [
    ['waterInk', '水面墨量', 0, 0.8], ['waterTint', '花青比例', 0, 1], ['ripple', '水纹浓度', 0, 1],
    ['rippleSpacing', '水纹间距 米', 3, 30, 0.5], ['roadInk', '路面墨量', 0, 0.4],
  ]],
  ['云气', [['mistStrength', '浓度', 0, 1], ['mistScale', '尺度', 0.0003, 0.006, 0.0001], ['mistSpeed', '飘移速度', 0, 30, 0.5]]],
  ['云上舞台', [
    ['stageMode', '舞台（0 开阔 / 1 案上 / 2 云上）', 0, 2, 1],
    ['cloudY', '云面高度 米', -300, 0, 1], ['horizonDistance', '地平线距离 米', 15000, 60000, 500],
    ['cloudScale', '云团尺度 /米', 0.0003, 0.002, 0.0001], ['cloudDrift', '云漂移 米/秒', 0, 12, 0.5],
    ['cloudCoverage', '云海覆盖率', 0, 1], ['cloudInk', '凹处墨量', 0, 0.25],
    ['hills', '远山', 0, 1], ['hillInk', '山墨', 0, 0.8], ['clouds', '横云', 0, 1],
    ['backdrop', '案面墨量', 0, 0.2], ['tableShadow', '案面软影', 0, 0.5],
  ]],
  ['③ 晕染', [['bleedRadius', '半径 px', 0, 10, 0.1], ['bleedStrength', '强度', 0, 1], ['edgeDarken', '边缘加深', 0, 1]]],
  ['④ 远淡', [
    ['fadeStrength', '强度', 0, 1], ['fadeNear', '起点（× 观察距离）', 0.5, 4, 0.05], ['fadeFar', '终点（× 观察距离）', 1, 10, 0.1],
    ['fogHeight', '低处雾高度 米', 0, 15, 0.1], ['fogStrength', '低处雾强度', 0, 1],
  ]],
  ['⑤ 积雪', [['snowStrength', '留白强度', 0, 1], ['snowLow', '法线下限', 0, 1], ['snowHigh', '法线上限', 0, 1]]],
  ['⑥ 朱砂', [['cinnabarStrength', '淡彩强度', 0, 1], ['glaze', '琉璃黄', 0, 1], ['coolTint', '远景花青', 0, 1], ['contrast', '浓淡对比', 0, 1], ['edgeVeil', '四周留白', 0, 1], ['smoke', '炊烟', 0, 1], ['skyWarm', '天边暖色', 0, 1], ['sun', '淡日', 0, 1]]],
  ['⑦ 纸', [['paperStrength', '纹理强度', 0, 0.4], ['vignette', '暗角', 0, 0.5]]],
];
const SWITCHES: [InkKey, string][] = [
  ['tonesOn', '① 墨色分级'], ['linesOn', '② 勾线'], ['bleedOn', '③ 晕染'], ['fadeOn', '④ 远淡与低雾'],
  ['snowOn', '⑤ 积雪'], ['cinnabarOn', '⑥ 朱砂'], ['paperOn', '⑦ 宣纸与暗角'],
];

export function addInkPanel(gui: GUI) {
  const values: Record<string, number | boolean | string> = { ...readInk() };
  const folder = gui.addFolder('水墨管线');
  const control = {
    preset: Object.keys(PRESETS).includes('C-full') ? 'C-full' : Object.keys(PRESETS)[0] ?? '',
    view: INK_VIEWS[0] as string,
    name: 'my-preset',
    overlay: false,
    opacity: 0.5,
    export: () => {
      const blob = new Blob([exportPreset(control.name)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${control.name}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    import: () => fileInput.click(),
    reset: () => { applyPresetObject({}); sync(); },
  };
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try { applyPresetObject(JSON.parse(await file.text())); sync(); }
    catch (error) { console.error('预设读取失败', error); }
    fileInput.value = '';
  });

  folder.add(control, 'preset', Object.keys(PRESETS)).name('预设').onChange((name: string) => { loadPreset(name); sync(); });
  folder.add(control, 'view', [...INK_VIEWS]).name('显示通道').onChange((v: string) => {
    inkView.value = INK_VIEWS.indexOf(v as (typeof INK_VIEWS)[number]);
  });
  folder.add(control, 'name').name('导出文件名');
  folder.add(control, 'export').name('导出当前参数 JSON');
  folder.add(control, 'import').name('导入 JSON');
  folder.add(control, 'reset').name('恢复默认值');

  const steps = folder.addFolder('步骤开关');
  const controllers: ReturnType<GUI['add']>[] = [];
  for (const [key, label] of SWITCHES) {
    values[key] = ink[key].value === 1;
    controllers.push(steps.add(values, key).name(label).onChange((v: boolean) => { ink[key].value = v ? 1 : 0; }));
  }
  for (const [title, ranges] of GROUPS) {
    const group = folder.addFolder(title);
    group.close();
    for (const [key, label, min, max, step = 0.01] of ranges) {
      controllers.push(group.add(values, key, min, max, step).name(label)
        .onChange((v: number) => { ink[key].value = v; }));
    }
  }
  function sync() {
    const current = readInk();
    for (const key of Object.keys(INK_DEFAULTS) as InkKey[]) {
      values[key] = SWITCHES.some(([k]) => k === key) ? current[key] === 1 : current[key];
    }
    controllers.forEach(c => c.updateDisplay());
  }

  // Target image overlay.
  const overlay = document.createElement('img');
  overlay.className = 'target-overlay';
  overlay.alt = '';
  overlay.hidden = true;
  document.body.append(overlay);
  const compare = folder.addFolder('对比目标画面');
  const available = Object.keys(targets).length > 0;
  const pick = { image: 1 };
  compare.add(pick, 'image', 1, 5, 1).name('目标画面 T').onChange(() => refreshOverlay());
  compare.add(control, 'overlay').name(available ? '叠放目标画面' : '叠放（docs/targets 为空）')
    .onChange((v: boolean) => { overlay.hidden = !v || !available; refreshOverlay(); });
  compare.add(control, 'opacity', 0, 1, 0.01).name('透明度').onChange(() => refreshOverlay());
  function refreshOverlay() {
    if (overlay.hidden) return;
    const url = targetFor(pick.image);
    overlay.style.opacity = String(control.opacity);
    if (url && overlay.src !== url) overlay.src = url;
    overlay.style.visibility = url ? 'visible' : 'hidden';
  }
  return {
    dispose() { overlay.remove(); },
  };
}
