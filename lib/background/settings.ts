import { 
  OLLAMA_HOST, 
  DEFAULT_ACTIVE_MODEL, 
  DEFAULT_SYSTEM_PROMPT, 
  DEFAULT_CONN_TIMEOUT 
} from '../constants';
import type { ExtensionSettings } from '../../types/state';

export class SettingsManager {
  /**
   * Retrieves the current extension settings merged with default fallbacks.
   */
  public async getSettings(): Promise<ExtensionSettings> {
    try {
      const result = await browser.storage.local.get(['extensionSettings']);
      const saved = (result.extensionSettings || {}) as Partial<ExtensionSettings>;

      return {
        ollamaHost: saved.ollamaHost || OLLAMA_HOST,
        connTimeout: saved.connTimeout || DEFAULT_CONN_TIMEOUT,
        activeModel: saved.activeModel || DEFAULT_ACTIVE_MODEL,
        fallbackModel: saved.fallbackModel || '',
        systemPrompt: saved.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        streamResponses: saved.streamResponses ?? true,
      };
    } catch {
      return {
        ollamaHost: OLLAMA_HOST,
        connTimeout: DEFAULT_CONN_TIMEOUT,
        activeModel: DEFAULT_ACTIVE_MODEL,
        fallbackModel: '',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        streamResponses: true,
      };
    }
  }

  /**
   * Saves updated extension settings into local storage.
   */
  public async saveSettings(newSettings: ExtensionSettings): Promise<void> {
    await browser.storage.local.set({ extensionSettings: newSettings });
  }

  /**
   * Subscribes to storage changes so active sessions can sync instantly.
   */
  public onSettingsChanged(callback: (newSettings: Partial<ExtensionSettings>) => void): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.extensionSettings?.newValue) {
        callback(changes.extensionSettings.newValue);
      }
    });
  }
}