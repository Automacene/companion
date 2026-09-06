/**
 * User token overrides.
 *
 * A theme is a palette file, which is code, added at build time. An override is
 * a value a user typed, which is data, stored in `browser.storage.local`. This
 * module is the whole of the second one.
 *
 * Overrides are written as inline custom properties on `<html>`. That beats any
 * stylesheet rule without needing `!important`, and it layers over whichever
 * palette is currently active rather than replacing it - so an override of the
 * accent survives switching between light and dark, while everything the user
 * did not touch keeps following the theme.
 */
import { TOKENS_BY_NAME, type TokenDefinition } from './manifest.generated';
import type { Theme } from './index';

/**
 * What a user has changed, keyed by custom property name.
 *
 * Values are stored per theme, because an accent that reads well on #fcfcfc is
 * usually wrong on #111113. A token the user only customised in one theme keeps
 * the palette default in the other.
 */
export type ThemeOverrides = Partial<Record<Theme, Record<string, string>>>;

/**
 * A theme someone can export, send to somebody else, and import.
 *
 * `extends` names the palette the overrides sit on top of, so a shared theme
 * that only changes two colours stays two lines rather than carrying a full
 * copy of every token.
 */
export interface ThemePackage {
  /** Format version, so an old export can be migrated rather than rejected. */
  version: 1;
  name: string;
  author?: string;
  extends: Theme;
  overrides: ThemeOverrides;
}

/** Nothing customised. */
export const EMPTY_OVERRIDES: ThemeOverrides = {};

/**
 * Values a stylesheet would reject are worth catching here rather than letting
 * the browser silently drop the declaration, which looks like the editor is
 * broken. `CSS.supports` asks the actual engine instead of guessing with a
 * regex, so it stays correct as colour syntax grows.
 */
export function isValidValue(token: TokenDefinition, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;

  // A custom property accepts almost anything.
  const probe: Record<string, string> = {
    color: 'color',
    length: 'width',
    duration: 'transition-duration',
    number: 'line-height',
    font: 'font-family',
    shadow: 'box-shadow',
    filter: 'filter',
    easing: 'transition-timing-function',
  };

  const property = probe[token.kind];
  if (!property) return true; // no meaningful check for this kind

  return CSS.supports(property, trimmed);
}

/**
 * Drop anything that no longer corresponds to a real token, or whose value the
 * browser will not accept.
 *
 * Stored overrides outlive the tokens they name. A user who customised
 * `--ac-color-panel` before it was renamed should not have that value follow
 * them around forever, invisible and unreachable from the editor.
 */
export function pruneOverrides(overrides: ThemeOverrides): ThemeOverrides {
  const pruned: ThemeOverrides = {};

  for (const [theme, values] of Object.entries(overrides) as [Theme, Record<string, string>][]) {
    if (!values) continue;

    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      const token = TOKENS_BY_NAME.get(name);
      if (!token || !token.editable) continue;
      if (!isValidValue(token, value)) continue;
      kept[name] = value;
    }

    if (Object.keys(kept).length > 0) pruned[theme] = kept;
  }

  return pruned;
}

/**
 * Write the overrides for one theme onto an element, and remove any that are no
 * longer set.
 *
 * Clearing matters as much as setting. Without it, unsetting a token in the
 * editor would leave the old inline value behind and the control would appear
 * to do nothing.
 *
 * @param root  usually `document.documentElement`
 */
export function applyOverrides(root: HTMLElement, theme: Theme, overrides: ThemeOverrides): void {
  const values = overrides[theme] ?? {};

  // Remove first, so a token dropped from the overrides goes back to the.
  for (const token of TOKENS_BY_NAME.values()) {
    if (!(token.name in values)) root.style.removeProperty(token.name);
  }

  for (const [name, value] of Object.entries(values)) {
    root.style.setProperty(name, value);
  }
}

/** Whether a user has changed anything at all under a theme. */
export function hasOverrides(overrides: ThemeOverrides, theme: Theme): boolean {
  return Object.keys(overrides[theme] ?? {}).length > 0;
}

/**
 * Set one token, or clear it when `value` is null.
 *
 * Returns a new object rather than mutating, so a caller holding the previous
 * overrides can compare against it.
 */
export function setOverride(
  overrides: ThemeOverrides,
  theme: Theme,
  name: string,
  value: string | null,
): ThemeOverrides {
  const forTheme = { ...(overrides[theme] ?? {}) };

  if (value === null) delete forTheme[name];
  else forTheme[name] = value;

  const next: ThemeOverrides = { ...overrides };
  if (Object.keys(forTheme).length > 0) next[theme] = forTheme;
  else delete next[theme];

  return next;
}

/** Clear every override under one theme, leaving other themes alone. */
export function clearTheme(overrides: ThemeOverrides, theme: Theme): ThemeOverrides {
  const next: ThemeOverrides = { ...overrides };
  delete next[theme];
  return next;
}

/**
 * Wrap overrides for export.
 */
export function toPackage(
  name: string,
  extendsTheme: Theme,
  overrides: ThemeOverrides,
  author?: string,
): ThemePackage {
  return {
    version: 1,
    name: name.trim() || 'Untitled theme',
    ...(author ? { author } : {}),
    extends: extendsTheme,
    overrides: pruneOverrides(overrides),
  };
}

/**
 * Read an exported theme back.
 *
 * Anything unrecognised is dropped rather than throwing, because the file came
 * from outside and a half-valid theme is more useful than an error.
 *
 * @returns the package, or null if the text is not a theme at all
 */
export function fromPackage(text: string): ThemePackage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const candidate = parsed as Partial<ThemePackage>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.overrides !== 'object' || candidate.overrides === null) return null;

  const extendsTheme: Theme = candidate.extends === 'dark' ? 'dark' : 'light';

  return {
    version: 1,
    name: typeof candidate.name === 'string' ? candidate.name : 'Imported theme',
    ...(typeof candidate.author === 'string' ? { author: candidate.author } : {}),
    extends: extendsTheme,
    overrides: pruneOverrides(candidate.overrides as ThemeOverrides),
  };
}
