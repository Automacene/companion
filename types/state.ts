/**
 * UI Connection & App States
 */
export const SidepanelState = {
  INITIALIZING: 'INITIALIZING',
  CONNECTED: 'CONNECTED',
  OFFLINE: 'OFFLINE',
  THINKING: 'THINKING',
  STREAMING: 'STREAMING',
  ERROR: 'ERROR',
} as const;

export type SidepanelState = (typeof SidepanelState)[keyof typeof SidepanelState];

/**
 * State of the Settings
 *
 * Two distinct halves, kept separate because they are edited on separate pages
 * and by people in different moods. Everything from `ollamaHost` down is model
 * configuration, set once. `theme`, `themeOverrides`, and `backdrop` are
 * appearance, and are meant to be played with.
 */
export interface ExtensionSettings {
  /**
   * Which palette to apply, or `system` to follow the OS. Resolved to a
   * concrete theme by `lib/theme/`; see `ThemePreference` there for the
   * values this accepts.
   */
  theme?: string;

  /**
   * Token values the user has changed, keyed by theme then by custom property
   * name. Applied over whichever palette is active, so an override survives
   * switching between light and dark.
   *
   * Typed as the loose form here because `types/` must not depend on `lib/`.
   * `lib/theme/overrides.ts` narrows it to `ThemeOverrides` on the way in and
   * prunes anything naming a token that no longer exists.
   */
  themeOverrides?: Record<string, Record<string, string>>;

  /**
   * Which backdrop preset, plus anything tuned on top of it. See
   * `BackdropSettings` in `lib/backdrop/presets.ts`.
   *
   * Preset and tuning are stored separately so switching preset does not
   * discard tuning, and so improved preset defaults reach everyone who never
   * touched a slider.
   */
  backdrop?: {
    preset: string;
    custom?: Record<string, string | number>;
  };

  ollamaHost?: string;
  connTimeout?: number;
  keepAlive?: string;
  activeModel?: string;
  fallbackModel?: string;
  systemPrompt?: string;
  streamResponses?: boolean;
  temperature?: string | number;
  numCtx?: number;
  numPredict?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  maxMemory?: number;
  stopSeq?: string;
  rawMode?: boolean;
  debugMode?: boolean;
}