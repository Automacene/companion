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

const DEFAULT_SETTINGS: ExtensionSettings = {
  ollamaHost: 'http://localhost:11434',
  connTimeout: 5000,
  keepAlive: '5m',
  activeModel: 'llama3.2:latest',
  fallbackModel: 'qwen3.5:latest',
  systemPrompt:
    'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.',
  streamResponses: true,
  temperature: 0.7,
  numCtx: 8192,
  numPredict: 1024,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  maxMemory: 12000,
  stopSeq: '',
  rawMode: false,
  debugMode: false,
};

function getStorage() {
  // Prefer chrome.storage.local when available (extension), otherwise fallback to localStorage
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    return browser.storage.local;
  }
  return null;
}

function populateModelDropdowns(
  models: OllamaModel[],
  selectedValues?: { activeModel?: string; fallbackModel?: string }
) {
  const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
  const fallbackSelect = document.getElementById('fallback-model') as HTMLSelectElement | null;
  if (!primarySelect || !fallbackSelect) return;

  const optionsHtml = models.map((m) => `<option value="${m.name}">${m.name}</option>`).join('');
  primarySelect.innerHTML = optionsHtml;
  fallbackSelect.innerHTML = `<option value="">None</option>` + optionsHtml;

  if (selectedValues?.activeModel) {
    const activeOption = Array.from(primarySelect.options).find((opt) => opt.value === selectedValues.activeModel);
    if (activeOption) {
      primarySelect.value = selectedValues.activeModel;
    } else {
      const fallbackOpt = document.createElement('option');
      fallbackOpt.value = selectedValues.activeModel;
      fallbackOpt.textContent = selectedValues.activeModel;
      primarySelect.appendChild(fallbackOpt);
      primarySelect.value = selectedValues.activeModel;
    }
  }

  if (selectedValues?.fallbackModel) {
    const fallbackOption = Array.from(fallbackSelect.options).find((opt) => opt.value === selectedValues.fallbackModel);
    if (fallbackOption) {
      fallbackSelect.value = selectedValues.fallbackModel;
    } else {
      const fallbackOpt = document.createElement('option');
      fallbackOpt.value = selectedValues.fallbackModel;
      fallbackOpt.textContent = selectedValues.fallbackModel;
      fallbackSelect.appendChild(fallbackOpt);
      fallbackSelect.value = selectedValues.fallbackModel;
    }
  }
}

function applySettingsToForm(settings: ExtensionSettings | null | undefined) {
  const resolvedSettings = settings || DEFAULT_SETTINGS;
  const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
  const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
  const keepAliveInput = document.getElementById('keep-alive') as HTMLInputElement | null;
  const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
  const fallbackSelect = document.getElementById('fallback-model') as HTMLSelectElement | null;
  const systemPrompt = document.getElementById('system-prompt') as HTMLTextAreaElement | null;
  const streamResponses = document.getElementById('stream-responses') as HTMLInputElement | null;
  const tempEl = document.getElementById('temperature') as HTMLInputElement | null;
  const tempValEl = document.getElementById('temp-val') as HTMLElement | null;
  const numCtxEl = document.getElementById('num-ctx') as HTMLInputElement | null;
  const numPredictEl = document.getElementById('num-predict') as HTMLInputElement | null;
  const topPEl = document.getElementById('top-p') as HTMLInputElement | null;
  const topKEl = document.getElementById('top-k') as HTMLInputElement | null;
  const repeatPenaltyEl = document.getElementById('repeat-penalty') as HTMLInputElement | null;
  const maxMemoryEl = document.getElementById('max-memory') as HTMLInputElement | null;
  const stopSeqEl = document.getElementById('stop-seq') as HTMLInputElement | null;
  const rawModeEl = document.getElementById('raw-mode') as HTMLInputElement | null;
  const debugModeEl = document.getElementById('debug-mode') as HTMLInputElement | null;

  if (hostInput) hostInput.value = resolvedSettings.ollamaHost || 'http://localhost:11434';
  if (timeoutInput) timeoutInput.value = resolvedSettings.connTimeout?.toString() || '5000';
  if (keepAliveInput) keepAliveInput.value = resolvedSettings.keepAlive || '';
  if (systemPrompt) systemPrompt.value = resolvedSettings.systemPrompt || '';
  if (streamResponses) streamResponses.checked = !!resolvedSettings.streamResponses;

  if (tempEl) {
    tempEl.value = resolvedSettings.temperature?.toString() || '0.7';
  }
  if (tempValEl) {
    tempValEl.textContent = tempEl?.value || '0.7';
  }

  if (numCtxEl) numCtxEl.value = resolvedSettings.numCtx?.toString() || '';
  if (numPredictEl) numPredictEl.value = resolvedSettings.numPredict?.toString() || '';
  if (topPEl) topPEl.value = resolvedSettings.topP?.toString() || '';
  if (topKEl) topKEl.value = resolvedSettings.topK?.toString() || '';
  if (repeatPenaltyEl) repeatPenaltyEl.value = resolvedSettings.repeatPenalty?.toString() || '';
  if (maxMemoryEl) maxMemoryEl.value = resolvedSettings.maxMemory?.toString() || '';
  if (stopSeqEl) stopSeqEl.value = resolvedSettings.stopSeq || '';
  if (rawModeEl) rawModeEl.checked = !!resolvedSettings.rawMode;
  if (debugModeEl) debugModeEl.checked = !!resolvedSettings.debugMode;

  if (primarySelect && resolvedSettings.activeModel) {
    const activeOption = Array.from(primarySelect.options).find((opt) => opt.value === resolvedSettings.activeModel);
    if (activeOption) {
      primarySelect.value = resolvedSettings.activeModel;
    } else {
      const fallbackOpt = document.createElement('option');
      fallbackOpt.value = resolvedSettings.activeModel;
      fallbackOpt.textContent = resolvedSettings.activeModel;
      primarySelect.appendChild(fallbackOpt);
      primarySelect.value = resolvedSettings.activeModel;
    }
  }

  if (fallbackSelect && resolvedSettings.fallbackModel) {
    const fallbackOption = Array.from(fallbackSelect.options).find((opt) => opt.value === resolvedSettings.fallbackModel);
    if (fallbackOption) {
      fallbackSelect.value = resolvedSettings.fallbackModel;
    } else {
      const fallbackOpt = document.createElement('option');
      fallbackOpt.value = resolvedSettings.fallbackModel;
      fallbackOpt.textContent = resolvedSettings.fallbackModel;
      fallbackSelect.appendChild(fallbackOpt);
      fallbackSelect.value = resolvedSettings.fallbackModel;
    }
  }
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

document.addEventListener('DOMContentLoaded', async () => {
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
  const resetBtn = document.getElementById('reset-settings-btn') as HTMLButtonElement | null;
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
      populateModelDropdowns(res.models, {
        activeModel: (document.getElementById('active-model') as HTMLSelectElement | null)?.value || undefined,
        fallbackModel: (document.getElementById('fallback-model') as HTMLSelectElement | null)?.value || undefined,
      });
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

  const storedSettings = await new Promise<ExtensionSettings | null>((resolve) => {
    const storage = getStorage();
    if (storage) {
      (storage as Browser.storage.StorageArea).get(['extensionSettings'], (items) => {
        const s = items?.extensionSettings as ExtensionSettings | undefined;
        resolve(s || null);
      });
      return;
    }

    const raw = localStorage.getItem('extensionSettings');
    if (!raw) {
      resolve(null);
      return;
    }

    try {
      resolve(JSON.parse(raw) as ExtensionSettings);
    } catch {
      resolve(null);
    }
  });

  applySettingsToForm(storedSettings);

  // On load, attempt to populate models from default host
  await runTestConnection(false);

  async function saveCurrentFormSettings() {
    if (!hostInput || !timeoutInput) return;

    const settingsData: Record<string, any> = {
      ollamaHost: hostInput.value.trim() || DEFAULT_SETTINGS.ollamaHost,
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
      if (saveToast) {
        saveToast.textContent = '✓ Settings saved successfully';
        saveToast.classList.remove('opacity-0');
        setTimeout(() => saveToast.classList.add('opacity-0'), 1400);
      }
    } catch (err) {
      console.error('Failed saving settings', err);
      alert('Failed to save settings');
    }
  }

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveCurrentFormSettings();
  });

  resetBtn?.addEventListener('click', async () => {
    applySettingsToForm(DEFAULT_SETTINGS);
    await saveCurrentFormSettings();
    if (saveToast) {
      saveToast.textContent = '✓ Defaults restored';
      saveToast.classList.remove('opacity-0');
      setTimeout(() => saveToast.classList.add('opacity-0'), 1400);
    }
  });
});

// Break out of Chrome's embedded options modal into a full tab
if (window.location.search.includes('embedded') || window.innerHeight < 700) {
  browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  window.close();
}