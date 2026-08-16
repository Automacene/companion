/**
 * Settings hub.
 *
 * Two doors and nothing else. This is the page Chrome opens for "Options", and
 * the real settings live one click away on their own pages — model
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
import { mountLogo } from '../../lib/logo';
import { checkOllamaConnection } from '../../lib/model';
import { getPreset } from '../../lib/backdrop';
import { OLLAMA_HOST } from '../../lib/constants';

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await readSettings();

  startAppearance(settings, {
    backdropContainer: document.getElementById('backdrop-layer'),
  });

  mountLogo('.hub__logo');

  // Extension page URLs are only knowable from inside the extension.
  const modelLink = document.getElementById('open-model') as HTMLAnchorElement | null;
  const themeLink = document.getElementById('open-theme') as HTMLAnchorElement | null;

  if (modelLink) modelLink.href = browser.runtime.getURL('/model.html');
  if (themeLink) themeLink.href = browser.runtime.getURL('/theme.html');

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
      0
    );

    themeSummary.textContent = [
      settings.theme ?? 'system',
      `${preset.label.toLowerCase()} backdrop`,
      changed > 0 ? `${changed} customised` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // The connection light. This page does nothing with Ollama itself, but it is
  // the first thing opened when something is wrong, so it should say whether
  // the server is even reachable before you go hunting through the model page.
  const statusDot = document.getElementById('status-dot');
  const statusPill = document.getElementById('status-pill');

  const { success } = await checkOllamaConnection(settings.ollamaHost || OLLAMA_HOST);

  if (statusDot) statusDot.className = `ac-status-dot ac-status-dot--${success ? 'ok' : 'error'}`;
  if (statusPill) {
    statusPill.className = `ac-badge ac-badge--${success ? 'ok' : 'error'}`;
    statusPill.textContent = success ? '[ 200 OK ]' : '[ OFFLINE ]';
  }
});
