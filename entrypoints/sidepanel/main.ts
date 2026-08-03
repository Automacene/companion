import '../../styles/theme.css';
import '../../styles/global.css';
import '../../styles/anim.css';
import '../../styles/sidepanel.css';

import { initGhostOverlay } from '../../lib/anim';
import { ChatUI } from '../../lib/sidepanel/ui';
import { ConnectionManager } from '../../lib/sidepanel/connection';
import { SidepanelApp } from './app';

document.addEventListener('DOMContentLoaded', async () => {
  initGhostOverlay('grid-overlay');

  const statusDot = document.getElementById('status-dot') as HTMLElement | null;
  const statusPill = document.getElementById('status-pill') as HTMLElement | null;
  const chatContainer = document.getElementById('chat-container') as HTMLElement | null;
  const chatForm = document.getElementById('chat-form') as HTMLFormElement | null;
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement | null;
  const scrapeBtn = document.getElementById('scrape-btn') as HTMLButtonElement | null;
  const hero = document.querySelector('.brand-hero') as HTMLElement | null;
  const pulser = document.querySelector('.brand-status-badge') as HTMLElement | null;

  if (!statusDot || !statusPill || !chatContainer || !chatForm || !chatInput || !runBtn) {
    console.warn('Missing required UI elements in sidepanel');
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
    pulser
  );

  await app.init();
});