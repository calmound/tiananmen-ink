import { INK_DEFAULTS } from '../../config/ink-defaults';
import { applyInk, readInk } from './params';

const files = import.meta.glob<{ default: Record<string, unknown> }>('../../ink/presets/*.json', { eager: true });

/** Built-in presets by file name (A-lines, B-tones, C-full, plus any saved later). */
export const PRESETS: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(files).map(([path, module]) => [path.split('/').pop()!.replace(/\.json$/, ''), module.default]),
);

/** A preset is applied on top of the defaults, so partial presets stay predictable. */
export function loadPreset(name: string) {
  const preset = PRESETS[name];
  if (!preset) return false;
  applyPresetObject(preset);
  return true;
}

export function applyPresetObject(values: Record<string, unknown>) {
  const migrated = !('stageMode' in values) && typeof values.sandbox === 'number' && Number.isFinite(values.sandbox)
    ? { ...values, stageMode: values.sandbox >= 0.5 ? 1 : 0 } : values;
  return applyInk({ ...INK_DEFAULTS, ...migrated });
}

export function exportPreset(name: string) {
  return JSON.stringify({ name, saved: new Date().toISOString(), ...readInk() }, null, 2);
}
