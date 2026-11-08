import { AXIS_X as AX } from '../data/layout';

/** Preset map views: target on the ground, distance, polar angle (0 = straight down) and azimuth (0 = looking north). */
export interface MapView { id: string; title: string; target: [number, number, number]; distance: number; polar: number; azimuth: number }

export const VIEWS: MapView[] = [
  // Replaced at start-up by the whole-ring view when the data covers the 2nd Ring (see overviewFor).
  { id: 'overview', title: '全景', target: [AX, 0, -420], distance: 2300, polar: 52, azimuth: -18 },
  { id: 'center', title: '天安门周边', target: [AX, 0, -420], distance: 2300, polar: 52, azimuth: -18 },
  { id: 'tiananmen', title: '天安门', target: [AX, 12, 10], distance: 260, polar: 62, azimuth: -28 },
  { id: 'palace', title: '故宫', target: [AX, 0, -950], distance: 900, polar: 50, azimuth: -20 },
  { id: 'square', title: '天安门广场', target: [AX, 0, 520], distance: 900, polar: 55, azimuth: 160 },
  { id: 'taihe', title: '太和殿', target: [AX, 15, -930], distance: 220, polar: 60, azimuth: -25 },
  { id: 'jingshan', title: '景山', target: [14, 30, -1790], distance: 520, polar: 58, azimuth: 160 },
  { id: 'jiaolou', title: '角楼', target: [370, 14, -1500], distance: 190, polar: 66, azimuth: 215 },
  { id: 'tiantan', title: '天坛', target: [1178, 15, 2835], distance: 420, polar: 58, azimuth: -20 },
  { id: 'gulou', title: '钟鼓楼', target: [32, 20, -3630], distance: 420, polar: 60, azimuth: -25 },
  { id: 'shichahai', title: '什刹海', target: [-700, 0, -3050], distance: 1200, polar: 52, azimuth: -15 },
  { id: 'qianmen', title: '前门', target: [AX, 10, 950], distance: 380, polar: 60, azimuth: -30 },
  // Low and long, looking west-northwest over the palace towards the (decorative) distant hills.
  { id: 'xiwang', title: '西望', target: [AX, 0, -1200], distance: 2600, polar: 77, azimuth: -60 },
  // Low, looking east-southeast over the palace and the square: where the (night) moon hangs.
  { id: 'dongwang', title: '东望', target: [AX, 0, -600], distance: 4600, polar: 80, azimuth: 115 },
  // 云海 cover: low over the south-east of the city, looking WNW; decorative ranges / geese in the sky.
  { id: 'yunhai', title: '云海', target: [-500, 0, -700], distance: 7600, polar: 79, azimuth: -55 },
];

// maxDistance: zoomed further out the city shrinks to a small grey slab and the ink detail is lost,
// so the camera stops at about the whole-city view (the edge of the plinth melts into the cloud sea).
export const CONTROL_LIMITS = { minDistance: 35, maxDistance: 9000, maxPolar: 80, minPolar: 0 };

/** Whole-map view framing the given bounds (X min, X max, Z min, Z max). */
export function overviewFor([x0, x1, z0, z1]: [number, number, number, number], aspect = 16 / 9): MapView {
  const extent = Math.max(x1 - x0, z1 - z0);
  // Narrow (portrait) screens stand a little further back; the sides may crop rather than shrink the city.
  const narrow = Math.min(1.25, Math.max(1, 1.2 / aspect));
  // The city fills the frame; its rim dissolves into the cloud sea rather than showing a slab.
  return { id: 'overview', title: '全景', target: [(x0 + x1) / 2, 0, (z0 + z1) / 2 + extent * 0.04],
    distance: Math.min(CONTROL_LIMITS.maxDistance, extent * 0.92 * narrow), polar: 48, azimuth: -12 };
}
