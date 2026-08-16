/**
 * Sidepanel bootstrap.
 *
 * Two stylesheets: the shared design system, then this surface's own layout.
 * Nothing else should ever be imported here — `styles/index.css` pulls in the
 * tokens, base, and components in the order the cascade needs.
 */
import '../../styles/index.css';
import './sidepanel.css';

import { startAppearance } from '../../lib/appearance';
import { readSettings } from '../../lib/settings-client';
import { ChatUI } from '../../lib/sidepanel/ui';
import { ConnectionManager } from '../../lib/sidepanel/connection';
import { SidepanelApp } from './app';

document.addEventListener('DOMContentLoaded', async () => {
  // Appearance first, and awaited, so the panel never paints the wrong palette.
  // Every token is a custom property, so one write to the root settles it.
  const settings = await readSettings();

  const appearance = startAppearance(settings, {
    backdropContainer: document.getElementById('backdrop-layer'),
  });

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

  // Both settings pages open in a tab. `browser.runtime.getURL` is the only
  // way to know an extension page's URL from inside the extension, and WXT
  // types its argument as the set of pages that actually got built — so a
  // typo here is a compile error rather than a dead button.
  const openPage = (url: string) => () => {
    void browser.tabs.create({ url });
  };

  document
    .getElementById('appearance-btn')
    ?.addEventListener('click', openPage(browser.runtime.getURL('/theme.html')));

  document
    .getElementById('settings-btn')
    ?.addEventListener('click', openPage(browser.runtime.getURL('/options.html')));

  const connectionManager = new ConnectionManager(statusDot, statusPill);
  const chatUI = new ChatUI(chatContainer, runBtn, hero);
  const app = new SidepanelApp(
    chatUI,
    connectionManager,
    chatForm,
    chatInput,
    scrapeBtn,
    heroBadge,
    appearance.backdrop
  );

  await app.init();
});
