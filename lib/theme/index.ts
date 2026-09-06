/**
 * Theme resolution and application.
 *
 * A theme is a set of custom property values in `styles/tokens/`, selected by a
 * `data-theme` attribute on the document root. This module is the only thing that
 * writes that attribute.
 *
 * `system` is resolved here rather than in CSS on purpose. Handling it with a
 * `prefers-color-scheme` query would mean every palette appeared twice - once
 * inside the query and once for the explicit choice - and the two copies would
 * drift the first time a token was added to one of them.
 */

/**
 * Themes with a palette file. Adding one means adding
 * `styles/tokens/palette-<name>.css`, importing it from `styles/index.css`, and
 * listing it here.
 */
export const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

/** What a user can choose, including deferring to the OS. */
export type ThemePreference = Theme | 'system';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Narrow an unknown stored value to a preference, falling back to the default.
 * Settings come out of `browser.storage.local`, so the value on disk may predate
 * a rename or have been edited by hand.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || THEMES.includes(value as Theme);
}

/**
 * Turn a preference into the concrete theme to apply.
 */
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Stamp a theme onto the document. Safe to call repeatedly.
 *
 * Must run on every surface, because the sidepanel and the options page are
 * separate documents that share no DOM.
 */
export function applyTheme(preference: ThemePreference): Theme {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  return theme;
}

/**
 * Apply a preference and keep it applied.
 *
 * While the preference is `system`, the OS can change underneath us, so the
 * media query is watched and the attribute rewritten. Any other preference
 * needs no listener.
 *
 * @returns a function that stops watching
 */
export function watchTheme(preference: ThemePreference): () => void {
  applyTheme(preference);

  if (preference !== 'system') return () => {};

  const query = matchMedia(DARK_QUERY);
  const onChange = () => applyTheme('system');

  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
