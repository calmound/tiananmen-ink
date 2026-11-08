import type { RoofType } from './gates';

// Map landmarks. Footprints come from OSM (matched by name).
// Height precedence: `known` (a published figure, with its source) > an OSM height tag >
// `ridge` (a placeholder, TODO(verify)). OSM levels-based estimates never beat `known`.

export type LandmarkKind = 'hall' | 'gate' | 'modern' | 'monument' | 'dome' | 'stupa';

export interface LandmarkSpec {
  name: string;
  kind: LandmarkKind;
  roof?: RoofType;
  double?: boolean;
  /** Terrace / platform height under the hall. TODO(verify) */
  base?: number;
  /** Ridge height above ground, used only when OSM has no height. TODO(verify) */
  ridge?: number;
  /** Published overall height (ground to ridge) and, where given, the terrace height. */
  known?: { height: number; base?: number; source: string };
  /** When several buildings share the name, take the one nearest this point (else the largest). */
  near?: [number, number];
  /** 1 = always, 2 = mid zoom, 3 = close up. */
  tier: 1 | 2 | 3;
}

// Sources checked 2026-11-03 (secondary / encyclopaedic; exact surveying figures not found):
const SRC = {
  chiculture: 'https://chiculture.org.hk/sites/mainsite/files/2022-12/A05_太和殿外_A.pdf',
  gugong: 'https://chiculture.org.hk/sites/mainsite/files/2019-07/1206_gugong_pdf_cn.pdf',
  zhengyang: 'https://www.visitbeijing.com.cn/article/47QkWumnEJO',
  greatHall: 'https://www.12371.cn/2019/04/18/ARTI1555557960952300_all.shtml',
  mausoleum: 'https://www.chinanews.com.cn/cul/2013/11-24/5539815.shtml',
  museum: 'https://www.ourchinastory.com/cn/9207',
  qinian: 'https://you.ctrip.com/sight/beijing1/5168.html',
  bellDrum: 'https://www.visitbeijing.com.cn/article/47QkX50mMao',
};

export const LANDMARKS: LandmarkSpec[] = [
  { name: '太和门', kind: 'hall', roof: 'xieshan', double: true, base: 3.4, ridge: 23.8, tier: 2 },
  { name: '太和殿', kind: 'hall', roof: 'wudian', double: true, base: 8.13, ridge: 35, known: { height: 35.05, base: 8.13, source: SRC.chiculture }, tier: 2 },
  { name: '中和殿', kind: 'hall', roof: 'cuanjian', base: 8.13, ridge: 27, known: { height: 27, source: SRC.gugong }, tier: 2 },
  { name: '保和殿', kind: 'hall', roof: 'xieshan', double: true, base: 8.13, ridge: 29.5, known: { height: 29, source: SRC.gugong }, tier: 2 },
  { name: '乾清门', kind: 'hall', roof: 'xieshan', base: 1.6, ridge: 16, tier: 3 },
  { name: '乾清宫', kind: 'hall', roof: 'wudian', double: true, base: 3, ridge: 24, tier: 2 },
  { name: '交泰殿', kind: 'hall', roof: 'cuanjian', base: 3, ridge: 18, tier: 3 },
  { name: '坤宁宫', kind: 'hall', roof: 'wudian', double: true, base: 3, ridge: 22, tier: 3 },
  { name: '神武门', kind: 'gate', roof: 'wudian', double: true, base: 10, ridge: 31, tier: 2 },
  { name: '东华门', kind: 'gate', roof: 'xieshan', double: true, base: 10, ridge: 24, tier: 3 },
  { name: '西华门', kind: 'gate', roof: 'xieshan', double: true, base: 10, ridge: 24, tier: 3 },
  { name: '体仁阁', kind: 'hall', roof: 'wudian', double: true, base: 4, ridge: 23, tier: 3 },
  { name: '弘义阁', kind: 'hall', roof: 'wudian', double: true, base: 4, ridge: 23, tier: 3 },
  { name: '文华殿', kind: 'hall', roof: 'xieshan', base: 1.5, ridge: 15, tier: 3 },
  { name: '武英殿', kind: 'hall', roof: 'xieshan', base: 1.5, ridge: 15, tier: 3 },
  // 正阳门: tower 27.3 m on its platform, 43.65 m overall → platform about 16.35 m.
  { name: '正阳门', kind: 'gate', roof: 'xieshan', double: true, base: 16.35, ridge: 43.6, known: { height: 43.65, base: 16.35, source: SRC.zhengyang }, tier: 2 },
  { name: '正阳门箭楼', kind: 'gate', roof: 'xieshan', double: true, base: 12, ridge: 38, known: { height: 35.37, source: SRC.zhengyang }, tier: 2 },
  { name: '中山堂', kind: 'hall', roof: 'xieshan', base: 1.5, ridge: 16, tier: 3 },
  // 景山万春亭; the palace garden has a smaller pavilion of the same name.
  { name: '万春亭', kind: 'hall', roof: 'cuanjian', double: true, base: 1, ridge: 17, near: [14, -1790], tier: 2 },
  { name: '人民英雄纪念碑', kind: 'monument', tier: 2 },
  { name: '毛主席纪念堂', kind: 'modern', ridge: 33.6, known: { height: 33.6, source: SRC.mausoleum }, tier: 2 },
  { name: '人民大会堂', kind: 'modern', known: { height: 46.5, source: SRC.greatHall }, tier: 2 },
  { name: '中国国家博物馆', kind: 'modern', known: { height: 42.5, source: SRC.museum }, tier: 2 },
  { name: '国家大剧院', kind: 'dome', tier: 2 },
  // Inside the 2nd Ring, beyond the central area.
  { name: '祈年殿', kind: 'hall', roof: 'cuanjian', double: true, base: 6, ridge: 38, known: { height: 38, source: SRC.qinian }, tier: 2 },
  { name: '皇穹宇', kind: 'hall', roof: 'cuanjian', base: 1.5, ridge: 19.5, tier: 3 },
  { name: '钟楼', kind: 'gate', roof: 'xieshan', double: true, base: 15, ridge: 47.9, known: { height: 47.9, source: SRC.bellDrum }, tier: 2 },
  { name: '鼓楼', kind: 'gate', roof: 'xieshan', double: true, base: 15, ridge: 46.7, known: { height: 46.7, source: SRC.bellDrum }, tier: 2 },
  { name: '白塔', kind: 'stupa', ridge: 35.9, tier: 2 },
  { name: '德胜门箭楼', kind: 'gate', roof: 'xieshan', double: true, base: 12, ridge: 32, tier: 2 },
  { name: '永定门', kind: 'gate', roof: 'xieshan', double: true, base: 8, ridge: 26, tier: 2 },
  { name: '北京站', kind: 'modern', tier: 2 },
];

/** Area labels; the position is the centroid of the named park / square, or a fixed point. */
export const AREAS: { name: string; source?: string; at?: [number, number]; tier?: 1 }[] = [
  { name: '故宫', at: [0, -1060] },
  { name: '天安门广场', source: '天安门广场' },
  { name: '景山公园', source: '景山公园' },
  { name: '中山公园', source: '中山公园' },
  { name: '劳动人民文化宫', at: [190, -300] },
  { name: '前门', at: [0, 1060] },
  // 2nd Ring districts; `source` may be a park, square, water body or street name.
  { name: '天坛公园', source: '天坛公园' },
  { name: '北海公园', source: '北海公园' },
  { name: '什刹海', source: '什刹后海' },
  { name: '南锣鼓巷', source: '南锣鼓巷' },
  { name: '王府井', source: '王府井大街' },
  { name: '大栅栏', source: '大栅栏街' },
  { name: '西单', source: '西单北大街' },
  { name: '东单', source: '东单北大街' },
  { name: '陶然亭公园', source: '陶然亭公园' },
];

// TODO(verify): 景山 is an artificial hill, roughly 45 m; its outline and profile here are a smooth placeholder.
export const JINGSHAN = { centre: [14, -1790] as [number, number], radius: 250, height: 43 };

// SPEC-era placeholders for walls; the wall height is a commonly cited figure, the widths are not verified.
export const WALLS = {
  // 紫禁城城墙高约 10 米 (visitbeijing, countryreports); 底宽 / 顶宽 TODO(verify).
  palace: { height: 10, base: 8.6, top: 6.7, source: 'https://www.countryreports.org/zh/articles/the-forbidden-city' },
  // 皇城红墙 TODO(verify): height and thickness are placeholders.
  imperial: { height: 6, base: 2.2, top: 1.8 },
  // Courtyard / temple walls without a usable height tag. TODO(verify)
  palaceCourt: { height: 5, base: 1.2, top: 1 },
  other: { height: 3, base: 0.8, top: 0.7 },
  // 紫禁城角楼高 27.5 米（含城墙）.
  cornerTower: { height: 27.5, source: 'https://www.countryreports.org/zh/articles/the-forbidden-city' },
};
