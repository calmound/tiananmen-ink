import { Matrix4, RenderPipeline, Vector2, Vector3, type OrthographicCamera, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  clamp, color, dot, float, getViewPosition, length, max, mix, mrt,
  mx_fractal_noise_float, mx_noise_float, normalView, orthographicDepthToViewZ, output, pass,
  packNormalToRGB, perspectiveDepthToViewZ, screenUV, unpackRGBToNormal, select, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { palette } from '../../config/palette';
import { ink, inkFocus, inkView } from './params';
import { createInkBackdrop, type InkStage } from './backdrop';
export type { InkStage } from './backdrop';

// The TSL graph mixes float / vec nodes freely; typing each node adds noise without catching bugs here.
type AnyNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// SPEC 7.1: scene pass with MRT (colour, view normal, depth, tone, grain), then
// ① levels ② lines ③ bleed ④ distance fade ⑤ snow (in the materials) ⑥ cinnabar ⑦ paper.

export function createInkPipeline(renderer: WebGPURenderer, scene: Scene,
  camera: PerspectiveCamera | OrthographicCamera, sky: { top: AnyNode; horizon: AnyNode }, overlay?: Scene, stage?: InkStage) {
  const orthographic = (camera as OrthographicCamera).isOrthographicCamera === true;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    normal: packNormalToRGB(normalView),
    tone: vec4(0, 0, 0, 0),
    grain: vec4(0, 0, 0, 0),
  }));
  const colorT = scenePass.getTextureNode('output');
  const normalT = scenePass.getTextureNode('normal');
  const toneT = scenePass.getTextureNode('tone');
  const grainT = scenePass.getTextureNode('grain');
  const depthT = scenePass.getTextureNode('depth');

  const size = new Vector2();
  renderer.getDrawingBufferSize(size);
  const texel = uniform(new Vector2(1 / size.x, 1 / size.y));
  const near = uniform(camera.near), far = uniform(camera.far);
  // Camera matrices for rebuilding world positions from depth (map hierarchy).
  const projInv = uniform(new Matrix4()), camWorld = uniform(new Matrix4());
  const camHeight = uniform(500);
  const camPos = uniform(new Vector3());
  // World size of one pixel per metre of depth (perspective): 2·tan(fov/2) / height.
  const pixelAngle = uniform(1);
  const updatePixelAngle = () => {
    const fov = (camera as PerspectiveCamera).fov ?? 36;
    pixelAngle.value = 2 * Math.tan(fov * Math.PI / 360) / size.y;
  };
  updatePixelAngle();

  const rawDepth = (p: AnyNode) => depthT.sample(p).x;
  const viewDepth = (p: AnyNode) => (orthographic
    ? orthographicDepthToViewZ(rawDepth(p), near, far)
    : perspectiveDepthToViewZ(rawDepth(p), near, far)).negate();
  const categoryAt = (p: AnyNode) => toneT.sample(p).w.mul(8).round();

  const p = uv();
  const tone = toneT.sample(p);
  const grain = grainT.sample(p);
  const depth = viewDepth(p);
  const category = tone.w.mul(8).round();
  const background = step(0.99999, rawDepth(p));
  const geometry = float(1).sub(background);

  // ① Five ink levels with soft steps. Ink amount (with world-space dry/wet noise) comes from the materials.
  const soft = ink.levelSoftness;
  const level = (amount: AnyNode) => ink.d0
    .add(ink.d1.sub(ink.d0).mul(smoothstep(ink.t1.sub(soft), ink.t1.add(soft), amount)))
    .add(ink.d2.sub(ink.d1).mul(smoothstep(ink.t2.sub(soft), ink.t2.add(soft), amount)))
    .add(ink.d3.sub(ink.d2).mul(smoothstep(ink.t3.sub(soft), ink.t3.add(soft), amount)))
    .add(ink.d4.sub(ink.d3).mul(smoothstep(ink.t4.sub(soft), ink.t4.add(soft), amount)));
  // The cover's sky is a pale ink wash (以墨衬白); the orthographic scroll never sees the background.
  const skyWash = mix(sky.top, sky.horizon, smoothstep(0.0, 0.62, screenUV.y));
  const farDir = getViewPosition(p, float(1), projInv).normalize();
  const dirW = camWorld.mul(vec4(farDir, 0)).xyz.normalize();
  const viewPos = getViewPosition(p, rawDepth(p), projInv);
  const world = camWorld.mul(vec4(viewPos, 1)).xyz;
  const backdrop = createInkBackdrop(dirW, camPos, camHeight, background, category, grain.z, skyWash, stage,
    orthographic ? undefined : { position: world, focus: inkFocus });
  const skyAmount = orthographic ? float(0) : backdrop.amount;
  const plinthKeep = orthographic ? float(1) : backdrop.plinthKeep;
  // Far-off tree cards would alias into black specks; let them settle into a pale wash instead.
  const plantFar = category.equal(3).select(1, 0);
  // Roads and water keep their own flat washes instead of the five-level steps.
  const isWater = category.equal(5), isRoad = category.equal(7), isMarker = category.equal(6);
  const flatWash = isWater.or(isRoad).or(isMarker);
  const surface = mix(skyAmount, select(flatWash, tone.x, level(tone.x)), plinthKeep);
  const leveledRaw = mix(surface.mul(geometry), skyAmount, background).mul(ink.tonesOn);

  // ② Lines. Style is chosen per pixel: ruled (界画) next to buildings, freehand (写意) on ground and water.
  const near1 = [vec2(1.5, 0), vec2(-1.5, 0), vec2(0, 1.5), vec2(0, -1.5)].map(o => p.add(o.mul(texel)));
  const ruled = near1.reduce<AnyNode>((acc, q) => max(acc, categoryAt(q).equal(1).or(categoryAt(q).equal(8)).select(1, 0)),
    category.equal(1).or(category.equal(8)).select(1, 0));
  // 沙盘: the plinth (category 8) and the pixels next to it keep their outline at every zoom,
  // so the model's edge stays drawn even in the overview.
  const plinthNear = near1.reduce<AnyNode>((acc, q) => max(acc, categoryAt(q).equal(8).select(1, 0)), category.equal(8).select(1, 0));
  // Map scale: once one pixel covers more than ~0.4 m, small creases (normal edges, small
  // depth steps) give way so a zoomed-out city does not turn into a field of black specks.
  const metresPerPixel = orthographic ? float(0.3) : depth.mul(pixelAngle);
  const detail = smoothstep(ink.detailNear, ink.detailFar, metresPerPixel);
  // 提按: stroke width swells and thins along a line (world-anchored), and strokes are bolder up close.
  const press = mix(float(1), mix(0.6, 1.6, grain.x), ink.pressure);
  const taper = mix(1.35, 0.8, detail);
  const width = mix(ink.freeWidth.mul(mix(0.5, 1.8, grain.x)), ink.archWidth.mul(press), ruled).mul(taper);
  const jitter = grain.xy.sub(0.5).mul(2).mul(ink.freeJitter).mul(float(1).sub(ruled)).mul(texel);
  const normal = unpackRGBToNormal(normalT.sample(p).rgb);
  const reference = orthographic ? float(120) : depth;
  // Depth uses the second difference along each axis: a plane seen at a grazing angle
  // (the far snowfield) has a steady depth slope and must not count as an edge.
  let depthEdge: AnyNode = float(0), normalEdge: AnyNode = float(0), areaEdge: AnyNode = float(0);
  // Ground, road and water lie in one plane: their borders are found from the category instead.
  const flatCategory = (c: AnyNode) => c.equal(2).or(c.equal(5)).or(c.equal(7));
  const borderWeight = (c: AnyNode) => select(c.equal(5).or(isWater), ink.shoreLine, ink.roadLine);
  const sides = [vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1)].map(o => {
    const q = p.add(o.mul(width).mul(texel)).add(jitter);
    const dq = viewDepth(q);
    const cq = categoryAt(q);
    const border = flatCategory(cq).and(flatCategory(category)).and(cq.notEqual(category));
    areaEdge = max(areaEdge, border.select(borderWeight(cq), 0));
    // A tree card in front of this pixel must not draw an outline round itself on the ground.
    const keep = categoryAt(q).equal(3).or(categoryAt(q).equal(4)).and(dq.lessThan(depth.sub(0.5))).select(0, 1);
    normalEdge = max(normalEdge, float(1).sub(dot(normal, unpackRGBToNormal(normalT.sample(q).rgb))).mul(keep));
    return { dq, keep };
  });
  // Centre is sampled with the same jitter so the two sides stay symmetric about it.
  const centre = viewDepth(p.add(jitter));
  // …and if that jittered centre lands on a snowflake or tree card, it is not an edge of the ground.
  const centreCat = categoryAt(p.add(jitter));
  const centreKeep = centreCat.equal(3).or(centreCat.equal(4)).select(0, 1);
  // Perspective depth along a plane is hyperbolic in screen space; its inverse is linear.
  const linear = (z: AnyNode) => orthographic ? z : float(1).div(z);
  for (const [a, b] of [[0, 1], [2, 3]]) {
    const curvature = linear(sides[a].dq).add(linear(sides[b].dq)).sub(linear(centre).mul(2)).abs()
      .div(orthographic ? reference : linear(centre));
    // A silhouette is a one-sided jump, which also shows up as large curvature.
    depthEdge = max(depthEdge, curvature.mul(0.5).mul(sides[a].keep).mul(sides[b].keep).mul(centreKeep));
  }
  const leveled = leveledRaw.mul(float(1).sub(plantFar.mul(detail).mul(0.4)));
  const solidEdge = max(
    smoothstep(ink.depthThreshold, ink.depthThreshold.mul(2), depthEdge.div(float(1).add(detail.mul(1.6).mul(float(1).sub(plinthNear))))),
    smoothstep(ink.normalThreshold, ink.normalThreshold.mul(1.6), normalEdge).mul(float(1).sub(detail.mul(0.6).mul(float(1).sub(plinthNear)))),
  ).mul(category.equal(3).or(category.equal(4)).select(0, 1));
  const flatEdge = areaEdge.mul(float(1).sub(detail.mul(0.5)));
  // 飞白: gaps come in dry patches along a stroke, not as scattered single pixels.
  const breakChance = mix(ink.freeBreak, ink.archBreak, ruled);
  const dryNoise = mx_noise_float(vec3(grain.xy.mul(48), 0.5)).mul(0.5).add(0.5);
  // Smooth world noise only: a per-pixel hash would re-roll every frame as the view moves and flicker.
  const dryFine = mx_noise_float(vec3(grain.yx.mul(17), 2.3)).mul(0.5).add(0.5);
  const dry = smoothstep(breakChance.sub(0.12), breakChance.add(0.12), mix(dryFine, dryNoise, ink.dryBrush));
  // Road and shore lines are long continuous strokes: only a little dry brush on them.
  // No outline round the far edge of the snow disc (it meets the hills in mist), and none drawn on the sky.
  const farGround = category.equal(2).select(smoothstep(5500, 7800, depth), 0);
  const lines = max(solidEdge.mul(dry), flatEdge.mul(mix(float(1), dry, 0.35))).mul(ink.linesOn)
    .mul(geometry).mul(float(1).sub(farGround)).mul(plinthKeep);

  // ③ Bleed at half resolution, sampled with a world-anchored jitter.
  const blur = gaussianBlur(leveled, vec2(ink.bleedRadius.div(3)), 3, { resolutionScale: 0.5 });
  const bled = blur.getTextureNode().sample(p.add(grain.yx.sub(0.5).mul(3).mul(texel))).x;
  const spread = clamp(max(leveled, bled.mul(ink.bleedStrength)).add(leveled.sub(bled).mul(ink.edgeDarken)), 0, 1);
  const wet = mix(leveled, spread, ink.bleedOn);

  // ④ Distance fade and low mist, on geometry only.
  const fadeStart = orthographic ? ink.scrollFadeStart : inkFocus.mul(ink.fadeNear);
  const fadeEnd = orthographic ? ink.scrollFadeEnd : inkFocus.mul(ink.fadeFar);
  const fade = smoothstep(fadeStart, fadeEnd, depth).mul(ink.fadeStrength).mul(ink.fadeOn).mul(geometry);
  // Low fog and mist lie on the city, not on the plinth's cut side below it.
  const onCity = category.equal(8).select(0, 1);
  const fog = float(1).sub(smoothstep(0, ink.fogHeight, grain.z)).mul(ink.fogStrength).mul(ink.fadeOn).mul(geometry).mul(onCity);
  // 云气: drifting mist leaves parts of the city as blank paper (lines included).
  // Zoomed out, the mist thins so the whole-city view stays legible instead of washing grey.
  const mistFar = orthographic ? float(0) : smoothstep(ink.emphasisNear, ink.emphasisFar, inkFocus);
  const mist = grain.w.mul(ink.mistStrength).mul(geometry).mul(ink.fadeOn).mul(onCity).mul(float(1).sub(mistFar.mul(0.65)));
  const faded = wet.mul(float(1).sub(fade)).mul(float(1).sub(fog)).mul(float(1).sub(mist));
  // 主次 (map hierarchy): zoomed out, the palace, the imperial city, the central axis and the
  // Temple of Heaven keep their full ink while the rest of the city pales, so the old plan reads
  // first. The zones are drawing choices in the map frame (rough outlines), not survey data.
  const zone = (x0: number, x1: number, z0: number, z1: number, f: number) =>
    smoothstep(x0 - f, x0 + f, world.x).mul(smoothstep(x1 + f, x1 - f, world.x))
      .mul(smoothstep(z0 - f, z0 + f, world.z)).mul(smoothstep(z1 + f, z1 - f, world.z));
  const palaceZone = zone(-400, 400, -1540, -270, 110);
  const keyZone = max(max(palaceZone, zone(-1350, 1050, -2700, 100, 220).mul(0.7)),
    max(zone(-110, 110, -3850, 4100, 90).mul(0.85), zone(400, 2000, 2300, 4000, 160).mul(0.55)));
  const overview = orthographic ? float(0) : smoothstep(ink.emphasisNear, ink.emphasisFar, inkFocus).mul(ink.emphasis).mul(geometry);
  const outside = float(1).sub(keyZone).mul(overview).mul(category.equal(8).select(0, 1));
  const pale = float(1).sub(outside.mul(0.28));
  const bold = float(1).add(keyZone.mul(overview).mul(0.35));
  const strokes = lines.mul(float(1).sub(fade.mul(ink.lineFade))).mul(float(1).sub(mist.mul(0.85)));
  // Reapply the cloud replacement after bleed / distance fade: neither may resurrect the
  // hidden bottom silhouette or leave a pale seam in the shared cloud-plane field.
  const paintedAmount = clamp(max(faded.mul(pale).mul(bold), strokes.mul(pale).mul(bold)), 0, 1);
  const blended = mix(skyAmount.mul(ink.tonesOn), paintedAmount, plinthKeep);
  // 墨分五色: an S-curve on the city's ink. Snow, roads and pale washes go back to paper; doors,
  // eaves, groves and strokes go deep, so the picture has true whites and blacks, not one grey.
  const curved = smoothstep(0.02, 0.65, blended);
  let amount: AnyNode = mix(blended, curved, ink.contrast.mul(geometry).mul(plinthKeep));
  // 留白: towards the frame edges the city (not the sky) gives way to paper along a soft, uneven
  // line, stronger zoomed out, so the middle of the view carries the picture.
  const frameEdge = length(screenUV.sub(0.5).mul(vec2(1.25, 1)))
    .add(mx_fractal_noise_float(vec3(screenUV.mul(3), 4.4), 2, 2, 0.5).mul(0.08));
  const veilZoom = orthographic ? float(0.5) : mix(0.6, 1, smoothstep(ink.emphasisNear, ink.emphasisFar, inkFocus));
  const veil = smoothstep(0.5, 0.85, frameEdge).mul(ink.edgeVeil).mul(veilZoom).mul(geometry);
  amount = amount.mul(float(1).sub(veil.mul(0.7)));

  // ⑥ Cinnabar only shows where the ink is light.
  const paper = color(palette.paper), inkColor = color(palette.ink), cinnabar = color(palette.cinnabar);
  // Water washes in 花青 (indigo) rather than plain ink; lines on it stay ink.
  const indigo = color(palette.indigo);
  const washColor = mix(inkColor, indigo, isWater.select(ink.waterTint, 0).mul(float(1).sub(lines)));
  // The selection marker is a strong cinnabar stroke (its weight in tone.y breathes); other washes are pale.
  const wash = select(isMarker, tone.y,
    tone.y.max(0).mul(plinthKeep).mul(ink.cinnabarStrength).mul(ink.cinnabarOn).mul(float(1).sub(fade))
      .mul(float(1).add(palaceZone.mul(overview).mul(0.8)))
      // …and the palace ground takes a faint warm wash, as if the red city were tinted on the plan.
      .add(palaceZone.mul(overview).mul(ink.emphasisWash).mul(float(1).sub(amount))));
  // Colour goes down first as a wash on the paper, ink on top of it (淡彩 under 墨): red walls stay
  // red in their shaded faces instead of fading to pink where the ink is light.
  // 琉璃黄 (negative tone.y on palace roofs): a warm wash under the ink, lighter ink over it.
  const glaze = clamp(tone.y.negate(), 0, 1).mul(ink.glaze).mul(ink.cinnabarOn).mul(plinthKeep)
    .mul(float(1).sub(fade)).mul(float(1).sub(veil)).mul(isMarker.select(0, 1));
  const tinted = mix(mix(paper, cinnabar, clamp(wash, 0, 1)), color(palette.glaze), glaze);
  // 冷暖: distance takes a 花青 cast — the sky, hills and cloud sea fully, the far city partly —
  // while the near city keeps the warm ink, cinnabar and yellow.
  const cool = max(background.max(float(1).sub(plinthKeep)), fade.mul(0.6)).mul(ink.coolTint);
  const inkTone = mix(washColor, mix(inkColor, indigo, 0.8), cool);
  let result: AnyNode = select(isMarker, mix(mix(paper, washColor, amount), cinnabar, wash),
    mix(tinted, inkTone, amount.mul(float(1).sub(wash.mul(0.45)).sub(glaze.mul(0.35)))));

  // ⑦ Paper: screen-space (the paper is the canvas), low undulation + fibres + grain, then a soft vignette.
  const pixel = screenUV.div(texel);
  const undulation = mx_fractal_noise_float(vec3(screenUV.mul(vec2(texel.y.div(texel.x), 1)).mul(2.5), 0.3), 3, 2, 0.5);
  // Fibres are sparse short strands, not a continuous brushed pattern.
  const strand = mx_noise_float(vec3(pixel.x.mul(0.035), pixel.y.mul(0.16), 1.7));
  const fibre = smoothstep(0.45, 0.75, strand.abs()).mul(strand.sign());
  const speck = mx_noise_float(vec3(pixel.mul(0.8), 3.1));
  const paperTexture = undulation.mul(0.6).add(fibre.mul(0.25)).add(speck.mul(0.2));
  result = result.mul(float(1).add(paperTexture.mul(ink.paperStrength).mul(ink.paperOn)));
  const corner = length(screenUV.sub(0.5).mul(vec2(1.2, 1)));
  result = result.mul(float(1).sub(smoothstep(0.45, 0.95, corner).mul(ink.vignette).mul(ink.paperOn)));

  // Night: an indigo-grey wash over the whole painting. Moonlit snow (little ink) stays pale while
  // inked parts sink deeper, so the night has more contrast than a flat grey filter.
  const snowNight = mix(vec3(1), vec3(0.6, 0.65, 0.76), ink.nightDepth);
  const inkNight = mix(vec3(1), vec3(0.17, 0.2, 0.29), ink.nightDepth);
  const nightTint = mix(snowNight, inkNight, smoothstep(0.04, 0.45, amount));
  result = mix(result, result.mul(nightTint), ink.night);
  if (!orthographic) {
    const angle = dirW.dot(backdrop.moonDir).clamp(-1, 1).acos();
    // Night sky deepens as before; cloud-plane pixels (including the hidden plinth) share it.
    const cloudFoot = geometry.mul(float(1).sub(plinthKeep));
    result = mix(result, result.mul(0.82), background.max(cloudFoot).mul(ink.night));
    result = mix(result, paper.rgb.mul(snowNight).mul(1.03), backdrop.moonlight.mul(0.16)
      .mul(background.max(cloudFoot)).mul(backdrop.moonOn));
    const disc = smoothstep(0.024, 0.02, angle).mul(background);
    const glowRing = smoothstep(0.28, 0.03, angle).pow(2).mul(0.35).mul(background)
      .mul(float(1).sub(backdrop.cloud.mul(0.6)));
    result = mix(result, mix(result, paper.mul(1.04), glowRing), ink.night.mul(backdrop.moonOn));
    result = mix(result, paper.mul(1.06), disc.mul(ink.night)
      .mul(float(1).sub(backdrop.cloud.mul(0.5))).mul(backdrop.moonOn));
  }
  // 天色: a warm 霞 band just above the horizon, and in clear weather a pale sun with a broad
  // warm glow on its side of the sky (decorative). Sky pixels only.
  if (!orthographic) {
    const above = backdrop.el.sub(backdrop.horizon);
    const band = smoothstep(-0.02, 0.03, above).mul(float(1).sub(smoothstep(0.08, 0.55, above)));
    const sunSide = backdrop.az.sub(backdrop.sunAz).cos().mul(0.5).add(0.5);
    const warmColor = vec3(0.86, 0.62, 0.42);
    const warm = band.mul(mix(0.5, 1, sunSide)).mul(ink.skyWarm).mul(float(1).sub(ink.night)).mul(background).mul(0.6);
    result = mix(result, result.mul(mix(vec3(1), warmColor.mul(1.12), 0.7)), warm);
    const sunAngle = dirW.dot(backdrop.sunDir).clamp(-1, 1).acos();
    const sunGlow = smoothstep(0.5, 0.02, sunAngle).pow(2).mul(0.5).mul(background);
    const sunDisc = smoothstep(0.04, 0.034, sunAngle).mul(background).mul(float(1).sub(backdrop.cloud.mul(0.6)));
    const sunOn = ink.sun.mul(float(1).sub(ink.night)).mul(backdrop.moonOn);
    result = mix(result, mix(result, vec3(1.0, 0.93, 0.82), sunGlow), sunOn);
    result = mix(result, vec3(0.98, 0.86, 0.7), sunDisc.mul(sunOn).mul(0.85));
  }
  // 窗光: lit windows (carried as negative values in tone.z by the wall materials).
  const windows = clamp(tone.z.negate(), 0, 1).mul(geometry).mul(plinthKeep).mul(float(1).sub(fade)).mul(float(1).sub(mist.mul(0.7)));
  result = result.add(vec3(1, 0.66, 0.36).mul(windows).mul(ink.night).mul(0.75));

  // Snowfall: a coverage pass (white on black) laid over the painting as paper.
  let overlayView: AnyNode = vec3(0), smokeView: AnyNode = vec3(0);
  if (overlay) {
    const snowPass = pass(overlay, camera);
    const overlayColor = snowPass.getTextureNode('output');
    overlayView = overlayColor.rgb;
    // Overlay channels: snow = grey (r = g = b), mark = extra green, lantern glow = extra blue,
    // chimney smoke = extra red. Coverage is what all three share.
    const cover = clamp(overlayColor.r.min(overlayColor.g).min(overlayColor.b), 0, 1);
    result = mix(result, paper.mul(1.03), cover);
    // Green beyond the snow's grey = the cinnabar selection mark.
    const mark = clamp(overlayColor.g.sub(cover), 0, 1);
    result = mix(result, cinnabar.mul(0.95), mark.mul(0.9));
    // Blue beyond the snow's grey = lantern glow: warm light added at night.
    const glow = clamp(overlayColor.b.sub(cover), 0, 1);
    result = result.add(vec3(1, 0.62, 0.38).mul(glow).mul(ink.night).mul(1.15));
    // 炊烟: pale ink wisps, hidden behind nearer geometry (overlay depth vs scene depth) and
    // given up when zoomed out, where a wisp would be a flickering pixel.
    const overlayDepth = orthographic ? float(0) : perspectiveDepthToViewZ(snowPass.getTextureNode('depth').sample(p).x, near, far).negate();
    const smokeShown = step(overlayDepth, depth.add(1)).mul(float(1).sub(smoothstep(2200, 4200, inkFocus)));
    const smokeAmount = clamp(overlayColor.r.sub(cover), 0, 1).mul(smokeShown);
    smokeView = vec3(smokeAmount, clamp(overlayDepth.div(1000), 0, 1), clamp(depth.div(1000), 0, 1));
    result = mix(result, mix(paper, inkTone, 0.5).mul(mix(vec3(1), snowNight, ink.night)), clamp(smokeAmount, 0, 1).mul(0.9));
  }

  // SPEC 7.5 channel views.
  const depthView = orthographic ? depth.sub(1300).div(900) : depth.div(1000);
  const views: AnyNode[] = [
    result,
    colorT.rgb,
    normalT.sample(p).rgb,
    vec3(clamp(depthView, 0, 1)),
    vec3(category.div(6)),
    vec3(float(1).sub(amount)),
    vec3(float(1).sub(lines)),
    vec3(tone.z.abs()),
    vec3(tone.y),
    vec3(backdrop.amount),
    vec3(plinthKeep),
    vec3(backdrop.moonlight),
    vec3(backdrop.cloud),
    overlayView,
    smokeView,
  ];
  const shown = views.slice(1).reduce<AnyNode>((acc, view, i) => select(inkView.equal(i + 1), view, acc), views[0]);
  const pipeline = new RenderPipeline(renderer, vec4(shown, 1));

  return {
    pipeline,
    render() {
      // The map camera moves its near plane with the viewing distance; keep depth decoding in step.
      near.value = camera.near; far.value = camera.far;
      projInv.value.copy(camera.projectionMatrixInverse);
      camWorld.value.copy(camera.matrixWorld);
      camHeight.value = Math.max(1, camera.position.y);
      camPos.value.copy(camera.position);
      pipeline.render();
    },
    resize() {
      renderer.getDrawingBufferSize(size);
      texel.value.set(1 / size.x, 1 / size.y);
      updatePixelAngle();
    },
    dispose() { pipeline.dispose(); scenePass.dispose(); blur.dispose(); },
  };
}

export type InkPipeline = ReturnType<typeof createInkPipeline>;
