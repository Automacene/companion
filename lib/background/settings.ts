import { DEFAULT_SETTINGS } from '../constants';
import type { ExtensionSettings } from '../../types/state';

/**
 * Reads and writes the one settings object in `browser.storage.local`.
 *
 * WHY THERE ARE TWO WRITE METHODS. Settings are edited from two separate pages
 * now — model configuration on the options page, appearance on the theme page.
 * Each page only knows about its own half. If both wrote the whole object, the
 * last one to save would erase whatever the other had changed, and the user
 * would find their host URL reset after picking a colour.
 *
 * So `patch` is the normal path and merges. `replace` overwrites wholesale and
 * exists for "reset to defaults", where erasing really is the intent.
 */
export class SettingsManager {
  /**
   * Current settings, with a default filled in for anything absent.
   *
   * Field by field rather than a spread, so a key that was removed from the
   * type but still sits in storage does not travel back into the app.
   */
  public async getSettings(): Promise<ExtensionSettings> {
    try {
      const result = await browser.storage.local.get(['extensionSettings']);
      const saved = (result.extensionSettings || {}) as Partial<ExtensionSettings>;

      return {
        // Appearance
        theme: saved.theme ?? DEFAULT_SETTINGS.theme,
        themeOverrides: saved.themeOverrides ?? DEFAULT_SETTINGS.themeOverrides,
        backdrop: saved.backdrop ?? DEFAULT_SETTINGS.backdrop,

        // Model configuration
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
   * Merge a partial update over what is already stored.
   *
   * Shallow on purpose. `themeOverrides` and `backdrop` are replaced whole
   * rather than deep-merged, because a caller removing an override needs the
   * removal to stick — a deep merge would have no way to express deletion.
   *
   * @returns the settings as they now stand, so a caller can act on the result
   *   without a second read
   */
  public async patchSettings(update: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const current = await this.getSettings();
    const merged = { ...current, ...update };

    await browser.storage.local.set({ extensionSettings: merged });
    return merged;
  }

  /**
   * Overwrite the stored settings entirely. Anything absent from `newSettings`
   * falls back to its default on the next read, which is what makes this the
   * right call for "reset to defaults" and the wrong one for everything else.
   */
  public async replaceSettings(newSettings: ExtensionSettings): Promise<void> {
    await browser.storage.local.set({ extensionSettings: newSettings });
  }

  /**
   * @deprecated Use {@link patchSettings}. Kept so an older caller that still
   * hands over a full object keeps working, since replacing with a complete
   * object is harmless.
   */
  public async saveSettings(newSettings: ExtensionSettings): Promise<void> {
    await this.replaceSettings(newSettings);
  }

  /**
   * Subscribe to settings changes.
   *
   * This is what makes the theme page's live preview work across documents: the
   * sidepanel and the theme page share no DOM, but they share storage, so an
   * edit in one repaints the other.
   */
  public onSettingsChanged(callback: (newSettings: Partial<ExtensionSettings>) => void): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.extensionSettings?.newValue) {
        callback(changes.extensionSettings.newValue);
      }
    });
  }
}
