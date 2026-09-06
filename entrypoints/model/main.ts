/**
 * Options page bootstrap.
 *
 * Two stylesheets: the shared design system, then this surface's own layout.
 */
import '../../styles/index.css';
import './model.css';

import { startAppearance } from '../../lib/appearance';
import { readSettings, patchSettings, replaceSettings } from '../../lib/settings-client';
import { renderParams, type ParamsUi } from './params-ui';
import { renderMemory, type MemoryUi } from './memory-ui';
import { DEFAULT_MEMORY, type MemoryShares } from '../../lib/mind/memory-params';
import { contextTokensOf } from '../../lib/mind/build';
import { mountServerPanel } from './server-panel';
import type { ParamValues } from '../../lib/model-params';
import type { ExtensionSettings } from '../../types/state';
import {
  DEFAULT_CONN_TIMEOUT,
  OLLAMA_HOST,
  DEFAULT_TEMPERATURE,
  DEFAULT_SETTINGS,
} from '../../lib/constants';
import { checkOllamaConnection, type OllamaModel } from '../../lib/model';

function populateModelDropdowns(models: OllamaModel[], selectedValues?: { activeModel?: string }) {
  const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
  if (!primarySelect) return;

  primarySelect.innerHTML = models
    .map((m) => `<option value="${m.name}">${m.name}</option>`)
    .join('');

  if (selectedValues?.activeModel) {
    const activeOption = Array.from(primarySelect.options).find(
      (opt) => opt.value === selectedValues.activeModel,
    );
    if (activeOption) {
      primarySelect.value = selectedValues.activeModel;
    } else {
      // A model that is set but not in the list - offline, or pulled since.
      const missing = document.createElement('option');
      missing.value = selectedValues.activeModel;
      missing.textContent = selectedValues.activeModel;
      primarySelect.appendChild(missing);
      primarySelect.value = selectedValues.activeModel;
    }
  }
}

function applySettingsToForm(settings: ExtensionSettings | null | undefined) {
  const resolvedSettings = settings || DEFAULT_SETTINGS;
  const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
  const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
  const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
  const systemPrompt = document.getElementById('system-prompt') as HTMLTextAreaElement | null;
  const streamResponses = document.getElementById('stream-responses') as HTMLInputElement | null;
  const debugModeEl = document.getElementById('debug-mode') as HTMLInputElement | null;

  if (hostInput) hostInput.value = resolvedSettings.ollamaHost || OLLAMA_HOST;
  if (timeoutInput)
    timeoutInput.value =
      resolvedSettings.connTimeout?.toString() || DEFAULT_CONN_TIMEOUT.toString();
  if (systemPrompt) systemPrompt.value = resolvedSettings.systemPrompt || '';
  if (streamResponses) streamResponses.checked = !!resolvedSettings.streamResponses;

  if (debugModeEl) debugModeEl.checked = !!resolvedSettings.debugMode;

  if (primarySelect && resolvedSettings.activeModel) {
    const activeOption = Array.from(primarySelect.options).find(
      (opt) => opt.value === resolvedSettings.activeModel,
    );
    if (activeOption) {
      primarySelect.value = resolvedSettings.activeModel;
    } else {
      const missing = document.createElement('option');
      missing.value = resolvedSettings.activeModel;
      missing.textContent = resolvedSettings.activeModel;
      primarySelect.appendChild(missing);
      primarySelect.value = resolvedSettings.activeModel;
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const storedSettings = await readSettings();

  // Appearance is owned by the theme page.
  startAppearance(storedSettings, {
    backdropContainer: document.getElementById('backdrop-layer'),
  });

  const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
  const testBtn = document.getElementById('test-conn-btn') as HTMLButtonElement | null;
  const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
  const settingsForm = document.getElementById('settings-form') as HTMLFormElement | null;
  const resetBtn = document.getElementById('reset-settings-btn') as HTMLButtonElement | null;
  const saveToast = document.getElementById('save-toast') as HTMLElement | null;
  const paramHost = document.getElementById('param-groups');
  const memoryHost = document.getElementById('memory-params');
  const memoryTotalHost = document.getElementById('memory-total');
  const statusHost = document.getElementById('server-status');
  const statusDot = document.getElementById('status-dot') as HTMLElement | null;
  const statusPill = document.getElementById('status-pill') as HTMLElement | null;

  if (!hostInput || !testBtn || !timeoutInput || !settingsForm) return;

  async function runTestConnection(showToast = true) {
    if (!hostInput || !timeoutInput) return { success: false };
    const host = hostInput.value.trim() || OLLAMA_HOST;

    setStatus('warn', '[ CHECKING... ]');

    // Call centralized model check
    const res = await checkOllamaConnection(host);
    if (res.success && res.models && res.models.length) {
      setStatus('ok', '[ 200 OK ]');
      populateModelDropdowns(res.models, {
        activeModel:
          (document.getElementById('active-model') as HTMLSelectElement | null)?.value || undefined,
      });
      if (showToast) showToast_('Model list loaded');
      return { success: true, models: res.models };
    }

    setStatus('error', '[ OFFLINE ]');
    return { success: false };
  }

  /**
   * Write the connection state into the header. Both elements move together,
   * matching `ConnectionManager` on the sidepanel side.
   */
  function setStatus(state: 'ok' | 'warn' | 'error', label: string) {
    if (statusDot) statusDot.className = `ac-status-dot ac-status-dot--${state}`;
    if (statusPill) {
      statusPill.className = `ac-badge ac-badge--${state}`;
      statusPill.textContent = label;
    }
  }

  /**
   * Flash the toast. One code path, one state class.
   *
   * This previously had two: `classList.add('show')` here and
   * `classList.remove('opacity-0')` at the save handler. `opacity-0` is a
   * Tailwind utility, and no stylesheet in this project ever imported
   * Tailwind, so that half silently did nothing.
   */
  function showToast_(message: string, tone: 'success' | 'error' = 'success') {
    if (!saveToast) return;
    saveToast.textContent = message;
    saveToast.className = `ac-toast ac-toast--${tone} is-visible`;
    setTimeout(() => saveToast.classList.remove('is-visible'), 1600);
  }

  // Wire up Test Connection button
  testBtn.addEventListener('click', async () => {
    await runTestConnection(true);
  });

  // Navigation.
  const hubLink = document.getElementById('open-hub') as HTMLAnchorElement | null;
  const themeLink = document.getElementById('open-theme') as HTMLAnchorElement | null;

  if (hubLink) hubLink.href = browser.runtime.getURL('/options.html');
  if (themeLink) themeLink.href = browser.runtime.getURL('/theme.html');

  applySettingsToForm(storedSettings);

  // On load, attempt to populate models from default host
  await runTestConnection(false);

  /**
   * Generation parameters, held here rather than read back out of the DOM.
   *
   * The controls can be empty, and empty means "let the model decide" - which
   * is a different thing from zero and cannot be recovered by reading an input
   * value after the fact. Keeping the authoritative copy in memory is what lets
   * a cleared box actually delete the key.
   */
  let params: ParamValues = (storedSettings.modelParams ?? {}) as ParamValues;

  let memory: MemoryShares = (storedSettings.memory ?? DEFAULT_MEMORY) as MemoryShares;

  const paramsUi: ParamsUi | null = paramHost
    ? renderParams({
        host: paramHost,
        values: params,
        onChange: (next) => {
          params = next;
          // Every memory figure is a share of `num_ctx`.
          memoryUi?.refresh();
        },
      })
    : null;

  const memoryUi: MemoryUi | null =
    memoryHost && memoryTotalHost
      ? renderMemory({
          host: memoryHost,
          totalHost: memoryTotalHost,
          values: memory,
          getContextTokens: () => contextTokensOf({ modelParams: params }),
          onChange: (next) => {
            memory = next;
          },
        })
      : null;

  // Reads the host field rather than the saved setting, so typing a new URL.
  const serverPanel = statusHost
    ? mountServerPanel({
        host: statusHost,
        getHostUrl: () =>
          (document.getElementById('ollama-host') as HTMLInputElement | null)?.value.trim() ||
          OLLAMA_HOST,
        getTimeoutMs: () =>
          parseInt(
            (document.getElementById('conn-timeout') as HTMLInputElement | null)?.value || '',
            10,
          ) || DEFAULT_CONN_TIMEOUT,
        getActiveModel: () =>
          (document.getElementById('active-model') as HTMLSelectElement | null)?.value || '',
      })
    : null;

  document.getElementById('refresh-status-btn')?.addEventListener('click', () => {
    serverPanel?.refresh();
  });

  document.getElementById('reset-params-btn')?.addEventListener('click', () => {
    params = {};
    paramsUi?.setValues(params);
    showToast_('Generation parameters back to model defaults');
  });

  /**
   * Only the fields this page owns. Appearance lives on the theme page, and a
   * partial is what keeps this save from erasing it.
   */
  function getSettingsFromForm(): Partial<ExtensionSettings> {
    const hostInput = document.getElementById('ollama-host') as HTMLInputElement | null;
    const timeoutInput = document.getElementById('conn-timeout') as HTMLInputElement | null;
    const primarySelect = document.getElementById('active-model') as HTMLSelectElement | null;
    const systemPrompt = document.getElementById('system-prompt') as HTMLTextAreaElement | null;
    const streamResponses = document.getElementById('stream-responses') as HTMLInputElement | null;
    const debugModeEl = document.getElementById('debug-mode') as HTMLInputElement | null;

    return {
      ollamaHost: hostInput?.value.trim() || OLLAMA_HOST,
      connTimeout: parseInt(timeoutInput?.value || '', 10) || DEFAULT_CONN_TIMEOUT,
      activeModel: primarySelect?.value || '',
      systemPrompt: systemPrompt?.value || '',
      streamResponses: streamResponses ? streamResponses.checked : true,
      memory,
      debugMode: debugModeEl ? debugModeEl.checked : false,
      modelParams: params,
    };
  }

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const settingsData = getSettingsFromForm();

    // A patch rather than a replace: this page knows nothing about theme.
    const response = await patchSettings(settingsData);

    if (response.success) {
      showToast_('Settings saved');
    } else {
      console.error('[Model] save failed:', response.error);
      showToast_('Could not save settings', 'error');
    }
  });

  resetBtn?.addEventListener('click', async () => {
    applySettingsToForm(DEFAULT_SETTINGS);

    // Reset is the one case where replacing wholesale is the intent.
    params = (DEFAULT_SETTINGS.modelParams ?? {}) as ParamValues;
    paramsUi?.setValues(params);

    memory = { ...DEFAULT_MEMORY };
    memoryUi?.setValues(memory);

    const response = await replaceSettings(DEFAULT_SETTINGS);

    if (response.success) {
      showToast_('Defaults restored');
    } else {
      console.error('[Model] reset failed:', response.error);
      showToast_('Could not reset settings', 'error');
    }
  });
});
