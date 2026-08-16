/**
 * Appearance page.
 *
 * Every control here writes to storage immediately. There is no save button on
 * purpose: the sidepanel is listening to the same storage, so a change lands in
 * the open panel while you watch. A save button would put a gap between doing
 * the thing and seeing it, which is the only interesting part of this page.
 *
 * Nothing here knows the token list. It is generated from `styles/tokens/` by
 * `scripts/generate-token-manifest.mjs`, so adding a token to the CSS adds a
 * control here with no edit to this file.
 */
import '../../styles/index.css';
import './theme.css';

import { startAppearance, themeOf } from '../../lib/appearance';
import { readSettings, patchAppearance } from '../../lib/settings-client';
import {
  EDITABLE_TOKENS,
  TOKEN_GROUPS,
  defaultValue,
  type TokenDefinition,
} from '../../lib/theme/manifest.generated';
import {
  clearTheme,
  fromPackage,
  isValidValue,
  setOverride,
  toPackage,
  type ThemeOverrides,
} from '../../lib/theme/overrides';
import { THEMES, type Theme, type ThemePreference } from '../../lib/theme';
import {
  CUSTOM_RAMP_ID,
  DEFAULT_CUSTOM_RAMP,
  LIMITS,
  PRESETS,
  RAMPS,
  RAMP_LIMITS,
  getPreset,
  isValidRamp,
  listMasks,
  normalizeRamp,
  resolveBackdrop,
  resolveRamp,
  type BackdropConfig,
} from '../../lib/backdrop';
import { buildControl, type ControlElement } from './controls';
import type { ExtensionSettings } from '../../types/state';

/** Theme choices, in the order the picker shows them. */
const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  ...THEMES.map((name) => ({
    value: name as ThemePreference,
    label: name.charAt(0).toUpperCase() + name.slice(1),
  })),
];

/** The numeric backdrop controls, and how each one reads. */
const SLIDERS: {
  key: keyof Pick<BackdropConfig, 'intensity' | 'cell' | 'accentAt' | 'fps' | 'speed'>;
  label: string;
  hint: string;
  format: (value: number) => string;
}[] = [
  {
    key: 'intensity',
    label: 'Intensity',
    hint: 'How bright the brightest character gets.',
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: 'cell',
    label: 'Character size',
    hint: 'Smaller is denser and costs more.',
    format: (value) => `${value} px`,
  },
  {
    key: 'accentAt',
    label: 'Accent threshold',
    hint: 'Brightness at which a character picks up the accent colour. All the way right turns it off.',
    format: (value) => (value > 1 ? 'never' : `${Math.round(value * 100)}%`),
  },
  {
    key: 'fps',
    label: 'Frame rate',
    hint: 'Lower is calmer and easier on a battery.',
    format: (value) => `${value} fps`,
  },
  {
    key: 'speed',
    label: 'Speed',
    hint: 'Zero freezes the field without removing it.',
    format: (value) => (value === 0 ? 'frozen' : `${value.toFixed(2)}×`),
  },
];

document.addEventListener('DOMContentLoaded', async () => {
  let settings: ExtensionSettings = await readSettings();

  const appearance = startAppearance(settings, {
    backdropContainer: document.getElementById('backdrop-layer'),
    // This page is the one writing, so it applies its own changes directly
    // rather than waiting for them to come back around through storage.
    live: false,
  });

  /** The theme whose overrides are being edited: `system` already resolved. */
  let editing: Theme = themeOf(settings);

  const toast = document.getElementById('save-toast');
  let toastTimer: number | undefined;

  function flash(message: string, kind: 'ok' | 'error' = 'ok'): void {
    if (!toast) return;
    toast.textContent = message;
    toast.className = `ac-toast ac-toast--${kind === 'ok' ? 'success' : 'error'} is-visible`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.className = 'ac-toast';
    }, 1600);
  }

  /**
   * Write, then apply locally.
   *
   * Applying rather than waiting for the storage event keeps a slider smooth:
   * the round trip through the worker is fast but not free, and dragging fires
   * this on every frame.
   */
  async function commit(update: Partial<ExtensionSettings>): Promise<void> {
    settings = { ...settings, ...update };
    appearance.apply(settings);

    const result = await patchAppearance(update);
    if (!result.success) {
      // The real message, not a generic one. This page has no other way to
      // tell you what went wrong, and "could not save" is unactionable.
      console.error('[Theme] save failed:', result.error);
      flash(result.error ?? 'Could not save', 'error');
    }
  }

  function overrides(): ThemeOverrides {
    return (settings.themeOverrides ?? {}) as ThemeOverrides;
  }

  function currentBackdrop(): BackdropConfig {
    return resolveBackdrop(settings.backdrop as never);
  }

  // ── Theme picker ───────────────────────────────────────────────

  const themePicker = document.getElementById('theme-picker');

  function renderThemePicker(): void {
    if (!themePicker) return;
    themePicker.replaceChildren();

    for (const choice of THEME_CHOICES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ac-segmented__option';
      button.textContent = choice.label;
      button.setAttribute('aria-pressed', String(settings.theme === choice.value));

      button.addEventListener('click', async () => {
        await commit({ theme: choice.value });
        editing = themeOf(settings);
        renderThemePicker();
        renderTokens();
      });

      themePicker.appendChild(button);
    }
  }

  // ── Backdrop ───────────────────────────────────────────────────

  const presetSelect = document.getElementById('backdrop-preset') as HTMLSelectElement | null;
  const presetHint = document.getElementById('backdrop-preset-hint');
  const maskSelect = document.getElementById('backdrop-mask') as HTMLSelectElement | null;
  const maskHint = document.getElementById('backdrop-mask-hint');
  const rampSelect = document.getElementById('backdrop-ramp') as HTMLSelectElement | null;
  const rampPreview = document.getElementById('backdrop-ramp-preview');
  const customRampField = document.getElementById('custom-ramp-field');
  const customRampInput = document.getElementById('backdrop-custom-ramp') as HTMLInputElement | null;
  const sliderHost = document.getElementById('backdrop-sliders');

  function fillSelect(
    select: HTMLSelectElement | null,
    items: { value: string; label: string }[],
    selected: string
  ): void {
    if (!select) return;
    select.replaceChildren();
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
    select.value = selected;
  }

  /** Change one tuned value, leaving the preset name alone. */
  async function tune(patch: Partial<BackdropConfig>): Promise<void> {
    const preset = settings.backdrop?.preset ?? 'flow';
    const custom = { ...(settings.backdrop?.custom ?? {}), ...patch };
    await commit({ backdrop: { preset, custom } as never });
  }

  function renderBackdrop(): void {
    const config = currentBackdrop();
    const presetId = settings.backdrop?.preset ?? 'flow';

    fillSelect(
      presetSelect,
      PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
      presetId
    );
    if (presetHint) presetHint.textContent = getPreset(presetId).description;

    const masks = listMasks();
    fillSelect(
      maskSelect,
      masks.map((mask) => ({ value: mask.id, label: mask.label })),
      config.mask
    );
    if (maskHint) {
      maskHint.textContent = masks.find((mask) => mask.id === config.mask)?.description ?? '';
    }

    fillSelect(
      rampSelect,
      [
        ...RAMPS.map((ramp) => ({ value: ramp.id, label: ramp.label })),
        { value: CUSTOM_RAMP_ID, label: 'Custom…' },
      ],
      config.ramp
    );

    const usingCustom = config.ramp === CUSTOM_RAMP_ID;
    if (customRampField) customRampField.hidden = !usingCustom;

    // Only overwrite the box when it is not being typed in, or a re-render
    // triggered by something else would yank the cursor out mid-word.
    if (customRampInput && document.activeElement !== customRampInput) {
      customRampInput.value = config.customRamp ?? '';
    }

    renderRampPreview(config);

    renderSliders(config);
  }

  /**
   * Show the ramp as it will actually be drawn.
   *
   * Spaces are rendered as `·` because a run of them is the difference between
   * a sparse field and a solid block, and in a proportional hint they would be
   * invisible.
   */
  function renderRampPreview(config: BackdropConfig): void {
    if (!rampPreview) return;

    const characters = resolveRamp(config.ramp, config.customRamp);
    const shown = characters.map((character) => (character === ' ' ? '·' : character)).join('');

    rampPreview.textContent = `dark → light   ${shown}   (${characters.length})`;
  }

  function renderSliders(config: BackdropConfig): void {
    if (!sliderHost) return;
    sliderHost.replaceChildren();

    for (const slider of SLIDERS) {
      const limits = LIMITS[slider.key];
      const value = config[slider.key];

      const wrapper = document.createElement('div');
      wrapper.className = 'ac-field';

      const head = document.createElement('div');
      head.className = 'theme-page__slider-head';

      const label = document.createElement('label');
      label.className = 'ac-field__label';
      label.htmlFor = `backdrop-${slider.key}`;
      label.textContent = slider.label;

      const readout = document.createElement('span');
      readout.className = 'theme-page__slider-value ac-mono';
      readout.textContent = slider.format(value);

      head.append(label, readout);

      const input = document.createElement('input');
      input.type = 'range';
      input.id = `backdrop-${slider.key}`;
      input.className = 'ac-range';
      input.min = String(limits.min);
      input.max = String(limits.max);
      input.step = String(limits.step);
      input.value = String(value);

      // `input` updates the readout and the live field on every frame of a
      // drag; the write is left to `change`, when the drag ends, so a single
      // gesture is one storage write rather than a hundred.
      input.addEventListener('input', () => {
        const next = Number(input.value);
        readout.textContent = slider.format(next);
        appearance.backdrop.update({
          preset: settings.backdrop?.preset ?? 'flow',
          custom: { ...(settings.backdrop?.custom ?? {}), [slider.key]: next },
        } as never);
      });

      input.addEventListener('change', () => {
        void tune({ [slider.key]: Number(input.value) } as Partial<BackdropConfig>);
      });

      const hint = document.createElement('p');
      hint.className = 'ac-field__hint';
      hint.textContent = slider.hint;

      wrapper.append(head, input, hint);
      sliderHost.appendChild(wrapper);
    }
  }

  presetSelect?.addEventListener('change', async () => {
    // Switching preset drops the tuning, because the tuned values belonged to
    // the preset that was there before and mostly make the new one look wrong.
    await commit({ backdrop: { preset: presetSelect.value } as never });
    renderBackdrop();
  });

  maskSelect?.addEventListener('change', async () => {
    await tune({ mask: maskSelect.value });
    renderBackdrop();
  });

  rampSelect?.addEventListener('change', async () => {
    const picked = rampSelect.value;

    // Picking Custom for the first time seeds the box, so it opens with
    // something editable rather than empty and drawing nothing.
    if (picked === CUSTOM_RAMP_ID && !currentBackdrop().customRamp) {
      await tune({ ramp: picked, customRamp: DEFAULT_CUSTOM_RAMP });
    } else {
      await tune({ ramp: picked });
    }

    renderBackdrop();
    if (picked === CUSTOM_RAMP_ID) customRampInput?.focus();
  });

  // Typing previews live but does not save, matching the sliders and the
  // colour swatches: one gesture is one write, on the way out.
  customRampInput?.addEventListener('input', () => {
    const typed = normalizeRamp(customRampInput.value);
    const usable = isValidRamp(typed);

    customRampInput.classList.toggle('is-invalid', !usable);

    const config = { ...currentBackdrop(), ramp: CUSTOM_RAMP_ID, customRamp: typed };
    renderRampPreview(config);

    // Below two characters there is no dark-to-light to draw, so the field
    // falls back rather than flickering to nothing while somebody is mid-type.
    if (!usable) return;

    appearance.backdrop.update({
      preset: settings.backdrop?.preset ?? 'flow',
      custom: { ...(settings.backdrop?.custom ?? {}), ramp: CUSTOM_RAMP_ID, customRamp: typed },
    } as never);
  });

  customRampInput?.addEventListener('change', async () => {
    const typed = normalizeRamp(customRampInput.value);

    if (!isValidRamp(typed)) {
      flash(`Needs at least ${RAMP_LIMITS.min} characters, darkest first`, 'error');
      return;
    }

    customRampInput.classList.remove('is-invalid');
    await tune({ ramp: CUSTOM_RAMP_ID, customRamp: typed });
    renderRampPreview(currentBackdrop());
  });

  document.getElementById('reset-backdrop')?.addEventListener('click', async () => {
    await commit({ backdrop: { preset: settings.backdrop?.preset ?? 'flow' } as never });
    renderBackdrop();
    flash('Backdrop reset');
  });

  // ── Tokens ─────────────────────────────────────────────────────

  const tokenHost = document.getElementById('token-groups');
  const searchInput = document.getElementById('token-search') as HTMLInputElement | null;
  const tokenCount = document.getElementById('token-count');

  function matches(token: TokenDefinition, query: string): boolean {
    if (!query) return true;
    const haystack = `${token.name} ${token.label} ${token.group}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function renderTokens(): void {
    if (!tokenHost) return;
    tokenHost.replaceChildren();

    const query = searchInput?.value.trim() ?? '';
    const active = overrides()[editing] ?? {};
    let shown = 0;

    for (const group of TOKEN_GROUPS) {
      const tokens = EDITABLE_TOKENS.filter(
        (token) => token.group === group && matches(token, query)
      );
      if (tokens.length === 0) continue;

      const section = document.createElement('details');
      section.className = 'theme-page__token-group';
      section.dataset.group = group;

      // Colours open by default because that is what people came for; the rest
      // stay shut so the page is scannable. A search opens everything, since a
      // hit hidden inside a collapsed group reads as no result at all.
      section.open = query !== '' || group === 'Colours';

      const summary = document.createElement('summary');
      summary.className = 'theme-page__token-summary';

      const name = document.createElement('span');
      name.textContent = group;

      const changed = tokens.filter((token) => token.name in active).length;
      const meta = document.createElement('span');
      meta.className = 'theme-page__token-meta ac-mono';
      meta.textContent = changed > 0 ? `${changed} changed` : `${tokens.length}`;

      summary.append(name, meta);
      section.appendChild(summary);

      for (const token of tokens) {
        section.appendChild(renderToken(token, active[token.name]));
        shown++;
      }

      tokenHost.appendChild(section);
    }

    if (tokenCount) {
      const changedTotal = Object.keys(active).length;
      tokenCount.textContent = `${shown} shown · ${changedTotal} changed in ${editing}`;
    }
  }

  function renderToken(token: TokenDefinition, override: string | undefined): HTMLElement {
    const fallback = defaultValue(token, editing);
    const value = override ?? fallback;

    const row = document.createElement('div');
    row.className = 'theme-page__token';
    if (override !== undefined) row.classList.add('is-changed');

    const label = document.createElement('label');
    label.className = 'theme-page__token-label';
    label.htmlFor = `token-${token.name}`;
    label.textContent = token.label;
    if (token.description) label.title = token.description;

    const controls = document.createElement('div');
    controls.className = 'theme-page__token-controls';

    const revert = document.createElement('button');
    revert.type = 'button';
    revert.className = 'ac-btn ac-btn--ghost theme-page__token-revert';
    revert.textContent = 'Revert';
    revert.disabled = override === undefined;

    // The text box always exists and is always authoritative. The friendly
    // control is a second way to reach the same value, not a replacement — so
    // anything the control cannot express is still editable.
    const text = document.createElement('input');
    text.type = 'text';
    text.id = `token-${token.name}`;
    text.className = 'ac-input ac-mono theme-page__token-input';
    text.value = value;
    text.spellcheck = false;
    text.placeholder = fallback;

    /**
     * Update this row without rebuilding it.
     *
     * Rebuilding on every write is what used to close the colour picker the
     * instant you clicked a colour: the input owning the open picker was being
     * destroyed. Nothing a live control sits inside may be replaced while that
     * control is in use.
     */
    const settle = (current: string | undefined) => {
      const next = current ?? fallback;
      row.classList.toggle('is-changed', current !== undefined);
      revert.disabled = current === undefined;
      text.value = next;
      text.classList.remove('is-invalid');
      control?.syncTo?.(next);
      refreshCounts();
    };

    const control: ControlElement | null = buildControl({
      token,
      value,
      fallback,
      onPreview: (next) => {
        text.value = next;
        preview(token, next);
      },
      onCommit: (next) => {
        text.value = next;
        void write(token, next, settle);
      },
    });

    if (control) {
      controls.appendChild(control);

      // The text box is the escape hatch, not the front door. Hidden by
      // default so a page of 81 settings reads as controls rather than as a
      // form to fill in.
      const advanced = document.createElement('details');
      advanced.className = 'theme-page__token-advanced';

      const summary = document.createElement('summary');
      summary.className = 'theme-page__token-advanced-summary';
      summary.textContent = 'Exact value';
      summary.title = token.name;

      const body = document.createElement('div');
      body.className = 'theme-page__token-advanced-body';

      const code = document.createElement('code');
      code.className = 'theme-page__token-name';
      code.textContent = token.name;

      body.append(text, code);
      advanced.append(summary, body);
      controls.appendChild(advanced);
    } else {
      // No honest friendly control for this value, so the text box is the
      // control and the custom property name stays visible beside it.
      const code = document.createElement('code');
      code.className = 'theme-page__token-name';
      code.textContent = token.name;

      controls.append(text, code);
      row.classList.add('theme-page__token--raw');
    }

    text.addEventListener('change', () => {
      const next = text.value.trim();

      // Empty, or typed back to the default, means "stop overriding this"
      // rather than "set it to the default" — so the value keeps following the
      // palette if the palette ever changes.
      if (next === '' || next === fallback) {
        text.classList.remove('is-invalid');
        void write(token, null, settle);
        return;
      }

      if (!isValidValue(token, next)) {
        text.classList.add('is-invalid');
        flash(`${token.label}: the browser will not accept that value`, 'error');
        return;
      }

      text.classList.remove('is-invalid');
      void write(token, next, settle);
    });

    revert.addEventListener('click', () => void write(token, null, settle));
    controls.appendChild(revert);

    row.append(label, controls);
    return row;
  }

  /**
   * Paint a value onto the document without saving it.
   *
   * Used while a colour picker is open, so the whole interface responds as you
   * drag. The next write or re-render replaces it; nothing here persists.
   */
  function preview(token: TokenDefinition, value: string): void {
    document.documentElement.style.setProperty(token.name, value);
    appearance.backdrop.refreshTheme();
  }

  /**
   * Update the "n changed" labels in place.
   *
   * Separate from `renderTokens` so a write can refresh the counts without
   * touching the controls, which is what keeps an open picker alive.
   */
  function refreshCounts(): void {
    const active = overrides()[editing] ?? {};

    for (const group of TOKEN_GROUPS) {
      const meta = tokenHost?.querySelector<HTMLElement>(
        `[data-group="${CSS.escape(group)}"] .theme-page__token-meta`
      );
      if (!meta) continue;

      const tokens = EDITABLE_TOKENS.filter((token) => token.group === group);
      const changed = tokens.filter((token) => token.name in active).length;
      meta.textContent = changed > 0 ? `${changed} changed` : `${tokens.length}`;
    }

    if (tokenCount) {
      const shown = tokenHost?.querySelectorAll('.theme-page__token').length ?? 0;
      tokenCount.textContent = `${shown} shown · ${Object.keys(active).length} changed in ${editing}`;
    }
  }

  async function write(
    token: TokenDefinition,
    value: string | null,
    settle: (current: string | undefined) => void
  ): Promise<void> {
    const next = setOverride(overrides(), editing, token.name, value);
    await commit({ themeOverrides: next as never });
    settle(next[editing]?.[token.name]);
  }

  searchInput?.addEventListener('input', renderTokens);

  document.getElementById('reset-tokens')?.addEventListener('click', async () => {
    await commit({ themeOverrides: clearTheme(overrides(), editing) as never });
    renderTokens();
    flash(`Reset everything in ${editing}`);
  });

  // ── Share ──────────────────────────────────────────────────────

  const json = document.getElementById('theme-json') as HTMLTextAreaElement | null;

  document.getElementById('export-theme')?.addEventListener('click', async () => {
    const text = JSON.stringify(toPackage('My theme', editing, overrides()), null, 2);
    if (json) json.value = text;

    try {
      await navigator.clipboard.writeText(text);
      flash('Copied to clipboard');
    } catch {
      // Clipboard access can be refused; the textarea already has the text.
      flash('Copy failed — select the text below instead', 'error');
    }
  });

  document.getElementById('import-theme')?.addEventListener('click', async () => {
    const text = json?.value.trim();
    if (!text) {
      flash('Paste a theme into the box first', 'error');
      return;
    }

    const parsed = fromPackage(text);
    if (!parsed) {
      flash('That is not a theme file', 'error');
      return;
    }

    await commit({
      theme: parsed.extends,
      themeOverrides: { ...overrides(), ...parsed.overrides } as never,
    });

    editing = themeOf(settings);
    renderThemePicker();
    renderTokens();
    flash(`Loaded "${parsed.name}"`);
  });

  // ── Cross-links ────────────────────────────────────────────────

  const optionsLink = document.getElementById('open-options') as HTMLAnchorElement | null;
  if (optionsLink) optionsLink.href = browser.runtime.getURL('/model.html');

  const hubLink = document.getElementById('open-hub') as HTMLAnchorElement | null;
  if (hubLink) hubLink.href = browser.runtime.getURL('/options.html');

  renderThemePicker();
  renderBackdrop();
  renderTokens();
});

/**
 * Best-effort conversion to the `#rrggbb` a colour input needs.
 *
 * Returns null for anything with alpha or a name the input cannot show, so the
 * swatch falls back rather than silently flattening a translucent token to an
 * opaque one.
 */
function toHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed.match(/^#(.)(.)(.)$/i)!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;

  const parts = rgb[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;

  const hex = parts
    .slice(0, 3)
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('');

  return `#${hex}`;
}
