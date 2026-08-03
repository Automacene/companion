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
