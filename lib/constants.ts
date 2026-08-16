import type { ExtensionSettings } from '../types/state';
import { DEFAULT_THEME_PREFERENCE } from './theme';
import { DEFAULT_PRESET_ID } from './backdrop/presets';

export const OLLAMA_HOST = 'http://localhost:11434';
export const MODEL_NAME = 'llama3';
export const DEFAULT_SYSTEM_PROMPT = 'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.';
export const DEFAULT_ACTIVE_MODEL = 'llama3.2:latest';
export const DEFAULT_FALLBACK_MODEL = 'qwen3.5:latest';
export const DEFAULT_CONN_TIMEOUT = 5000;
export const DEFAULT_KEEP_ALIVE = '5m';
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_NUM_CTX = 8192;
export const DEFAULT_NUM_PREDICT = 1024;
export const DEFAULT_TOP_P = 0.9;
export const DEFAULT_TOP_K = 40;
export const DEFAULT_REPEAT_PENALTY = 1.1;
export const DEFAULT_PROCESSOR_NAME = 'basic';
export const DEFAULT_MAX_CHAR_BUDGET = 12000;
export const SIDEPANEL_CONNECTION_NAME = 'sidepanel-connection';
export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: DEFAULT_THEME_PREFERENCE,
  themeOverrides: {},
  backdrop: { preset: DEFAULT_PRESET_ID },
  ollamaHost: OLLAMA_HOST,
  connTimeout: DEFAULT_CONN_TIMEOUT,
  keepAlive: DEFAULT_KEEP_ALIVE,
  activeModel: DEFAULT_ACTIVE_MODEL,
  fallbackModel: DEFAULT_FALLBACK_MODEL,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  streamResponses: true,
  temperature: DEFAULT_TEMPERATURE,
  numCtx: DEFAULT_NUM_CTX,
  numPredict: DEFAULT_NUM_PREDICT,
  topP: DEFAULT_TOP_P,
  topK: DEFAULT_TOP_K,
  repeatPenalty: DEFAULT_REPEAT_PENALTY,
  maxMemory: DEFAULT_MAX_CHAR_BUDGET,
  stopSeq: '',
  rawMode: false,
  debugMode: false,
};