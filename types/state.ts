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
 */
export interface ExtensionSettings {
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