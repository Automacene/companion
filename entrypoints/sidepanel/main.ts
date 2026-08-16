/**
 * Sidepanel bootstrap.
 *
 * Two stylesheets: the shared design system, then this surface's own layout.
 * Nothing else should ever be imported here — `styles/index.css` pulls in the
 * tokens, base, and components in the order the cascade needs.
 */
import '../../styles/index.css';
import './sidepanel.css';

import { initGhostOverlay } from '../../lib/anim';
import { watchTheme } from '../../lib/theme';
import { ChatUI } from '../../lib/sidepanel/ui';
import { ConnectionManager } from '../../lib/sidepanel/connection';
import { SidepanelApp } from './app';

document.addEventListener('DOMContentLoaded', async () => {
  // Before anything paints, so the panel never flashes the wrong palette.
  // Reads the stored preference once the app has it; `system` until then.
  watchTheme('system');

  initGhostOverlay('backdrop-layer');

  const statusDot = document.getElementById('status-dot');
  const statusPill = document.getElementById('status-pill');
  const chatContainer = document.getElementById('chat-container');
  const chatForm = document.getElementById('chat-form') as HTMLFormElement | null;
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement | null;
  const scrapeBtn = document.getElementById('scrape-btn') as HTMLButtonElement | null;
  const hero = document.querySelector<HTMLElement>('.sidepanel__hero');
  const heroBadge = document.querySelector<HTMLElement>('.sidepanel__logo-badge');

  if (!statusDot || !statusPill || !chatContainer || !chatForm || !chatInput || !runBtn) {
    console.warn('[Sidepanel] Missing required UI elements, aborting boot');
    return;
  }

  const connectionManager = new ConnectionManager(statusDot, statusPill);
  const chatUI = new ChatUI(chatContainer, runBtn, hero);
  const app = new SidepanelApp(
    chatUI,
    connectionManager,
    chatForm,
    chatInput,
    scrapeBtn,
    heroBadge
  );

  await app.init();
});
