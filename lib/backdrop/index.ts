/**
 * Backdrop - the ASCII field behind every surface.
 *
 * The one door in. A surface calls `mountBackdrop` with a container and gets a
 * handle back; nothing else here needs importing directly.
 */
import { AsciiField } from './field';
import { resolveBackdrop, clampConfig, type BackdropSettings } from './presets';

export type { BackdropConfig, BackdropSettings, BackdropPreset, CharacterRamp } from './presets';
export {
  PRESETS,
  RAMPS,
  LIMITS,
  DEFAULT_BACKDROP,
  DEFAULT_PRESET_ID,
  getPreset,
  configOf,
  resolveRamp,
  normalizeRamp,
  isValidRamp,
  CUSTOM_RAMP_ID,
  DEFAULT_CUSTOM_RAMP,
  RAMP_LIMITS,
  resolveBackdrop,
  clampConfig,
} from './presets';
export { listMasks, registerMask, getMask, hasMask } from './masks';
export type { MaskSource, MaskDefinition } from './masks';
export { AsciiField } from './field';

/** What a surface holds onto after mounting. */
export interface BackdropHandle {
  /** Swap settings, cheap enough for an `input` event. */
  update(settings: BackdropSettings | undefined): void;
  /** Re-read palette colours after a theme change. */
  refreshTheme(): void;
  /** Brighten briefly - recall fired, a scrape landed. */
  pulse(): void;
  /** Hold denser while tokens arrive. */
  setStreaming(streaming: boolean): void;
  /** Reset the idle timer. */
  markActive(): void;
  /** Stop and detach. */
  destroy(): void;
}

/** A handle that does nothing, so callers never have to null-check. */
const NOOP_HANDLE: BackdropHandle = {
  update() {},
  refreshTheme() {},
  pulse() {},
  setStreaming() {},
  markActive() {},
  destroy() {},
};

/**
 * Create the canvas, start the field, and hand back the controls.
 *
 * The canvas is created here rather than sitting in each surface's HTML, so
 * every page gets identical markup and a page that never mounts a backdrop
 * carries no dead element.
 *
 * @param container  the `.ac-backdrop__layer` element to draw inside
 */
export function mountBackdrop(
  container: HTMLElement | null,
  settings: BackdropSettings | undefined,
): BackdropHandle {
  if (!container) return NOOP_HANDLE;

  const canvas = document.createElement('canvas');
  canvas.className = 'ac-backdrop__field';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  let field: AsciiField;
  try {
    field = new AsciiField({ canvas, config: clampConfig(resolveBackdrop(settings)) });
  } catch (error) {
    // A canvas context can genuinely be refused under memory pressure.
    console.warn('[backdrop] disabled:', error);
    canvas.remove();
    return NOOP_HANDLE;
  }

  field.mount();

  return {
    update(next) {
      field.setConfig(clampConfig(resolveBackdrop(next)));
    },
    refreshTheme() {
      field.refreshTheme();
    },
    pulse() {
      field.firePulse();
    },
    setStreaming(streaming) {
      field.setStreaming(streaming);
    },
    markActive() {
      field.markActive();
    },
    destroy() {
      field.destroy();
      canvas.remove();
    },
  };
}
