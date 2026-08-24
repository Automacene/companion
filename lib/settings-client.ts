/**
 * Reading and writing settings from a page.
 *
 * The background worker owns settings, but a page needs them before it can
 * paint, and waking the worker to ask costs a round trip on every open. Reading
 * `browser.storage.local` directly is the same data with none of that.
 *
 * Writes still go through the worker, because a write has to reach live tab
 * sessions as well as storage.
 */
import { DEFAULT_SETTINGS } from './constants';
import { askWorker } from './worker-client';
import { PortAction } from '../types/actions';
import type { ExtensionSettings } from '../types/state';

/**
 * Current settings, defaults filled in.
 *
 * Never rejects. A page that cannot read its settings should open with the
 * defaults rather than not open, so a corrupt value cannot lock somebody out
 * of the panel that would let them fix it.
 */
export async function readSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await browser.storage.local.get(['extensionSettings']);
    const saved = (stored.extensionSettings ?? {}) as Partial<ExtensionSettings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (error) {
    console.warn('[settings] falling back to defaults:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export interface WriteResult {
  success: boolean;
  settings?: ExtensionSettings;
  error?: string;
}

/**
 * Merge a partial update.
 *
 * The normal write. Settings are edited on two pages that each know only their
 * own half, so a full write from either would erase the other's fields.
 *
 * Goes through the background worker because a change to the model, host, or
 * system prompt has to reach the conversations already live in open tabs, and
 * only the worker holds those.
 */
export async function patchSettings(update: Partial<ExtensionSettings>): Promise<WriteResult> {
  return send(PortAction.PATCH_SETTINGS, update);
}

/** Keys that only affect how things look, never how the model behaves. */
const APPEARANCE_KEYS = ['theme', 'themeOverrides', 'backdrop'] as const;

/**
 * Merge an appearance-only update, writing straight to storage.
 *
 * Appearance touches no conversation state, so involving the worker buys
 * nothing and costs a wake-up plus a round trip on every frame of a dragged
 * slider. Writing directly also means a worker that is slow to start, has
 * crashed, or is mid-reload cannot stop somebody changing a colour.
 *
 * Every surface still finds out, because they all listen to
 * `browser.storage.onChanged` rather than to the worker.
 *
 * @throws never — failures come back on the result
 */
export async function patchAppearance(
  update: Partial<ExtensionSettings>
): Promise<WriteResult> {
  const offLimits = Object.keys(update).filter(
    (key) => !APPEARANCE_KEYS.includes(key as (typeof APPEARANCE_KEYS)[number])
  );

  if (offLimits.length > 0) {
    // A guard rather than a silent pass-through: writing a model setting this
    // way would skip the sessions that need to hear about it, and the symptom
    // would be a setting that looks saved but does nothing until reload.
    return {
      success: false,
      error: `${offLimits.join(', ')} must go through patchSettings, not patchAppearance`,
    };
  }

  try {
    const stored = await browser.storage.local.get(['extensionSettings']);
    const current = (stored.extensionSettings ?? {}) as Partial<ExtensionSettings>;
    const merged = { ...current, ...update } as ExtensionSettings;

    await browser.storage.local.set({ extensionSettings: merged });
    return { success: true, settings: merged };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Could not write to extension storage',
    };
  }
}

/**
 * Replace every setting. Only correct for "reset to defaults", where losing
 * what is not mentioned is the point.
 */
export async function replaceSettings(settings: ExtensionSettings): Promise<WriteResult> {
  return send(PortAction.SAVE_SETTINGS, settings);
}

async function send(action: string, settings: unknown): Promise<WriteResult> {
  try {
    /*
      Through `askWorker` because a settings page is usually opened cold, and a
      cold worker drops the first message without reporting anything. That made
      a write vanish in the worst possible way: storage was never touched, the
      page had no error to show, and the form still displayed the value the user
      had just typed. It looked saved.
    */
    const response = await askWorker<WriteResult>({ action, settings });

    if (!response.success) {
      return { success: false, error: response.error ?? 'No response from background worker' };
    }

    return response;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reach background worker',
    };
  }
}
