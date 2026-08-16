/**
 * Backdrop ghost squares.
 *
 * Spawns faint squares snapped to the grid drawn by `.ac-backdrop`, then removes
 * each once its animation has finished. Purely decorative: the layer it draws
 * into is `pointer-events: none`, so nothing here can intercept a click.
 *
 * The cell size is read back out of CSS rather than duplicated here, so the grid
 * and the squares sitting on it can never disagree.
 */

/** Chance of spawning a square on each tick. */
const SPAWN_CHANCE = 0.8;

/** How often to consider spawning, in milliseconds. */
const SPAWN_INTERVAL_MS = 150;

/** Must outlast the `ac-ghost-fade` keyframes, or squares vanish mid-fade. */
const GHOST_LIFETIME_MS = 3200;

/** Fallback if `--ac-grid-size` cannot be read. */
const FALLBACK_GRID_SIZE = 40;

/**
 * Start the ghost overlay inside a container.
 *
 * @param layerId  id of the `.ac-backdrop__layer` element to draw into
 * @returns a function that stops spawning, for a surface that tears down
 */
export function initGhostOverlay(layerId = 'backdrop-layer'): () => void {
  const layer = document.getElementById(layerId);
  if (!layer) return () => {};

  const gridSize = readGridSize();

  const spawn = () => {
    const bounds = layer.getBoundingClientRect();
    const columns = Math.max(1, Math.floor(bounds.width / gridSize));
    const rows = Math.max(1, Math.floor(bounds.height / gridSize));

    const column = Math.floor(Math.random() * columns);
    const row = Math.floor(Math.random() * rows);

    const square = document.createElement('div');
    square.className = 'ac-backdrop__ghost';
    square.style.left = `${column * gridSize + gridSize / 2}px`;
    square.style.top = `${row * gridSize + gridSize / 2}px`;

    // Vary opacity per square so the field does not look uniform. The colour
    // itself comes from the theme, so this stays readable in light and dark.
    square.style.opacity = `${0.5 + Math.random() * 0.5}`;

    layer.appendChild(square);
    setTimeout(() => square.remove(), GHOST_LIFETIME_MS);
  };

  // A few immediately, so the panel does not open empty.
  for (let i = 0; i < 3; i++) {
    if (Math.random() < 0.5) spawn();
  }

  const timer = setInterval(() => {
    if (Math.random() <= SPAWN_CHANCE) spawn();
  }, SPAWN_INTERVAL_MS);

  return () => clearInterval(timer);
}

/**
 * Read `--ac-grid-size` off the document root.
 */
function readGridSize(): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--ac-grid-size');
  return parseInt(declared, 10) || FALLBACK_GRID_SIZE;
}
