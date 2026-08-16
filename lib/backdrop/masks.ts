/**
 * Mask sources for the ASCII field.
 *
 * A mask answers one question: how bright is the cell at (col, row) at time t.
 * It gets no canvas, no DOM, and no state — which is what makes it safe to let
 * a preset name one, and what would make it safe to let an addon register one.
 *
 * Registered by name, the same way processors are in
 * `lib/processors/pipeline.ts`. Adding a look means adding a function here.
 *
 * NOTE ON SCOPE. A mask is code, so a user cannot author one at runtime: MV3
 * pins `script-src 'self'` and there is no way to relax it. Users pick a mask
 * and tune the numbers around it; new masks are a build-time addition.
 */

/**
 * @param col   column index, 0 at the left edge
 * @param row   row index, 0 at the top edge
 * @param time  seconds since start, already scaled by the preset's speed
 * @param cols  total columns, so a mask can work in relative space
 * @param rows  total rows
 * @returns brightness, 0 to 1. Values outside the range are clamped by the
 *   renderer, so a mask does not have to be careful.
 */
export type MaskSource = (
  col: number,
  row: number,
  time: number,
  cols: number,
  rows: number
) => number;

export interface MaskDefinition {
  id: string;
  label: string;
  /** One line, shown under the picker in the theme editor. */
  description: string;
  sample: MaskSource;
}

/**
 * Domain-warped sines. The warp is the whole trick: two plain sine waves read
 * as a plaid grid, and displacing each one by the other breaks the regularity
 * into something that looks like drifting cloud.
 */
const flow: MaskSource = (col, row, time) => {
  const warpedX = col * 0.09 + Math.sin(row * 0.11 + time * 0.21) * 1.9;
  const warpedY = row * 0.11 + Math.cos(col * 0.07 - time * 0.17) * 1.7;
  const value = Math.sin(warpedX + time * 0.28) * 0.5 + Math.sin(warpedY - time * 0.19) * 0.5;
  return (value + 1) * 0.5;
};

/**
 * Four overlapping waves, one of them radial. Denser and more active than
 * `flow`, and the only one where the interference pattern is the point.
 */
const plasma: MaskSource = (col, row, time) => {
  const value =
    Math.sin(col * 0.13 + time * 0.3) +
    Math.sin(row * 0.16 - time * 0.24) +
    Math.sin((col + row) * 0.09 + time * 0.19) +
    Math.sin(Math.sqrt(col * col + row * row) * 0.14 - time * 0.33);
  return (value / 4 + 1) * 0.5;
};

/**
 * Rings travelling out from a point above centre, fading with distance. Reads
 * as a single source rather than a texture, which suits a narrow column better
 * than the wave masks do.
 */
const ripple: MaskSource = (col, row, time, cols, rows) => {
  const centreX = cols * 0.5;
  const centreY = rows * 0.42;
  const dx = col - centreX;
  const dy = (row - centreY) * 1.4;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const value = Math.sin(distance * 0.42 - time * 1.1) * Math.exp(-distance * 0.026);
  return (value + 0.45) * 0.9;
};

/**
 * Slow diagonal bands crossed by a second, slower set. The quietest of the
 * four, and the one that holds up best at small cell sizes.
 */
const drift: MaskSource = (col, row, time) => {
  const primary = Math.sin((col * 0.5 + row) * 0.11 - time * 0.16);
  const secondary = Math.sin((col - row * 0.7) * 0.06 + time * 0.09);
  return (primary * 0.6 + secondary * 0.4 + 1) * 0.5;
};

/**
 * Vertical rain, denser near the top. Included because a narrow panel reads
 * vertical motion far better than a wide page does.
 */
const rain: MaskSource = (col, row, time, _cols, rows) => {
  // Each column gets its own phase and speed from its index, so the columns
  // never line up into a visible wave front.
  const phase = Math.sin(col * 12.9898) * 43758.5453;
  const offset = phase - Math.floor(phase);
  const speed = 0.6 + offset * 0.9;

  const head = (time * speed + offset * 10) % (rows + 12);
  const distance = head - row;

  if (distance < 0 || distance > 12) return 0;
  return 1 - distance / 12;
};

const DEFINITIONS: MaskDefinition[] = [
  {
    id: 'flow',
    label: 'Flow',
    description: 'Warped waves drifting sideways. The calmest of the set.',
    sample: flow,
  },
  {
    id: 'plasma',
    label: 'Plasma',
    description: 'Four overlapping waves. Busiest, most obviously animated.',
    sample: plasma,
  },
  {
    id: 'ripple',
    label: 'Ripple',
    description: 'Rings from a single point, fading outward.',
    sample: ripple,
  },
  {
    id: 'drift',
    label: 'Drift',
    description: 'Slow diagonal bands. Holds up best at small cell sizes.',
    sample: drift,
  },
  {
    id: 'rain',
    label: 'Rain',
    description: 'Falling columns. Suits a narrow panel.',
    sample: rain,
  },
];

const REGISTRY = new Map<string, MaskDefinition>(
  DEFINITIONS.map((definition) => [definition.id, definition])
);

/** Register a mask. Re-registering an id replaces it. */
export function registerMask(definition: MaskDefinition): void {
  REGISTRY.set(definition.id, definition);
}

/** Every registered mask, in registration order. */
export function listMasks(): MaskDefinition[] {
  return [...REGISTRY.values()];
}

/**
 * Look a mask up, falling back to `flow` rather than throwing.
 *
 * A stored preset can name a mask that a later build removed, and a background
 * that fails to draw is not worth breaking the panel over.
 */
export function getMask(id: string): MaskSource {
  return (REGISTRY.get(id) ?? REGISTRY.get('flow')!).sample;
}

export function hasMask(id: string): boolean {
  return REGISTRY.has(id);
}
