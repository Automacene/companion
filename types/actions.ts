/**
 * Message Actions exchanged over Runtime Ports (Background <-> Sidepanel)
 */
export const PortAction = {
  // Requests from Sidepanel to Background
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  SEND_MESSAGE: 'SEND_MESSAGE',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  GET_SETTINGS: 'GET_SETTINGS',

  // Responses/Events from Background to Sidepanel
  HISTORY_RESPONSE: 'HISTORY_RESPONSE',
  STREAM_CHUNK: 'STREAM_CHUNK',
  STREAM_COMPLETE: 'STREAM_COMPLETE',
  STREAM_ERROR: 'STREAM_ERROR',
  SCRAPE_COMPLETE: 'SCRAPE_COMPLETE', 
  MAP_COMPLETE: 'MAP_COMPLETE',       
  SCRAPE_ERROR: 'SCRAPE_ERROR',       
} as const;

export type PortAction = (typeof PortAction)[keyof typeof PortAction];

/**
 * User Tool & Extraction Actions (Useful for Phase 2 & Phase 3 extensions!)
 */
export const ToolAction = {
  SCRAPE_DOM: 'SCRAPE_DOM',
  MAP_DOM: 'MAP_DOM',
  EXECUTE_CALCULATOR: 'EXECUTE_CALCULATOR',
} as const;

export type ToolAction = (typeof ToolAction)[keyof typeof ToolAction];