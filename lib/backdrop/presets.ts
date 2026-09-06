/**
 * Character ramps and backdrop presets.
 *
 * A preset is the tuned bundle: which mask, which characters, how big, how
 * bright, how fast. All plain numbers and strings, so a preset is data - it
 * serialises, it can be stored, and eventually a user can author one.
 *
 * Defaults here are the tuned ones. Most people will never open the editor, so
 * the shipped values have to be the good values rather than the middle of every
 * slider's range.
 */

export interface CharacterRamp {
  id: string;
  label: string;
  /** Darkest to brightest. A leading space means "draw nothing here". */
  characters: string;
}

/**
 * Ramps run dark to light. The leading space is load-bearing: it is what keeps
 * the field sparse instead of covering every cell.
 */
export const RAMPS: CharacterRamp[] = [
  { id: 'classic', label: 'Classic', characters: ' .`,:;~+=ilxzXY*S%#&@' },
  { id: 'light', label: 'Light', characters: ' .:-=+*#%@' },
  { id: 'blocks', label: 'Blocks', characters: '  ░▒▓█' },
  { id: 'dots', label: 'Dots', characters: ' ·∶⁘⁙⁛∷' },
  { id: 'binary', label: 'Binary', characters: '   ..::0011' },
  { id: 'terminal', label: 'Terminal', characters: ' .·--=≡▤▦▩' },
];

const RAMPS_BY_ID = new Map(RAMPS.map((ramp) => [ramp.id, ramp]));

/** Selecting this uses `BackdropConfig.customRamp` instead of a built-in. */
export const CUSTOM_RAMP_ID = 'custom';

/** Seeded into the field the first time somebody picks Custom. */
export const DEFAULT_CUSTOM_RAMP = ' .:-=+*#%@';

export const RAMP_LIMITS = {
  /** Two is the minimum that can express dark and light. */
  min: 2,
  /** Past this the ramp is finer than the eye can read, and the input unwieldy. */
  max: 64,
} as const;

/**
 * Clean up typed ramp characters.
 *
 * Spaces are kept: a leading space is how a ramp says "draw nothing here", and
 * it is the whole reason the field looks sparse rather than a solid block.
 * Line breaks and tabs are dropped, because they measure as whitespace on the
 * canvas and would silently punch holes in the field.
 */
export function normalizeRamp(characters: string): string {
  return [...characters.replace(/[\n\r\t]/g, '')].slice(0, RAMP_LIMITS.max).join('');
}

/** Whether typed characters can actually be used as a ramp. */
export function isValidRamp(characters: string): boolean {
  return [...normalizeRamp(characters)].length >= RAMP_LIMITS.min;
}

/**
 * The ramp to draw with, darkest first, as an array of whole characters.
 *
 * An array rather than a string because the renderer indexes into this, and
 * `charAt` on a string splits anything outside the basic plane in half - type
 * an emoji into the custom ramp and you would get half a surrogate pair, which
 * renders as a replacement box.
 *
 * Falls back to the first built-in for an unknown id or an unusable custom
 * value, so a stored preset naming a ramp a later build removed still draws.
 */
export function resolveRamp(id: string, custom?: string): string[] {
  if (id === CUSTOM_RAMP_ID) {
    const cleaned = normalizeRamp(custom ?? '');
    if (isValidRamp(cleaned)) return [...cleaned];
    return [...RAMPS[0]!.characters];
  }

  return [...(RAMPS_BY_ID.get(id) ?? RAMPS[0]!).characters];
}

/**
 * Everything the renderer needs, and nothing it does not.
 */
export interface BackdropConfig {
  /** Mask id from `lib/backdrop/masks.ts`. */
  mask: string;
  /** Ramp id from `RAMPS`, or `custom` to use `customRamp`. */
  ramp: string;
  /**
   * Characters for the custom ramp, darkest first. Only read when `ramp` is
   * `custom`, and kept even when it is not, so switching to a built-in and
   * back does not lose what somebody typed.
   */
  customRamp?: string;
  /** Cell width in CSS pixels. Row height is derived from it. */
  cell: number;
  /**
   * Opacity of the brightest character, 0 to 1. The single knob most worth
   * exposing, because it is the one that cannot produce a bad result.
   */
  intensity: number;
  /**
   * Brightness above which a character is drawn in the accent colour instead of
   * the muted one. At 1.01 nothing ever is.
   */
  accentAt: number;
  /** Frame cap. A battery control as much as an aesthetic one. */
  fps: number;
  /** Time multiplier. 1 is the tuned rate for each mask. */
  speed: number;
}

export interface BackdropPreset extends BackdropConfig {
  id: string;
  label: string;
  description: string;
}

/**
 * `off` is first because it has to be reachable without reading the list. Some
 * people will not want an animated background at all, and burying that behind
 * five decorative options is a way of not offering it.
 */
export const PRESETS: BackdropPreset[] = [
  {
    id: 'off',
    label: 'Off',
    description: 'Grid only. Nothing animates, nothing runs.',
    mask: 'flow',
    ramp: 'light',
    cell: 12,
    intensity: 0,
    accentAt: 1.01,
    fps: 1,
    speed: 0,
  },
  {
    id: 'flow',
    label: 'Flow',
    description: 'Warped waves, low and slow. The shipped default.',
    mask: 'flow',
    ramp: 'classic',
    cell: 11,
    intensity: 0.3,
    accentAt: 0.9,
    fps: 14,
    speed: 1,
  },
  {
    id: 'plasma',
    label: 'Plasma',
    description: 'Denser and more active, with more accent showing through.',
    mask: 'plasma',
    ramp: 'classic',
    cell: 10,
    intensity: 0.34,
    accentAt: 0.86,
    fps: 16,
    speed: 0.9,
  },
  {
    id: 'ripple',
    label: 'Ripple',
    description: 'Rings from one point. Reads as a source rather than a texture.',
    mask: 'ripple',
    ramp: 'dots',
    cell: 12,
    intensity: 0.38,
    accentAt: 0.92,
    fps: 18,
    speed: 1.1,
  },
  {
    id: 'drift',
    label: 'Drift',
    description: 'Slow diagonals. The quietest thing that still moves.',
    mask: 'drift',
    ramp: 'terminal',
    cell: 13,
    intensity: 0.26,
    accentAt: 1.01,
    fps: 10,
    speed: 0.7,
  },
  {
    id: 'rain',
    label: 'Rain',
    description: 'Falling columns, tuned for a narrow panel.',
    mask: 'rain',
    ramp: 'binary',
    cell: 10,
    intensity: 0.42,
    accentAt: 0.95,
    fps: 20,
    speed: 1.4,
  },
];

const PRESETS_BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]));

export const DEFAULT_PRESET_ID = 'flow';

/** Look up a preset, falling back to the default rather than throwing. */
export function getPreset(id: string): BackdropPreset {
  return PRESETS_BY_ID.get(id) ?? PRESETS_BY_ID.get(DEFAULT_PRESET_ID)!;
}

/**
 * Strip a preset down to the values the renderer reads.
 */
export function configOf(preset: BackdropPreset): BackdropConfig {
  const { mask, ramp, cell, intensity, accentAt, fps, speed } = preset;
  return { mask, ramp, cell, intensity, accentAt, fps, speed };
}

/**
 * Settings as stored: a preset name plus whatever the user changed on top.
 *
 * Split this way so switching preset does not silently discard tuning, and so
 * a preset whose defaults change in a later build carries that improvement to
 * everyone who never touched the sliders.
 */
export interface BackdropSettings {
  preset: string;
  custom?: Partial<BackdropConfig>;
}

export const DEFAULT_BACKDROP: BackdropSettings = { preset: DEFAULT_PRESET_ID };

/** Resolve stored settings into what the renderer should actually use. */
export function resolveBackdrop(settings: BackdropSettings | undefined): BackdropConfig {
  const preset = getPreset(settings?.preset ?? DEFAULT_PRESET_ID);
  return { ...configOf(preset), ...(settings?.custom ?? {}) };
}

/** Bounds the editor enforces, and the renderer trusts. */
export const LIMITS = {
  cell: { min: 6, max: 24, step: 1 },
  intensity: { min: 0, max: 1, step: 0.01 },
  accentAt: { min: 0.5, max: 1.01, step: 0.01 },
  fps: { min: 2, max: 60, step: 1 },
  speed: { min: 0, max: 3, step: 0.05 },
} as const;

export function clampConfig(config: BackdropConfig): BackdropConfig {
  const clamp = (value: number, key: keyof typeof LIMITS) =>
    Math.min(LIMITS[key].max, Math.max(LIMITS[key].min, value));

  return {
    ...config,
    // Normalised here rather than only in the editor.
    ...(config.customRamp !== undefined ? { customRamp: normalizeRamp(config.customRamp) } : {}),
    cell: Math.round(clamp(config.cell, 'cell')),
    intensity: clamp(config.intensity, 'intensity'),
    accentAt: clamp(config.accentAt, 'accentAt'),
    fps: Math.round(clamp(config.fps, 'fps')),
    speed: clamp(config.speed, 'speed'),
  };
}
