export function initGhostOverlay(overlayId: string = 'grid-overlay'): void {
  const overlay = document.getElementById(overlayId) as HTMLElement | null;
  if (!overlay) return;

  const cssGridSize = getComputedStyle(document.documentElement).getPropertyValue('--grid-size') || '40px';
  const gridSize = parseInt(cssGridSize, 10) || 40;

  const spawnChance = 0.80;
  const intervalMs = 150;

  function createGhostAtRandomCell() {
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const maxCols = Math.max(1, Math.floor(rect.width / gridSize));
    const maxRows = Math.max(1, Math.floor(rect.height / gridSize));

    const col = Math.floor(Math.random() * maxCols);
    const row = Math.floor(Math.random() * maxRows);

    const centerX = col * gridSize + gridSize / 2;
    const centerY = row * gridSize + gridSize / 2;

    const square = document.createElement('div');
    square.className = 'ghost-square';
    square.style.left = `${centerX}px`;
    square.style.top = `${centerY}px`;

    const gray = Math.floor(100 + Math.random() * 120);
    const alpha = Math.floor(100 + Math.random() * 120);
    square.style.backgroundColor = `rgba(${gray}, ${gray}, ${gray}, ${alpha * 0.25})`;

    overlay.appendChild(square);
    setTimeout(() => square.remove(), 3200);
  }

  for (let i = 0; i < 3; i++) {
    if (Math.random() < 0.5) createGhostAtRandomCell();
  }

  setInterval(() => {
    if (Math.random() <= spawnChance) createGhostAtRandomCell();
  }, intervalMs);
}