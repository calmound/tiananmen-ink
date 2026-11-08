// SPEC 7.7 starting values. The user tunes the final look (P3 acceptance);
// these are only a reasonable place to start. Presets in src/ink/presets/.

export const INK_DEFAULTS = {
  // Step switches (1 on, 0 off)
  tonesOn: 1, linesOn: 1, bleedOn: 1, fadeOn: 1, snowOn: 1, cinnabarOn: 1, paperOn: 1,

  // ① tone levels: thresholds and the ink density of each of the five levels
  t1: 0.18, t2: 0.38, t3: 0.58, t4: 0.78,
  d0: 0.0, d1: 0.22, d2: 0.45, d3: 0.7, d4: 0.92,
  levelSoftness: 0.06,
  noiseScale: 0.08, noiseStrength: 0.15,   // world-space dry/wet variation (per metre)

  // ② lines
  archWidth: 1.2, depthThreshold: 0.02, normalThreshold: 0.35, archBreak: 0.03,
  freeWidth: 2.2, freeJitter: 1.5, freeBreak: 0.25,
  lineFade: 0.7,                           // how much lines thin out with distance fade
  detailNear: 0.35, detailFar: 1.6,        // metres per pixel where small creases start / finish giving way

  // ② brush character
  pressure: 0.55,                          // stroke width variation along a line (提按)
  dryBrush: 0.45,                          // amount of dry-brush gaps (飞白)
  roadLine: 0.45, shoreLine: 0.9,          // freehand lines where road / water meet the ground

  // ③ bleed
  bleedRadius: 4, bleedStrength: 0.7, edgeDarken: 0.5,

  // ground and water
  roadInk: 0.1, waterInk: 0.3, waterTint: 0.75, ripple: 0.35, rippleSpacing: 9,
  texture: 0.14,                           // dry-brush rubbing (皴擦) on walls and platforms
  // winter ice (冰面): 1 = frozen lakes with cracks and drifted snow, 0 = open water
  ice: 1, iceInk: 0.17, crack: 0.6, crackScale: 0.022, iceSnow: 0.75,

  // distant hills and cloud bands on the sky (decorative, see pipeline ① 远山与横云)
  hills: 1, hillInk: 0.42, clouds: 0.75,
  // Stage: 0 = open sky (legacy), 1 = table, 2 = 云上. All surroundings are decorative.
  stageMode: 2, backdrop: 0.03, tableShadow: 0.2,
  // 云海: world metres. Just below the ground, so the plinth's cut side is swallowed by cloud
  // and only a thin rim shows (no sandbox slab).
  cloudY: -40, horizonDistance: 30000, cloudScale: 1 / 1500, cloudDrift: 3,
  cloudCoverage: 0.85, cloudInk: 0.14,

  // mist (云气): world-space bands that leave parts of the city as blank paper
  mistStrength: 0.55, mistScale: 0.0016, mistSpeed: 6,

  // ④ distance fade, as multiples of the camera's distance to its map target,
  // so the area you are looking at stays crisp at every zoom level
  fadeStrength: 0.85,
  fadeNear: 1.25, fadeFar: 4.5,
  scrollFadeStart: 1480, scrollFadeEnd: 2100,
  fogHeight: 4, fogStrength: 0.5,

  // ⑤ snow (roof whitening by upward-facing normals)
  snowStrength: 0.85, snowLow: 0.55, snowHigh: 0.8,

  // ⑥ cinnabar wash
  cinnabarStrength: 0.62,
  // 琉璃黄 on the palace roofs where snow leaves the tiles bare; 花青 cast on distance (冷暖: near warm, far cool)
  glaze: 0.75, coolTint: 0.5,
  // 墨分五色: S-curve on the final ink so snow and roads stay paper-white and dark accents go deep
  contrast: 0.55,
  // 留白: the frame edges fade towards blank paper (stronger zoomed out), so the eye settles in the middle
  edgeVeil: 0.4,
  // 炊烟 (decorative chimney smoke over hutong houses), 0 = off
  smoke: 0.55,
  // sky: warm 霞 band above the horizon; pale sun disc and glow (clear mood only)
  skyWarm: 0.35, sun: 0,

  // 主次: when the camera is this far from its target (metres), the old imperial plan keeps its
  // ink and the rest of the city pales; emphasisWash tints the palace ground
  emphasis: 1, emphasisNear: 1500, emphasisFar: 5000, emphasisWash: 0.12,

  // Mood: 0 = day, 1 = snowy night (indigo night wash, lanterns lit)
  night: 0, nightDepth: 0.7,

  // ⑦ paper
  paperStrength: 0.12, vignette: 0.08,
};

export type InkParams = typeof INK_DEFAULTS;
export type InkKey = keyof InkParams;

/** Debug channel views (SPEC 7.5). */
export const INK_VIEWS = ['最终结果', '光照亮度', '法线', '线性深度', '类别 ID', '墨量', '边缘', '积雪遮罩', '淡彩权重',
  '云海墨量', '台脚保留', '月光带', '横云'] as const;
