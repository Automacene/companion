import '../../styles/theme.css';
import '../../styles/global.css';
import '../../styles/anim.css';
import '../../styles/options.css';

import { initGhostOverlay } from '../../lib/anim';
import { PortAction } from '@/types/actions';
import type { ExtensionSettings } from '../../types/state'; 
import {
  DEFAULT_CONN_TIMEOUT,
  OLLAMA_HOST,
  DEFAULT_TEMPERATURE,
  DEFAULT_SETTINGS
} from '../../lib/constants';
import { checkOllamaConnection, type OllamaModel } from '../../lib/model';

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

  if (hostInput) hostInput.value = resolvedSettings.ollamaHost || OLLAMA_HOST;
  if (timeoutInput) timeoutInput.value = resolvedSettings.connTimeout?.toString() || DEFAULT_CONN_TIMEOUT.toString();
  if (keepAliveInput) keepAliveInput.value = resolvedSettings.keepAlive || '';
  if (systemPrompt) systemPrompt.value = resolvedSettings.systemPrompt || '';
  if (streamResponses) streamResponses.checked = !!resolvedSettings.streamResponses;

  if (tempEl) {
    tempEl.value = resolvedSettings.temperature?.toString() || DEFAULT_TEMPERATURE.toString();
  }
  if (tempValEl) {
    tempValEl.textContent = tempEl?.value || DEFAULT_TEMPERATURE.toString();
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


document.addEventListener('DOMContentLoaded', async () => {
  // Initialize background ghost grid animation
  initGhostOverlay('grid-overlay');

  const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
  const testBtn = document.getElementById('test-conn-btn') as HTMLButtonElement | null;
  const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
  const settingsForm = document.getElementById('settings-form') as HTMLFormElement | null;
  const resetBtn = document.getElementById('reset-settings-btn') as HTMLButtonElement | null;
  const saveToast = document.getElementById('save-toast') as HTMLElement | null;
  const statusDot = document.getElementById('status-dot') as HTMLElement | null;
  const statusPill = document.getElementById('status-pill') as HTMLElement | null;

  if (!hostInput || !testBtn || !timeoutInput || !settingsForm) return;

  async function runTestConnection(showToast = true) {
    if (!hostInput || !timeoutInput) return { success: false };
    const host = hostInput.value.trim() || OLLAMA_HOST;

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

  function getSettingsFromForm(): ExtensionSettings {
    const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
    const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
    const keepAliveInput = document.getElementById('keep-alive') as HTMLInputElement | null;
    const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
    const fallbackSelect = document.getElementById('fallback-model') as HTMLSelectElement | null;
    const systemPrompt = document.getElementById('system-prompt') as HTMLTextAreaElement | null;
    const streamResponses = document.getElementById('stream-responses') as HTMLInputElement | null;
    const tempEl = document.getElementById('temperature') as HTMLInputElement | null;
    const numCtxEl = document.getElementById('num-ctx') as HTMLInputElement | null;
    const numPredictEl = document.getElementById('num-predict') as HTMLInputElement | null;
    const topPEl = document.getElementById('top-p') as HTMLInputElement | null;
    const topKEl = document.getElementById('top-k') as HTMLInputElement | null;
    const repeatPenaltyEl = document.getElementById('repeat-penalty') as HTMLInputElement | null;
    const maxMemoryEl = document.getElementById('max-memory') as HTMLInputElement | null;
    const stopSeqEl = document.getElementById('stop-seq') as HTMLInputElement | null;
    const rawModeEl = document.getElementById('raw-mode') as HTMLInputElement | null;
    const debugModeEl = document.getElementById('debug-mode') as HTMLInputElement | null;

    return {
      ollamaHost: hostInput?.value.trim() || OLLAMA_HOST,
      connTimeout: parseInt(timeoutInput?.value || '', 10) || DEFAULT_CONN_TIMEOUT,
      keepAlive: keepAliveInput?.value || '',
      activeModel: primarySelect?.value || '',
      fallbackModel: fallbackSelect?.value || '',
      systemPrompt: systemPrompt?.value || '',
      streamResponses: streamResponses ? streamResponses.checked : true,
      temperature: tempEl?.value || '',
      numCtx: parseInt(numCtxEl?.value || '', 10) || 0,
      numPredict: parseInt(numPredictEl?.value || '', 10) || 0,
      topP: parseFloat(topPEl?.value || '') || 0,
      topK: parseInt(topKEl?.value || '', 10) || 0,
      repeatPenalty: parseFloat(repeatPenaltyEl?.value || '') || 0,
      maxMemory: parseInt(maxMemoryEl?.value || '', 10) || 0,
      stopSeq: stopSeqEl?.value || '',
      rawMode: rawModeEl ? rawModeEl.checked : false,
      debugMode: debugModeEl ? debugModeEl.checked : false,
    };
  }

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const settingsData = getSettingsFromForm();

    try {
      const response = await browser.runtime.sendMessage({
        action: PortAction.SAVE_SETTINGS,
        settings: settingsData
      });

      if (response?.success) {
        if (saveToast) {
          saveToast.textContent = '✓ Settings saved successfully';
          saveToast.classList.remove('opacity-0');
          setTimeout(() => saveToast.classList.add('opacity-0'), 1400);
        }
      } else {
        throw new Error(response?.error || 'Unknown save error');
      }
    } catch (err) {
      console.error('Failed saving settings', err);
      alert('Failed to save settings');
    }
  });

  resetBtn?.addEventListener('click', async () => {
    applySettingsToForm(DEFAULT_SETTINGS);

    try {
      const response = await browser.runtime.sendMessage({
        action: PortAction.SAVE_SETTINGS,
        settings: DEFAULT_SETTINGS
      });

      if (response?.success) {
        if (saveToast) {
          saveToast.textContent = '✓ Defaults restored';
          saveToast.classList.remove('opacity-0');
          setTimeout(() => saveToast.classList.add('opacity-0'), 1400);
        }
      } else {
        throw new Error(response?.error || 'Unknown reset error');
      }
    } catch (err) {
      console.error('Failed resetting settings', err);
      alert('Failed to reset settings');
    }
  });
});

// Break out of Chrome's embedded options modal into a full tab
if (window.location.search.includes('embedded') || window.innerHeight < 700) {
  browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  window.close();
}