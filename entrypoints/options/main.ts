import '../../styles/theme.css';
import '../../styles/global.css';
import '../../styles/anim.css';
import '../../styles/options.css';

import { initGhostOverlay } from '../../lib/anim';
import { checkOllamaConnection, type OllamaModel } from '../../lib/model';

interface ExtensionSettings {
  ollamaHost?: string;
  connTimeout?: number;
  keepAlive?: string;
  activeModel?: string;
  fallbackModel?: string;
  systemPrompt?: string;
  streamResponses?: boolean;
  temperature?: string | number;
  numCtx?: number;
  numPredict?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  maxMemory?: number;
  stopSeq?: string;
  rawMode?: boolean;
  debugMode?: boolean;
}

function getStorage() {
  // Prefer chrome.storage.local when available (extension), otherwise fallback to localStorage
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    return browser.storage.local;
  }
  return null;
}

function populateModelDropdowns(models: OllamaModel[]) {
  const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
  const fallbackSelect = document.getElementById('fallback-model') as HTMLSelectElement | null;
  if (!primarySelect || !fallbackSelect) return;

  const optionsHtml = models.map((m) => `<option value="${m.name}">${m.name}</option>`).join('');
  primarySelect.innerHTML = optionsHtml;
  fallbackSelect.innerHTML = `<option value="">None</option>` + optionsHtml;
}

async function saveSettingsToStorage(settingsData: Record<string, any>) {
  const storage = getStorage();
  if (storage) {
    return new Promise<void>((resolve, reject) => {
      (storage as Browser.storage.StorageArea).set({ extensionSettings: settingsData }, () => {
        const err = (browser.runtime && browser.runtime.lastError) || null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // fallback
  localStorage.setItem('extensionSettings', JSON.stringify(settingsData));
}

async function preloadModelToVRAM(
  hostUrl: string,
  modelName: string,
  keepAlive: string,
  numCtx: number
) {
  if (!keepAlive) return;
  try {
    await fetch(`${hostUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, keep_alive: keepAlive, options: { num_ctx: numCtx } }),
    });
  } catch (err) {
    console.warn('VRAM Preload failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize background ghost grid animation
  initGhostOverlay('grid-overlay');

  const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
  const testBtn = document.getElementById('test-conn-btn') as HTMLButtonElement | null;
  const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
  const keepAliveInput = document.getElementById('keep-alive') as HTMLInputElement | null;
  const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
  const fallbackSelect = document.getElementById('fallback-model') as HTMLSelectElement | null;
  const systemPrompt = document.getElementById('system-prompt') as HTMLTextAreaElement | null;
  const streamResponses = document.getElementById('stream-responses') as HTMLInputElement | null;
  const settingsForm = document.getElementById('settings-form') as HTMLFormElement | null;
  const saveToast = document.getElementById('save-toast') as HTMLElement | null;
  const statusDot = document.getElementById('status-dot') as HTMLElement | null;
  const statusPill = document.getElementById('status-pill') as HTMLElement | null;

  if (!hostInput || !testBtn || !timeoutInput || !settingsForm) return;

  async function runTestConnection(showToast = true) {
    if (!hostInput || !timeoutInput) return { success: false };
    const host = hostInput.value.trim() || 'http://localhost:11434';

    if (statusDot) statusDot.className = 'status-indicator-dot connecting';
    if (statusPill) {
      statusPill.className = 'status-badge checking';
      statusPill.innerText = '[ CHECKING... ]';
    }

    // Call centralized model check
    const res = await checkOllamaConnection(host);
    if (res.success && res.models && res.models.length) {
      if (statusDot) statusDot.className = 'status-indicator-dot connected';
      if (statusPill) {
        statusPill.className = 'status-badge connected';
        statusPill.innerText = '[ 200 OK ]';
      }
      populateModelDropdowns(res.models);
      if (showToast && saveToast) {
        saveToast.textContent = 'Model list loaded';
        saveToast.classList.add('show');
        setTimeout(() => saveToast.classList.remove('show'), 1200);
      }
      return { success: true, models: res.models };
    }

    if (statusDot) statusDot.className = 'status-indicator-dot error';
    if (statusPill) {
      statusPill.className = 'status-badge offline';
      statusPill.innerText = '[ OFFLINE ]';
    }
    return { success: false };
  }

  // Wire up Test Connection button
  testBtn.addEventListener('click', async () => {
    await runTestConnection(true);
  });

  // Load saved settings (if any)
  const storage = getStorage();
  if (storage) {
    (storage as Browser.storage.StorageArea).get(['extensionSettings'], (items) => {
      const s = items?.extensionSettings as ExtensionSettings | undefined;
      if (s) {
        if (hostInput) hostInput.value = s.ollamaHost || hostInput.value;
        if (timeoutInput) timeoutInput.value = s.connTimeout?.toString() || timeoutInput.value;
        if (keepAliveInput) keepAliveInput.value = s.keepAlive || keepAliveInput.value || '';
        if (systemPrompt) systemPrompt.value = s.systemPrompt || systemPrompt.value || '';
        if (streamResponses) streamResponses.checked = !!s.streamResponses;

        // hyperparams and others (null-checked assignments)
        const tempEl = document.getElementById('temperature') as HTMLInputElement | null;
        if (tempEl) tempEl.value = s.temperature?.toString() || '0.7';

        const numCtxEl = document.getElementById('num-ctx') as HTMLInputElement | null;
        if (numCtxEl) numCtxEl.value = s.numCtx?.toString() || '';

        const numPredictEl = document.getElementById('num-predict') as HTMLInputElement | null;
        if (numPredictEl) numPredictEl.value = s.numPredict?.toString() || '';

        const topPEl = document.getElementById('top-p') as HTMLInputElement | null;
        if (topPEl) topPEl.value = s.topP?.toString() || '';

        const topKEl = document.getElementById('top-k') as HTMLInputElement | null;
        if (topKEl) topKEl.value = s.topK?.toString() || '';

        const repeatPenaltyEl = document.getElementById('repeat-penalty') as HTMLInputElement | null;
        if (repeatPenaltyEl) repeatPenaltyEl.value = s.repeatPenalty?.toString() || '';

        const maxMemoryEl = document.getElementById('max-memory') as HTMLInputElement | null;
        if (maxMemoryEl) maxMemoryEl.value = s.maxMemory?.toString() || '';

        const stopSeqEl = document.getElementById('stop-seq') as HTMLInputElement | null;
        if (stopSeqEl) stopSeqEl.value = s.stopSeq?.toString() || '';

        const rawModeEl = document.getElementById('raw-mode') as HTMLInputElement | null;
        if (rawModeEl) rawModeEl.checked = !!s.rawMode;

        const debugModeEl = document.getElementById('debug-mode') as HTMLInputElement | null;
        if (debugModeEl) debugModeEl.checked = !!s.debugMode;
      }
    });
  } else {
    // fallback: localStorage
    const raw = localStorage.getItem('extensionSettings');
    if (raw) {
      try {
        const s = JSON.parse(raw);
        hostInput.value = s.ollamaHost || hostInput.value;
      } catch {}
    }
  }

  // On load, attempt to populate models from default host
  runTestConnection(false);

  // Save form handler
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const settingsData: Record<string, any> = {
      ollamaHost: hostInput.value.trim(),
      connTimeout: parseInt(timeoutInput.value || '5000', 10),
      keepAlive: keepAliveInput?.value || '',
      activeModel: primarySelect?.value || '',
      fallbackModel: fallbackSelect?.value || '',
      systemPrompt: systemPrompt?.value || '',
      streamResponses: streamResponses?.checked || false,
      temperature: (document.getElementById('temperature') as HTMLInputElement).value,
      numCtx: parseInt((document.getElementById('num-ctx') as HTMLInputElement).value || '0', 10) || 0,
      numPredict: parseInt((document.getElementById('num-predict') as HTMLInputElement).value || '0', 10) || 0,
      topP: parseFloat((document.getElementById('top-p') as HTMLInputElement).value || '0') || 0,
      topK: parseInt((document.getElementById('top-k') as HTMLInputElement).value || '0', 10) || 0,
      repeatPenalty: parseFloat((document.getElementById('repeat-penalty') as HTMLInputElement).value || '0') || 0,
      maxMemory: parseInt((document.getElementById('max-memory') as HTMLInputElement).value || '0', 10) || 0,
      stopSeq: (document.getElementById('stop-seq') as HTMLInputElement).value || '',
      rawMode: (document.getElementById('raw-mode') as HTMLInputElement).checked,
      debugMode: (document.getElementById('debug-mode') as HTMLInputElement).checked,
    };

    try {
      await saveSettingsToStorage(settingsData);
      // show saved toast
      if (saveToast) {
        saveToast.classList.remove('opacity-0');
        setTimeout(() => saveToast.classList.add('opacity-0'), 1400);
      }

      // optionally preload model into VRAM
      if (settingsData.keepAlive && settingsData.activeModel) {
        preloadModelToVRAM(
          settingsData.ollamaHost || 'http://localhost:11434',
          settingsData.activeModel,
          settingsData.keepAlive,
          settingsData.numCtx || 0
        );
      }
    } catch (err) {
      console.error('Failed saving settings', err);
      alert('Failed to save settings');
    }
  });
});

// Break out of Chrome's embedded options modal into a full tab
if (window.location.search.includes('embedded') || window.innerHeight < 700) {
  browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  window.close();
}