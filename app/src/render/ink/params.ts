import { select, time, uniform } from 'three/tsl';
import { INK_DEFAULTS, type InkKey, type InkParams } from '../../config/ink-defaults';

type FloatUniform = ReturnType<typeof makeUniform>;
const makeUniform = (value: number) => uniform(value);

/** One uniform per parameter, shared by the scene materials and both ink pipelines. */
export const ink = Object.fromEntries(
  Object.entries(INK_DEFAULTS).map(([key, value]) => [key, makeUniform(value)]),
) as Record<InkKey, FloatUniform>;

/** Camera distance to the map target, updated every frame (drives ④). */
export const inkFocus = uniform(1000);

/** Debug channel view index (0 = final). */
export const inkView = uniform(0);

/** Decorative surroundings only: -1 = animate, >= 0 = fixed seconds (?shot / ?time). */
export const decorationClock = uniform(-1);
export const decorationTime = select(decorationClock.greaterThanEqual(0), decorationClock, time);

export function readInk(): InkParams {
  return Object.fromEntries(Object.keys(INK_DEFAULTS).map(key => [key, ink[key as InkKey].value])) as InkParams;
}

/** Apply a (possibly partial) preset; unknown keys are ignored. Returns the keys applied. */
export function applyInk(values: Partial<Record<string, unknown>>) {
  const applied: InkKey[] = [];
  // Migrate imported table-era presets; an explicit stageMode always wins.
  if (!('stageMode' in values) && typeof values.sandbox === 'number' && Number.isFinite(values.sandbox)) {
    ink.stageMode.value = values.sandbox >= 0.5 ? 1 : 0;
    applied.push('stageMode');
  }
  for (const [key, value] of Object.entries(values)) {
    if (key in INK_DEFAULTS && typeof value === 'number' && Number.isFinite(value)) {
      ink[key as InkKey].value = value;
      applied.push(key as InkKey);
    }
  }
  return applied;
}
