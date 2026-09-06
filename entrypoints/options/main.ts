/**
 * Settings hub.
 *
 * Two doors and nothing else. This is the page Chrome opens for "Options", and
 * the real settings live one click away on their own pages - model
 * configuration is set once and left alone, appearance is played with, and the
 * two want different layouts and different amounts of room.
 *
 * Each card carries a one-line summary of the current state, so the common
 * case of "what model am I on" is answered without opening anything.
 */
import '../../styles/index.css';
import './options.css';

import { startAppearance } from '../../lib/appearance';
import { readSettings } from '../../lib/settings-client';
import { MemoryAction } from '../../types/actions';
import { askWorker } from '../../lib/worker-client';
import { mountLogo } from '../../lib/logo';
import { checkOllamaConnection } from '../../lib/model';
import { getPreset } from '../../lib/backdrop';
import { OLLAMA_HOST } from '../../lib/constants';

/**
 * Break out of Chrome's embedded options panel into a real tab.
 *
 * `manifest.open_in_tab` should make this unnecessary, but it only applies to
 * a build the browser has actually reloaded - an older unpacked build, or a
 * profile that has not picked up the new manifest, still renders this page as
 * a short modal on chrome://extensions where the links out of it go nowhere.
 *
 * The embedded panel is an iframe, so `window.top !== window.self` identifies
 * it exactly. That is also what makes this safe to run unconditionally: a page
 * already open in a tab is top-level, so it cannot re-trigger. The previous
 * version tested `window.innerHeight < 700`, which is true of a small tab as
 * well and would open tabs forever on a short screen.
 */
if (window.top !== window.self) {
  void browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
} else {
  document.addEventListener('DOMContentLoaded', async () => {
    const settings = await readSettings();

    startAppearance(settings, {
      backdropContainer: document.getElementById('backdrop-layer'),
    });

    mountLogo('.hub__logo');

    // Extension page URLs are only knowable from inside the extension.
    const modelLink = document.getElementById('open-model') as HTMLAnchorElement | null;
    const themeLink = document.getElementById('open-theme') as HTMLAnchorElement | null;
    const memoryLink = document.getElementById('open-memory') as HTMLAnchorElement | null;

    if (modelLink) modelLink.href = browser.runtime.getURL('/model.html');
    if (themeLink) themeLink.href = browser.runtime.getURL('/theme.html');
    if (memoryLink) memoryLink.href = browser.runtime.getURL('/memory.html');

    // How much is stored, so the card says something rather than only pointing.
    void askWorker<{ pools?: { name: string; size: number }[] }>({
      action: MemoryAction.MEMORY_STATS,
    })
      .then((result) => {
        const summary = document.getElementById('memory-summary');
        if (!summary) return;

        const archive = (result.pools ?? []).find((p) => p.name === 'archive');
        summary.textContent = archive?.size ? `${archive.size} remembered` : 'nothing stored yet';
      })
      .catch(() => {
        const summary = document.getElementById('memory-summary');
        if (summary) summary.textContent = 'could not read memory';
      });

    // Summaries, so the cards say something rather than only pointing.
    const modelSummary = document.getElementById('model-summary');
    const themeSummary = document.getElementById('theme-summary');

    if (modelSummary) {
      modelSummary.textContent = `${settings.activeModel ?? 'no model'} · ${
        settings.ollamaHost ?? OLLAMA_HOST
      }`;
    }

    if (themeSummary) {
      const preset = getPreset(settings.backdrop?.preset ?? 'flow');
      const changed = Object.values(settings.themeOverrides ?? {}).reduce(
        (total, values) => total + Object.keys(values ?? {}).length,
        0,
      );

      themeSummary.textContent = [
        settings.theme ?? 'system',
        `${preset.label.toLowerCase()} backdrop`,
        changed > 0 ? `${changed} customised` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }

    // The connection light.
    const statusDot = document.getElementById('status-dot');
    const statusPill = document.getElementById('status-pill');

    const { success } = await checkOllamaConnection(settings.ollamaHost || OLLAMA_HOST);

    if (statusDot) statusDot.className = `ac-status-dot ac-status-dot--${success ? 'ok' : 'error'}`;
    if (statusPill) {
      statusPill.className = `ac-badge ac-badge--${success ? 'ok' : 'error'}`;
      statusPill.textContent = success ? '[ 200 OK ]' : '[ OFFLINE ]';
    }
  });
}
