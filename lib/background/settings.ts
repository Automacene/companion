import { 
  DEFAULT_SETTINGS
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
        ollamaHost: saved.ollamaHost ?? DEFAULT_SETTINGS.ollamaHost,
        connTimeout: saved.connTimeout ?? DEFAULT_SETTINGS.connTimeout,
        keepAlive: saved.keepAlive ?? DEFAULT_SETTINGS.keepAlive,
        activeModel: saved.activeModel ?? DEFAULT_SETTINGS.activeModel,
        fallbackModel: saved.fallbackModel ?? DEFAULT_SETTINGS.fallbackModel,
        systemPrompt: saved.systemPrompt ?? DEFAULT_SETTINGS.systemPrompt,
        streamResponses: saved.streamResponses ?? DEFAULT_SETTINGS.streamResponses,
        temperature: saved.temperature ?? DEFAULT_SETTINGS.temperature,
        numCtx: saved.numCtx ?? DEFAULT_SETTINGS.numCtx,
        numPredict: saved.numPredict ?? DEFAULT_SETTINGS.numPredict,
        topP: saved.topP ?? DEFAULT_SETTINGS.topP,
        topK: saved.topK ?? DEFAULT_SETTINGS.topK,
        repeatPenalty: saved.repeatPenalty ?? DEFAULT_SETTINGS.repeatPenalty,
        maxMemory: saved.maxMemory ?? DEFAULT_SETTINGS.maxMemory,
        stopSeq: saved.stopSeq ?? DEFAULT_SETTINGS.stopSeq,
        rawMode: saved.rawMode ?? DEFAULT_SETTINGS.rawMode,
        debugMode: saved.debugMode ?? DEFAULT_SETTINGS.debugMode,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
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