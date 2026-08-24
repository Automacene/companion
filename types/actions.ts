/**
 * Message Actions exchanged over Runtime Ports (Background <-> Sidepanel)
 */
export const PortAction = {
  // Requests from Sidepanel to Background
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  SEND_MESSAGE: 'SEND_MESSAGE',
  /** Replace the whole settings object. Used by "reset to defaults". */
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  /**
   * Merge a partial update. The normal path, because settings are edited from
   * two pages that each only know their own half — a full write from either
   * would erase the other's fields.
   */
  PATCH_SETTINGS: 'PATCH_SETTINGS',
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

/**
 * Reading and pruning the shared archive.
 *
 * One-off runtime messages rather than port traffic: the memory page is not
 * tab-scoped, and the archive belongs to the browser rather than to any
 * conversation in it.
 */
export const MemoryAction = {
  /** Recent entries, newest first. */
  MEMORY_LIST: 'MEMORY_LIST',
  /** The same ranking the model gets, so the page shows what it would recall. */
  MEMORY_SEARCH: 'MEMORY_SEARCH',
  /** Forget one entry. */
  MEMORY_FORGET: 'MEMORY_FORGET',
  /** Forget everything in the archive. */
  MEMORY_FORGET_ALL: 'MEMORY_FORGET_ALL',
  /** Counts per pool, for the summary. */
  MEMORY_STATS: 'MEMORY_STATS',
} as const;

export type MemoryAction = (typeof MemoryAction)[keyof typeof MemoryAction];
