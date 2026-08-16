/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by `scripts/generate-token-manifest.mjs` from the CSS in
 * `styles/tokens/`. Change a token there and re-run `npm run generate:tokens`.
 *
 * 88 tokens across 2 themes.
 */

/** The control the theme editor shows for a token. */
export type TokenKind =
  | 'color'
  | 'length'
  | 'duration'
  | 'number'
  | 'font'
  | 'shadow'
  | 'filter'
  | 'easing'
  | 'layer'
  | 'other';

export interface TokenDefinition {
  /** Custom property name, including the leading dashes. */
  name: string;
  /** Human-readable name for the editor. */
  label: string;
  /** Longer explanation, from an `@describe` annotation. */
  description: string | null;
  /** Which control to render. */
  kind: TokenKind;
  /** Heading to file this token under. */
  group: string;
  /** Whether the value differs per theme. Structural tokens do not. */
  themed: boolean;
  /** Whether a user may change it. Layering is locked. */
  editable: boolean;
  /**
   * Default per theme. Unthemed tokens use the single key `_`.
   */
  values: Record<string, string>;
}

/** Theme names with a palette file, in load order. */
export const THEME_NAMES = ["dark","light"] as const;

export const TOKENS: TokenDefinition[] = [
  {
    "name": "--ac-font-sans",
    "label": "Sans",
    "description": null,
    "kind": "font",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif"
    }
  },
  {
    "name": "--ac-font-mono",
    "label": "Mono",
    "description": null,
    "kind": "font",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Monaco, Consolas, \"Liberation Mono\", monospace"
    }
  },
  {
    "name": "--ac-text-2xs",
    "label": "2xs",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.625rem"
    }
  },
  {
    "name": "--ac-text-xs",
    "label": "Xs",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.6875rem"
    }
  },
  {
    "name": "--ac-text-sm",
    "label": "Sm",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.75rem"
    }
  },
  {
    "name": "--ac-text-md",
    "label": "Md",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.875rem"
    }
  },
  {
    "name": "--ac-text-lg",
    "label": "Lg",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1rem"
    }
  },
  {
    "name": "--ac-text-xl",
    "label": "Xl",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1.25rem"
    }
  },
  {
    "name": "--ac-text-2xl",
    "label": "2xl",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1.5rem"
    }
  },
  {
    "name": "--ac-leading-tight",
    "label": "Tight",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1.25"
    }
  },
  {
    "name": "--ac-leading-normal",
    "label": "Normal",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1.5"
    }
  },
  {
    "name": "--ac-leading-loose",
    "label": "Loose",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1.7"
    }
  },
  {
    "name": "--ac-tracking-tight",
    "label": "Tight",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "-0.025em"
    }
  },
  {
    "name": "--ac-tracking-normal",
    "label": "Normal",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0"
    }
  },
  {
    "name": "--ac-tracking-wide",
    "label": "Wide",
    "description": null,
    "kind": "length",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.05em"
    }
  },
  {
    "name": "--ac-weight-normal",
    "label": "Normal",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "400"
    }
  },
  {
    "name": "--ac-weight-medium",
    "label": "Medium",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "500"
    }
  },
  {
    "name": "--ac-weight-semibold",
    "label": "Semibold",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "600"
    }
  },
  {
    "name": "--ac-weight-bold",
    "label": "Bold",
    "description": null,
    "kind": "number",
    "group": "Text",
    "themed": false,
    "editable": true,
    "values": {
      "_": "700"
    }
  },
  {
    "name": "--ac-space-1",
    "label": "1",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.125rem"
    }
  },
  {
    "name": "--ac-space-2",
    "label": "2",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.25rem"
    }
  },
  {
    "name": "--ac-space-3",
    "label": "3",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.375rem"
    }
  },
  {
    "name": "--ac-space-4",
    "label": "4",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.5rem"
    }
  },
  {
    "name": "--ac-space-5",
    "label": "5",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.75rem"
    }
  },
  {
    "name": "--ac-space-6",
    "label": "6",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1rem"
    }
  },
  {
    "name": "--ac-space-7",
    "label": "7",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1.5rem"
    }
  },
  {
    "name": "--ac-space-8",
    "label": "8",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "2rem"
    }
  },
  {
    "name": "--ac-space-9",
    "label": "9",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "3rem"
    }
  },
  {
    "name": "--ac-space-10",
    "label": "10",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "4rem"
    }
  },
  {
    "name": "--ac-radius-xs",
    "label": "Xs",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.1875rem"
    }
  },
  {
    "name": "--ac-radius-sm",
    "label": "Sm",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.25rem"
    }
  },
  {
    "name": "--ac-radius-md",
    "label": "Md",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.375rem"
    }
  },
  {
    "name": "--ac-radius-lg",
    "label": "Lg",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.5rem"
    }
  },
  {
    "name": "--ac-radius-xl",
    "label": "Xl",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "0.75rem"
    }
  },
  {
    "name": "--ac-radius-2xl",
    "label": "2xl",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1rem"
    }
  },
  {
    "name": "--ac-radius-pill",
    "label": "Pill",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "9999px"
    }
  },
  {
    "name": "--ac-radius-circle",
    "label": "Circle",
    "description": null,
    "kind": "length",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "50%"
    }
  },
  {
    "name": "--ac-duration-fast",
    "label": "Fast",
    "description": null,
    "kind": "duration",
    "group": "Motion",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1ms"
    }
  },
  {
    "name": "--ac-duration-base",
    "label": "Base",
    "description": null,
    "kind": "duration",
    "group": "Motion",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1ms"
    }
  },
  {
    "name": "--ac-duration-slow",
    "label": "Slow",
    "description": null,
    "kind": "duration",
    "group": "Motion",
    "themed": false,
    "editable": true,
    "values": {
      "_": "1ms"
    }
  },
  {
    "name": "--ac-ease-out",
    "label": "Out",
    "description": null,
    "kind": "easing",
    "group": "Motion",
    "themed": false,
    "editable": true,
    "values": {
      "_": "cubic-bezier(0.16, 1, 0.3, 1)"
    }
  },
  {
    "name": "--ac-ease-in-out",
    "label": "In out",
    "description": null,
    "kind": "easing",
    "group": "Motion",
    "themed": false,
    "editable": true,
    "values": {
      "_": "cubic-bezier(0.4, 0, 0.2, 1)"
    }
  },
  {
    "name": "--ac-transition-fast",
    "label": "Fast",
    "description": null,
    "kind": "duration",
    "group": "Motion",
    "themed": false,
    "editable": false,
    "values": {
      "_": "var(--ac-duration-fast) var(--ac-ease-out)"
    }
  },
  {
    "name": "--ac-transition-base",
    "label": "Base",
    "description": null,
    "kind": "duration",
    "group": "Motion",
    "themed": false,
    "editable": false,
    "values": {
      "_": "var(--ac-duration-base) var(--ac-ease-out)"
    }
  },
  {
    "name": "--ac-transition-slow",
    "label": "Slow",
    "description": null,
    "kind": "duration",
    "group": "Motion",
    "themed": false,
    "editable": false,
    "values": {
      "_": "var(--ac-duration-slow) var(--ac-ease-out)"
    }
  },
  {
    "name": "--ac-blur-sm",
    "label": "Sm",
    "description": null,
    "kind": "filter",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "blur(6px)"
    }
  },
  {
    "name": "--ac-blur-md",
    "label": "Md",
    "description": null,
    "kind": "filter",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "blur(12px)"
    }
  },
  {
    "name": "--ac-blur-lg",
    "label": "Lg",
    "description": null,
    "kind": "filter",
    "group": "Shape & depth",
    "themed": false,
    "editable": true,
    "values": {
      "_": "blur(20px)"
    }
  },
  {
    "name": "--ac-z-backdrop",
    "label": "Backdrop",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "0"
    }
  },
  {
    "name": "--ac-z-base",
    "label": "Base",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "1"
    }
  },
  {
    "name": "--ac-z-raised",
    "label": "Raised",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "10"
    }
  },
  {
    "name": "--ac-z-sticky",
    "label": "Sticky",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "20"
    }
  },
  {
    "name": "--ac-z-overlay",
    "label": "Overlay",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "50"
    }
  },
  {
    "name": "--ac-z-modal",
    "label": "Modal",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "100"
    }
  },
  {
    "name": "--ac-z-toast",
    "label": "Toast",
    "description": null,
    "kind": "layer",
    "group": "Layering",
    "themed": false,
    "editable": false,
    "values": {
      "_": "200"
    }
  },
  {
    "name": "--ac-grid-size",
    "label": "Size",
    "description": null,
    "kind": "length",
    "group": "Spacing",
    "themed": false,
    "editable": true,
    "values": {
      "_": "40px"
    }
  },
  {
    "name": "--ac-color-accent",
    "label": "Accent",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#ff7029",
      "light": "#ff5500"
    }
  },
  {
    "name": "--ac-color-accent-hover",
    "label": "Accent hover",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#ff8b52",
      "light": "#d64700"
    }
  },
  {
    "name": "--ac-color-accent-soft",
    "label": "Accent soft",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 85, 0, 0.16)",
      "light": "#ffe7db"
    }
  },
  {
    "name": "--ac-color-accent-border",
    "label": "Accent border",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 112, 41, 0.4)",
      "light": "rgba(255, 85, 0, 0.32)"
    }
  },
  {
    "name": "--ac-color-accent-glow",
    "label": "Accent glow",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 112, 41, 0.55)",
      "light": "rgba(255, 85, 0, 0.6)"
    }
  },
  {
    "name": "--ac-color-base",
    "label": "Base",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#111113",
      "light": "#fcfcfc"
    }
  },
  {
    "name": "--ac-color-raised",
    "label": "Raised",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#1a1a1d",
      "light": "#ffffff"
    }
  },
  {
    "name": "--ac-color-overlay",
    "label": "Overlay",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(26, 26, 29, 0.85)",
      "light": "rgba(255, 255, 255, 0.85)"
    }
  },
  {
    "name": "--ac-color-sunken",
    "label": "Sunken",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 255, 255, 0.06)",
      "light": "rgba(15, 23, 42, 0.06)"
    }
  },
  {
    "name": "--ac-color-text",
    "label": "Text",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#f4f4f5",
      "light": "#18181b"
    }
  },
  {
    "name": "--ac-color-text-muted",
    "label": "Text muted",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#a1a1aa",
      "light": "#52525b"
    }
  },
  {
    "name": "--ac-color-text-subtle",
    "label": "Text subtle",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#71717a",
      "light": "#a1a1aa"
    }
  },
  {
    "name": "--ac-color-text-inverted",
    "label": "Text inverted",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#111113",
      "light": "#ffffff"
    }
  },
  {
    "name": "--ac-color-border",
    "label": "Border",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 255, 255, 0.12)",
      "light": "rgba(0, 0, 0, 0.1)"
    }
  },
  {
    "name": "--ac-color-border-subtle",
    "label": "Border subtle",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 255, 255, 0.06)",
      "light": "rgba(0, 0, 0, 0.05)"
    }
  },
  {
    "name": "--ac-color-border-strong",
    "label": "Border strong",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 255, 255, 0.28)",
      "light": "rgba(0, 0, 0, 0.24)"
    }
  },
  {
    "name": "--ac-color-success",
    "label": "Success",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#34d399",
      "light": "#059669"
    }
  },
  {
    "name": "--ac-color-success-soft",
    "label": "Success soft",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(52, 211, 153, 0.12)",
      "light": "#dcfef3"
    }
  },
  {
    "name": "--ac-color-success-border",
    "label": "Success border",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(52, 211, 153, 0.36)",
      "light": "#a6fce1"
    }
  },
  {
    "name": "--ac-color-warning",
    "label": "Warning",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#fbbf24",
      "light": "#d97706"
    }
  },
  {
    "name": "--ac-color-warning-soft",
    "label": "Warning soft",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(251, 191, 36, 0.12)",
      "light": "#feeedc"
    }
  },
  {
    "name": "--ac-color-warning-border",
    "label": "Warning border",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(251, 191, 36, 0.36)",
      "light": "#fdd4a5"
    }
  },
  {
    "name": "--ac-color-danger",
    "label": "Danger",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#f87171",
      "light": "#dc2626"
    }
  },
  {
    "name": "--ac-color-danger-soft",
    "label": "Danger soft",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(248, 113, 113, 0.12)",
      "light": "#fae0e0"
    }
  },
  {
    "name": "--ac-color-danger-border",
    "label": "Danger border",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(248, 113, 113, 0.36)",
      "light": "#f2b0b0"
    }
  },
  {
    "name": "--ac-color-info",
    "label": "Info",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "#60a5fa",
      "light": "#2563eb"
    }
  },
  {
    "name": "--ac-color-info-soft",
    "label": "Info soft",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(96, 165, 250, 0.12)",
      "light": "#dee8fc"
    }
  },
  {
    "name": "--ac-color-info-border",
    "label": "Info border",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(96, 165, 250, 0.36)",
      "light": "#abc3f7"
    }
  },
  {
    "name": "--ac-color-grid-line",
    "label": "Grid line",
    "description": null,
    "kind": "color",
    "group": "Colours",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "rgba(255, 255, 255, 0.05)",
      "light": "rgba(0, 0, 0, 0.05)"
    }
  },
  {
    "name": "--ac-shadow-sm",
    "label": "Sm",
    "description": null,
    "kind": "shadow",
    "group": "Shape & depth",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "0 1px 2px rgba(0, 0, 0, 0.4)",
      "light": "0 1px 2px rgba(0, 0, 0, 0.05)"
    }
  },
  {
    "name": "--ac-shadow-md",
    "label": "Md",
    "description": null,
    "kind": "shadow",
    "group": "Shape & depth",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "0 2px 8px rgba(0, 0, 0, 0.5)",
      "light": "0 2px 8px rgba(0, 0, 0, 0.08)"
    }
  },
  {
    "name": "--ac-shadow-lg",
    "label": "Lg",
    "description": null,
    "kind": "shadow",
    "group": "Shape & depth",
    "themed": true,
    "editable": true,
    "values": {
      "dark": "0 8px 24px rgba(0, 0, 0, 0.6)",
      "light": "0 8px 24px rgba(0, 0, 0, 0.1)"
    }
  }
];

/** Lookup by custom property name. */
export const TOKENS_BY_NAME: ReadonlyMap<string, TokenDefinition> = new Map(
  TOKENS.map((token) => [token.name, token])
);

/** Editable tokens only, in the order the editor should show them. */
export const EDITABLE_TOKENS: TokenDefinition[] = TOKENS.filter((token) => token.editable);

/**
 * Group headings, most-noticed first. See GROUP_ORDER in the generator for why
 * this order and not declaration order.
 */
export const TOKEN_GROUPS: string[] = ["Colours","Shape & depth","Text","Spacing","Motion"];

/**
 * The default value of a token under a theme, falling back to the unthemed
 * value for structural tokens.
 */
export function defaultValue(token: TokenDefinition, theme: string): string {
  return token.values[theme] ?? token.values._ ?? '';
}
