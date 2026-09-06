/**
 * Appearance bootstrap, shared by every surface.
 *
 * The sidepanel, the options page, and the theme page are three separate
 * documents that share no DOM. Each has to apply the theme, the user's token
 * overrides, and the backdrop for itself. Doing that in three places is how
 * they drift, so it happens here once.
 *
 * They do share `browser.storage.local`, which is what makes live preview work
 * without any messaging: the theme page writes, storage fires, and every open
 * surface repaints itself.
 */
import { mountBackdrop, type BackdropHandle } from './backdrop';
import { applyOverrides, pruneOverrides, type ThemeOverrides } from './theme/overrides';
import {
  DEFAULT_THEME_PREFERENCE,
  applyTheme,
  isThemePreference,
  resolveTheme,
  type Theme,
  type ThemePreference,
} from './theme';
import type { ExtensionSettings } from '../types/state';

export interface AppearanceOptions {
  /** The `.ac-backdrop__layer` element, if this surface has one. */
  backdropContainer?: HTMLElement | null;
  /**
   * Whether to follow later settings changes. On by default, which is what
   * gives the sidepanel live preview while the theme page is being used.
   */
  live?: boolean;
}

export interface AppearanceHandle {
  /** The backdrop, or a no-op handle when the surface has none. */
  readonly backdrop: BackdropHandle;
  /** The theme currently applied, with `system` already resolved. */
  readonly theme: Theme;
  /** Apply a settings object immediately, without waiting for storage. */
  apply(settings: ExtensionSettings): void;
  /** Stop following storage and tear the backdrop down. */
  destroy(): void;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function preferenceOf(settings: ExtensionSettings): ThemePreference {
  return isThemePreference(settings.theme) ? settings.theme : DEFAULT_THEME_PREFERENCE;
}

function overridesOf(settings: ExtensionSettings): ThemeOverrides {
  return pruneOverrides((settings.themeOverrides ?? {}) as ThemeOverrides);
}

/**
 * Apply appearance settings to this document and keep them applied.
 *
 * Call as early as possible. Everything visual is a custom property, so the
 * first paint after this uses the right palette and nothing flashes.
 */
export function startAppearance(
  settings: ExtensionSettings,
  { backdropContainer = null, live = true }: AppearanceOptions = {},
): AppearanceHandle {
  const root = document.documentElement;

  let preference = preferenceOf(settings);
  let theme = applyTheme(preference);
  applyOverrides(root, theme, overridesOf(settings));

  const backdrop = mountBackdrop(backdropContainer, settings.backdrop as never);

  // While the preference is `system`, the OS can change underneath us.
  const darkQuery = matchMedia(DARK_QUERY);

  const onSystemChange = () => {
    if (preference !== 'system') return;
    theme = applyTheme('system');
    applyOverrides(root, theme, overridesOf(settings));
    backdrop.refreshTheme();
  };

  darkQuery.addEventListener('change', onSystemChange);

  const apply = (next: ExtensionSettings) => {
    settings = next;
    preference = preferenceOf(next);
    theme = applyTheme(preference);

    applyOverrides(root, theme, overridesOf(next));

    // Order matters: the palette.
    backdrop.refreshTheme();
    backdrop.update(next.backdrop as never);
  };

  const onStorageChange = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName !== 'local') return;
    const updated = changes.extensionSettings?.newValue as ExtensionSettings | undefined;
    if (updated) apply(updated);
  };

  if (live) browser.storage.onChanged.addListener(onStorageChange);

  return {
    backdrop,
    get theme() {
      return theme;
    },
    apply,
    destroy() {
      darkQuery.removeEventListener('change', onSystemChange);
      if (live) browser.storage.onChanged.removeListener(onStorageChange);
      backdrop.destroy();
    },
  };
}

/**
 * The theme a settings object resolves to, without applying anything.
 * The theme editor needs this to know which half of the overrides it is editing.
 */
export function themeOf(settings: ExtensionSettings): Theme {
  return resolveTheme(preferenceOf(settings));
}
