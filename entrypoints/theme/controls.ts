/**
 * Friendly controls for theme options.
 *
 * Every value here is ultimately a CSS string, and a text box that accepts any
 * CSS string is the most capable control and the least usable one. So each kind
 * of value gets a control shaped for it — a swatch, a slider, a set of choices
 * — and the text box stays available behind a toggle for the cases the friendly
 * control cannot reach.
 *
 * The rule this file follows: a friendly control may only ever produce values
 * it can also read back. If it cannot represent what is already set, it returns
 * null and the row falls back to text. Nothing here is allowed to quietly
 * flatten a value it did not understand — that is how somebody's carefully
 * typed `rgba(…)` turns into an opaque colour just because they opened a panel.
 */
import type { TokenDefinition } from '../../lib/theme/manifest.generated';

export interface ControlContext {
  token: TokenDefinition;
  /** The value in force right now. */
  value: string;
  /** What the palette says, used when a control needs a baseline. */
  fallback: string;
  /** Called continuously while dragging. Paints, does not save. */
  onPreview(value: string): void;
  /** Called when the gesture ends. Saves. */
  onCommit(value: string): void;
}

/* ────────────────────────────────────────────────────────────────
   Value parsing
   ──────────────────────────────────────────────────────────────── */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Read a colour into channels.
 *
 * Handles the forms the palettes actually use — 3, 6, and 8 digit hex, plus
 * `rgb()` and `rgba()` with comma or space separators. Returns null for
 * anything else, including `color-mix()` and named colours, so those keep the
 * text box rather than being approximated.
 */
export function parseColor(input: string): Rgba | null {
  const value = input.trim();

  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const digits = hex[1]!;

    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a] = [...digits].map((d) => parseInt(d + d, 16));
      return { r: r!, g: g!, b: b!, a: digits.length === 4 ? a! / 255 : 1 };
    }

    if (digits.length === 6 || digits.length === 8) {
      const pair = (index: number) => parseInt(digits.slice(index * 2, index * 2 + 2), 16);
      return {
        r: pair(0),
        g: pair(1),
        b: pair(2),
        a: digits.length === 8 ? pair(3) / 255 : 1,
      };
    }

    return null;
  }

  const functional = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!functional) return null;

  const parts = functional[1]!.split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 3) return null;

  const numbers = parts.map((part) =>
    part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part)
  );
  if (numbers.slice(0, 3).some(Number.isNaN)) return null;

  return {
    r: clamp(Math.round(numbers[0]!), 0, 255),
    g: clamp(Math.round(numbers[1]!), 0, 255),
    b: clamp(Math.round(numbers[2]!), 0, 255),
    a: numbers.length > 3 && !Number.isNaN(numbers[3]!) ? clamp(numbers[3]!, 0, 1) : 1,
  };
}

/** Fully opaque comes back as hex, because that is what people expect to see. */
export function formatColor({ r, g, b, a }: Rgba): string {
  if (a >= 1) {
    const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    return `#${hex}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round(a, 3)})`;
}

export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

interface Measure {
  amount: number;
  unit: string;
}

/** `0.75rem` → `{ amount: 0.75, unit: 'rem' }`. Null for anything compound. */
export function parseMeasure(input: string): Measure | null {
  const match = input.trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
  if (!match) return null;

  const amount = parseFloat(match[1]!);
  if (Number.isNaN(amount)) return null;

  return { amount, unit: match[2] ?? '' };
}

/* ────────────────────────────────────────────────────────────────
   Slider ranges

   Keyed by token prefix rather than derived from the current value,
   so the same control has the same feel wherever it appears and the
   handle does not sit in a different place for every token.
   ──────────────────────────────────────────────────────────────── */

interface Range {
  min: number;
  max: number;
  step: number;
}

const RANGES: { match: RegExp; unit: string; range: Range }[] = [
  { match: /^--ac-space-/, unit: 'rem', range: { min: 0, max: 6, step: 0.0625 } },
  { match: /^--ac-radius-/, unit: 'rem', range: { min: 0, max: 2, step: 0.0625 } },
  { match: /^--ac-text-/, unit: 'rem', range: { min: 0.5, max: 3, step: 0.0625 } },
  { match: /^--ac-tracking-/, unit: 'em', range: { min: -0.1, max: 0.2, step: 0.005 } },
  { match: /^--ac-leading-/, unit: '', range: { min: 1, max: 2.5, step: 0.05 } },
  { match: /^--ac-weight-/, unit: '', range: { min: 100, max: 900, step: 100 } },
  { match: /^--ac-duration-/, unit: 'ms', range: { min: 0, max: 1000, step: 10 } },
  { match: /^--ac-grid-/, unit: 'px', range: { min: 8, max: 160, step: 1 } },
];

/**
 * Tokens whose value is a sentinel rather than a measurement.
 *
 * `--ac-radius-pill` is 9999px and `--ac-radius-circle` is 50%; both mean "as
 * round as possible". A slider spanning nine thousand pixels to express that
 * would be worse than the text box.
 */
const NOT_SLIDEABLE = /^--ac-radius-(pill|circle)$/;

/**
 * The slider range for a token, and the unit its output should carry.
 *
 * Returns null when no slider can honestly represent the value, which sends the
 * row to the text box instead.
 */
function rangeFor(name: string, unit: string, amount: number): (Range & { unit: string }) | null {
  if (NOT_SLIDEABLE.test(name)) return null;

  const entry = RANGES.find((candidate) => candidate.match.test(name));
  if (!entry) return null;

  // Zero is unitless in CSS, so `letter-spacing: 0` is written without `em`
  // even though every other value in that group carries one. Adopt the group's
  // unit rather than sending an otherwise ordinary token to the text box.
  const compatible = entry.unit === unit || (amount === 0 && unit === '');
  if (!compatible) return null;

  return { ...entry.range, unit: entry.unit };
}

/* ────────────────────────────────────────────────────────────────
   Choice lists
   ──────────────────────────────────────────────────────────────── */

const FONT_STACKS: { label: string; value: string }[] = [
  {
    label: 'System sans',
    value:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    label: 'System mono',
    value:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
  { label: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Verdana (wide sans)', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier (typewriter)', value: '"Courier New", Courier, monospace' },
];

const EASINGS: { label: string; value: string }[] = [
  { label: 'Ease out (default)', value: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  { label: 'Ease in and out', value: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { label: 'Linear', value: 'linear' },
  { label: 'Gentle', value: 'ease' },
  { label: 'Snap', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
];

/* ────────────────────────────────────────────────────────────────
   Builders
   ──────────────────────────────────────────────────────────────── */

/**
 * The friendly control for a token, or null when there is no honest one.
 *
 * Null is a real answer, not a failure: it means the value in force cannot be
 * represented by any control simpler than the text box.
 */
export function buildControl(context: ControlContext): HTMLElement | null {
  switch (context.token.kind) {
    case 'color':
      return buildColorControl(context);
    case 'length':
    case 'number':
    case 'duration':
      return buildMeasureControl(context);
    case 'filter':
      return buildBlurControl(context);
    case 'font':
      return buildChoiceControl(context, FONT_STACKS);
    case 'easing':
      return buildChoiceControl(context, EASINGS);
    case 'shadow':
      return buildShadowControl(context);
    default:
      return null;
  }
}

/**
 * Swatch plus an opacity slider.
 *
 * The opacity slider is not decoration: a third of the palette is translucent,
 * and `<input type="color">` cannot express alpha at all. Without it, opening
 * the picker on `rgba(0, 0, 0, 0.1)` and clicking anything would silently make
 * that border solid black.
 */
function buildColorControl(context: ControlContext): HTMLElement | null {
  const parsed = parseColor(context.value);
  if (!parsed) return null;

  const wrap = document.createElement('div');
  wrap.className = 'ac-control ac-control--color';

  let current = { ...parsed };

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'ac-control__swatch';
  swatch.value = toHex(current);
  swatch.setAttribute('aria-label', `${context.token.label} colour`);

  const alphaWrap = document.createElement('label');
  alphaWrap.className = 'ac-control__alpha';

  const alphaLabel = document.createElement('span');
  alphaLabel.className = 'ac-control__alpha-label';
  alphaLabel.textContent = 'Opacity';

  const alpha = document.createElement('input');
  alpha.type = 'range';
  alpha.className = 'ac-range ac-control__alpha-range';
  alpha.min = '0';
  alpha.max = '1';
  alpha.step = '0.01';
  alpha.value = String(current.a);

  const alphaValue = document.createElement('span');
  alphaValue.className = 'ac-control__readout';
  alphaValue.textContent = `${Math.round(current.a * 100)}%`;

  alphaWrap.append(alphaLabel, alpha, alphaValue);

  const emit = (commit: boolean) => {
    const next = formatColor(current);
    if (commit) context.onCommit(next);
    else context.onPreview(next);
  };

  swatch.addEventListener('input', () => {
    const picked = parseColor(swatch.value);
    if (!picked) return;
    current = { ...picked, a: current.a };
    emit(false);
  });
  swatch.addEventListener('change', () => emit(true));

  alpha.addEventListener('input', () => {
    current = { ...current, a: parseFloat(alpha.value) };
    alphaValue.textContent = `${Math.round(current.a * 100)}%`;
    emit(false);
  });
  alpha.addEventListener('change', () => emit(true));

  wrap.append(swatch, alphaWrap);

  wrap.dataset.sync = 'color';
  (wrap as ControlElement).syncTo = (value: string) => {
    const parsedNext = parseColor(value);
    if (!parsedNext) return;
    current = { ...parsedNext };
    swatch.value = toHex(current);
    alpha.value = String(current.a);
    alphaValue.textContent = `${Math.round(current.a * 100)}%`;
  };

  return wrap;
}

/** A slider with the number and unit shown beside it. */
function buildMeasureControl(context: ControlContext): HTMLElement | null {
  const measure = parseMeasure(context.value);
  if (!measure) return null;

  const range = rangeFor(context.token.name, measure.unit, measure.amount);
  if (!range) return null;

  const wrap = document.createElement('div');
  wrap.className = 'ac-control ac-control--measure';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'ac-range';
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = String(range.step);
  // A stored value outside the usual range stays reachable rather than being
  // snapped into it the moment the slider is touched.
  slider.value = String(clamp(measure.amount, range.min, range.max));
  slider.setAttribute('aria-label', context.token.label);

  const readout = document.createElement('span');
  readout.className = 'ac-control__readout';

  // Unit comes from the range, not from what was parsed: a value that arrived
  // as a bare `0` still has to go back out as `0em` for letter-spacing.
  const format = (amount: number) => `${round(amount, 4)}${range.unit}`;
  readout.textContent = format(measure.amount);

  slider.addEventListener('input', () => {
    const next = format(parseFloat(slider.value));
    readout.textContent = next;
    context.onPreview(next);
  });

  slider.addEventListener('change', () => {
    context.onCommit(format(parseFloat(slider.value)));
  });

  wrap.append(slider, readout);

  (wrap as ControlElement).syncTo = (value: string) => {
    const next = parseMeasure(value);
    if (!next) return;
    slider.value = String(clamp(next.amount, range.min, range.max));
    readout.textContent = format(next.amount);
  };

  return wrap;
}

/** `blur(12px)` gets a slider on the pixels inside it. */
function buildBlurControl(context: ControlContext): HTMLElement | null {
  const match = context.value.trim().match(/^blur\(\s*(\d*\.?\d+)px\s*\)$/i);
  if (!match) return null;

  const wrap = document.createElement('div');
  wrap.className = 'ac-control ac-control--measure';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'ac-range';
  slider.min = '0';
  slider.max = '40';
  slider.step = '1';
  slider.value = String(clamp(parseFloat(match[1]!), 0, 40));
  slider.setAttribute('aria-label', context.token.label);

  const readout = document.createElement('span');
  readout.className = 'ac-control__readout';
  readout.textContent = `${slider.value}px`;

  const format = (amount: string) => `blur(${amount}px)`;

  slider.addEventListener('input', () => {
    readout.textContent = `${slider.value}px`;
    context.onPreview(format(slider.value));
  });
  slider.addEventListener('change', () => context.onCommit(format(slider.value)));

  wrap.append(slider, readout);

  (wrap as ControlElement).syncTo = (value: string) => {
    const next = value.trim().match(/^blur\(\s*(\d*\.?\d+)px\s*\)$/i);
    if (!next) return;
    slider.value = String(clamp(parseFloat(next[1]!), 0, 40));
    readout.textContent = `${slider.value}px`;
  };

  return wrap;
}

/** A select, used where the useful values are a short known list. */
function buildChoiceControl(
  context: ControlContext,
  choices: { label: string; value: string }[]
): HTMLElement | null {
  const wrap = document.createElement('div');
  wrap.className = 'ac-control ac-control--choice';

  const select = document.createElement('select');
  select.className = 'ac-input';
  select.setAttribute('aria-label', context.token.label);

  const normalised = normalise(context.value);
  const known = choices.some((choice) => normalise(choice.value) === normalised);

  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    select.appendChild(option);
  }

  // Whatever is set stays selectable even when it is not one of ours, so
  // opening the control cannot change the value by itself.
  if (!known) {
    const option = document.createElement('option');
    option.value = context.value;
    option.textContent = 'Custom (set by hand)';
    select.appendChild(option);
  }

  select.value = known
    ? choices.find((choice) => normalise(choice.value) === normalised)!.value
    : context.value;

  select.addEventListener('change', () => context.onCommit(select.value));

  wrap.appendChild(select);

  (wrap as ControlElement).syncTo = (value: string) => {
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  };

  return wrap;
}

/**
 * Shadows get named depths rather than four numbers.
 *
 * Decomposing a shadow into offset, blur, spread, and colour would be four
 * controls for something people think about as one question: how far off the
 * page does this sit.
 */
function buildShadowControl(context: ControlContext): HTMLElement | null {
  const depths = [
    { label: 'None', value: 'none' },
    { label: 'Subtle', value: '0 1px 2px rgba(0, 0, 0, 0.05)' },
    { label: 'Medium', value: '0 2px 8px rgba(0, 0, 0, 0.08)' },
    { label: 'Strong', value: '0 8px 24px rgba(0, 0, 0, 0.14)' },
    { label: 'Heavy', value: '0 16px 40px rgba(0, 0, 0, 0.2)' },
  ];

  return buildChoiceControl(context, depths);
}

/* ────────────────────────────────────────────────────────────────
   Shared
   ──────────────────────────────────────────────────────────────── */

/** A control that can be told the value changed elsewhere (a Revert, an import). */
export interface ControlElement extends HTMLElement {
  syncTo?: (value: string) => void;
}

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
