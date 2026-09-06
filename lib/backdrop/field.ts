/**
 * The ASCII field renderer.
 *
 * Walks a grid of cells, asks the mask how bright each one is, and draws a
 * character picked from a ramp by that brightness. That is the entire effect -
 * everything else in this file is about not burning a laptop battery to do it.
 *
 * Replaces the ghost-square overlay, which spawned DOM nodes on a bare
 * `setInterval` with no teardown and no visibility check.
 *
 * ── Four rules a background in a sidepanel has to follow ──────────
 *   1. Stop when the document is hidden. A panel behind another tab still
 *      runs `requestAnimationFrame` otherwise.
 *   2. Cap the frame rate. This look reads better at 14fps than at 60, and
 *      costs a quarter as much.
 *   3. Honour `prefers-reduced-motion` - one static frame, then stop.
 *   4. Downshift when idle. The common case is a panel left open and visible
 *      for twenty minutes while somebody reads the page behind it.
 *
 * Colours come from the theme rather than being carried here, so the field
 * follows a palette change with no work: brightness is applied with
 * `globalAlpha` over two solid token colours.
 */
import { getMask } from './masks';
import { resolveRamp, type BackdropConfig } from './presets';

/** Row height as a multiple of cell width. Monospace cells are taller than wide. */
const ROW_RATIO = 1.18;

/** Below this brightness a cell is skipped entirely. */
const FLOOR = 0.08;

/** Idle for this long and the frame rate drops. */
const IDLE_AFTER_MS = 20_000;

/** Frames per second once idle. Still moving, barely. */
const IDLE_FPS = 4;

/** How fast a recall pulse decays, per drawn frame. */
const PULSE_DECAY = 0.012;

/** Extra brightness at full pulse, and while streaming. */
const PULSE_LIFT = 0.35;
const STREAM_LIFT = 0.14;

/** Retina beyond 2x costs more than it shows for text this small. */
const MAX_DPR = 2;

export interface FieldOptions {
  /** Canvas to draw into. Sized to its own client box. */
  canvas: HTMLCanvasElement;
  config: BackdropConfig;
}

export class AsciiField {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  private config: BackdropConfig;

  private width = 0;
  private height = 0;
  private columns = 0;
  private rows = 0;

  private frameHandle: number | null = null;
  private lastDrawAt = 0;
  private lastActivityAt = 0;
  private pulse = 0;
  private streaming = false;

  /**
   * Solid colours read out of the active theme, refreshed on theme change.
   *
   * These literals are only reached if `getComputedStyle` returns nothing for
   * the tokens, which means the stylesheet has not applied yet. They match the
   * light palette so a field that draws one frame early does not flash a
   * colour from nowhere.
   */
  private glyphColor = '#a1a1aa';
  private accentColor = '#ff5500';

  private readonly reducedMotion: MediaQueryList;
  private readonly observer: ResizeObserver;

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private readonly onMotionPreferenceChange = () => this.restart();

  constructor({ canvas, config }: FieldOptions) {
    this.canvas = canvas;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('[backdrop] 2d canvas context unavailable');
    this.context = context;

    this.config = config;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    // The canvas is sized from its own box rather than the window.
    this.observer = new ResizeObserver(() => this.measure());

    this.lastActivityAt = performance.now();
  }

  /** Begin drawing, and keep the canvas sized to its container. */
  mount(): void {
    this.readThemeColors();
    this.measure();

    this.observer.observe(this.canvas);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.reducedMotion.addEventListener('change', this.onMotionPreferenceChange);

    this.restart();
  }

  /** Stop everything and detach every listener. */
  destroy(): void {
    this.stop();
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.reducedMotion.removeEventListener('change', this.onMotionPreferenceChange);
    this.context.clearRect(0, 0, this.width, this.height);
  }

  /**
   * Swap the configuration. Cheap enough to call from an `input` event, which
   * is what makes the editor's live preview work.
   */
  setConfig(config: BackdropConfig): void {
    const cellChanged = config.cell !== this.config.cell;
    this.config = config;

    if (cellChanged) this.measure();
    this.markActive();
    this.restart();
  }

  /** Re-read the palette. Call after the theme changes. */
  refreshTheme(): void {
    this.readThemeColors();
    if (this.isStatic()) this.drawFrame(performance.now());
  }

  /**
   * Brighten and quicken briefly. Fired when memory recall happens, so the
   * background reports something rather than only decorating.
   */
  firePulse(): void {
    this.pulse = 1;
    this.markActive();
    this.restart();
  }

  /** Hold the field denser for as long as tokens are arriving. */
  setStreaming(streaming: boolean): void {
    if (this.streaming === streaming) return;
    this.streaming = streaming;
    this.markActive();
    this.restart();
  }

  /** Reset the idle timer. Any real interaction should call this. */
  markActive(): void {
    this.lastActivityAt = performance.now();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Nothing to animate: motion is off, or the preset draws nothing. */
  private isStatic(): boolean {
    return this.reducedMotion.matches || this.config.intensity <= 0 || this.config.speed <= 0;
  }

  private restart(): void {
    this.stop();

    if (this.config.intensity <= 0) {
      this.context.clearRect(0, 0, this.width, this.height);
      return;
    }

    if (this.isStatic()) {
      this.drawFrame(performance.now());
      return;
    }

    if (document.hidden) return;
    this.start();
  }

  private start(): void {
    if (this.frameHandle !== null || this.isStatic() || this.config.intensity <= 0) return;
    this.lastDrawAt = 0;
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.frameHandle === null) return;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private readonly tick = (now: number): void => {
    this.frameHandle = requestAnimationFrame(this.tick);

    // Rule 4.
    const idle = !this.streaming && now - this.lastActivityAt > IDLE_AFTER_MS;
    const targetFps = idle ? Math.min(IDLE_FPS, this.config.fps) : this.config.fps;

    // Rule 2.
    if (now - this.lastDrawAt < 1000 / targetFps) return;
    this.lastDrawAt = now;

    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - PULSE_DECAY);
    }

    this.drawFrame(now);
  };

  private measure(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const bounds = this.canvas.getBoundingClientRect();

    this.width = bounds.width;
    this.height = bounds.height;

    if (this.width === 0 || this.height === 0) return;

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.columns = Math.ceil(this.width / this.config.cell) + 1;
    this.rows = Math.ceil(this.height / (this.config.cell * ROW_RATIO)) + 1;

    if (this.isStatic()) this.drawFrame(performance.now());
  }

  /**
   * Read the two colours the field draws with straight off the document, so a
   * theme change or a user override lands here with no plumbing.
   */
  private readThemeColors(): void {
    const styles = getComputedStyle(document.documentElement);
    const glyph = styles.getPropertyValue('--ac-color-text-subtle').trim();
    const accent = styles.getPropertyValue('--ac-color-accent').trim();

    if (glyph) this.glyphColor = glyph;
    if (accent) this.accentColor = accent;
  }

  private drawFrame(now: number): void {
    if (this.width === 0 || this.height === 0) return;

    const { cell, intensity, accentAt, speed } = this.config;
    const mask = getMask(this.config.mask);
    const ramp = resolveRamp(this.config.ramp, this.config.customRamp);
    const topIndex = ramp.length - 1;

    const rowHeight = cell * ROW_RATIO;
    const time = (now / 1000) * speed;

    // Both lifts raise the whole field rather than any one cell.
    const lift = this.pulse * PULSE_LIFT + (this.streaming ? STREAM_LIFT : 0);
    const ceiling = Math.min(1, intensity + this.pulse * 0.3);

    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    context.font = `${cell - 1}px ${getComputedStyle(document.documentElement).getPropertyValue(
      '--ac-font-mono',
    )}`;
    context.textBaseline = 'top';

    // Alpha carries brightness so the two fill colours can stay solid token values.
    let currentColor = '';

    for (let row = 0; row < this.rows; row++) {
      const y = row * rowHeight;

      for (let column = 0; column < this.columns; column++) {
        let brightness = mask(column, row, time, this.columns, this.rows) + lift;
        if (brightness < FLOOR) continue;
        if (brightness > 1) brightness = 1;

        const character = ramp[Math.round(brightness * topIndex)];
        if (character === undefined || character === ' ') continue;

        const color = brightness >= accentAt ? this.accentColor : this.glyphColor;
        if (color !== currentColor) {
          context.fillStyle = color;
          currentColor = color;
        }

        context.globalAlpha = brightness * ceiling;
        context.fillText(character, column * cell, y);
      }
    }

    context.globalAlpha = 1;
  }
}
