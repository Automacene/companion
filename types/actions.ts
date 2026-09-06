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
   * two pages that each only know their own half - a full write from either
   * would erase the other's fields.
   */
  PATCH_SETTINGS: 'PATCH_SETTINGS',
  GET_SETTINGS: 'GET_SETTINGS',
  /**
   * When this tab's page was last read, and how much of it is already stored.
   *
   * Asked on every tab change so the composer can say so before you press
   * anything. Rereading a page you already have is the common way the archive
   * fills with duplicates, and it used to happen silently.
   */
  PAGE_STATUS: 'PAGE_STATUS',
  /** Drop the page attached to this tab, keeping none of it. */
  DETACH_PAGE: 'DETACH_PAGE',
  /**
   * Rename the conversation this tab is having.
   *
   * The name is a label on the conversation id, never the id itself - scope
   * names are baked into every pool a conversation owns, so renaming the
   * identifier would strand all of them. Which is also why renaming is free.
   */
  RENAME_CONVERSATION: 'RENAME_CONVERSATION',

  // Responses/Events from Background to Sidepanel
  HISTORY_RESPONSE: 'HISTORY_RESPONSE',
  STREAM_CHUNK: 'STREAM_CHUNK',
  STREAM_COMPLETE: 'STREAM_COMPLETE',
  STREAM_ERROR: 'STREAM_ERROR',
  SCRAPE_COMPLETE: 'SCRAPE_COMPLETE',
  MAP_COMPLETE: 'MAP_COMPLETE',
  SCRAPE_ERROR: 'SCRAPE_ERROR',
  /** The answer to PAGE_STATUS, and what a detach reports afterwards. */
  PAGE_STATUS_RESPONSE: 'PAGE_STATUS_RESPONSE',
} as const;

export type PortAction = (typeof PortAction)[keyof typeof PortAction];

/**
 * User Tool & Extraction Actions (Useful for Phase 2 & Phase 3 extensions!)
 */
export const ToolAction = {
  SCRAPE_DOM: 'SCRAPE_DOM',
  MAP_DOM: 'MAP_DOM',
  /**
   * Ask a page how deep its back/forward stack is.
   *
   * `history.length` is a page API, so only the content script can read it. It
   * is how a tab is recognised after a browser restart reassigns tab ids - see
   * lib/background/tab-identity.ts for why nothing plantable survives.
   */
  TAB_IDENTITY: 'TAB_IDENTITY',
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
  /**
   * Browse what is stored: filtered, sorted, and paged like a history list.
   *
   * Takes a filter rather than being one of several fixed listings, because
   * this page is a history browser and a history browser has one list you
   * narrow, not a menu of separate views.
   */
  MEMORY_LIST: 'MEMORY_LIST',
  /**
   * Forget the entries whose ids are given.
   *
   * Takes a list because deleting is a selection, the way it is in a history
   * window: tick the rows you do not want and remove those. It took a single id
   * and was partnered with category-wide wipe buttons, which meant the only
   * choices were one at a time or all of a kind.
   */
  MEMORY_FORGET: 'MEMORY_FORGET',
  /**
   * Delete a conversation outright, keeping none of it.
   *
   * The counterpart to MEMORY_CLOSE, which ends a conversation by moving its
   * turns into the archive. Closing was the only thing on offer, so erasing one
   * meant archiving it first and then hunting its turns down in the archive -
   * asking someone to file something in order to shred it.
   */
  MEMORY_DELETE_SCOPE: 'MEMORY_DELETE_SCOPE',
  /**
   * Drop pools the current mind no longer declares.
   *
   * Storage outlives the mind, so changing which pools exist strands whatever
   * the old arrangement wrote. Those are serialized into every save from then
   * on, because saving writes the whole of memory each time.
   */
  MEMORY_PURGE_ORPHANS: 'MEMORY_PURGE_ORPHANS',
  /** Counts per pool, for the summary. */
  MEMORY_STATS: 'MEMORY_STATS',
  /**
   * End one conversation and let its turns age into the shared archive.
   *
   * Normally a tab closing does this. A tab that crashed never fires
   * `onRemoved`, so its conversation sits open forever holding turns that no
   * other tab can recall - this is how you finish one by hand.
   */
  MEMORY_CLOSE: 'MEMORY_CLOSE',
  /**
   * Drop one PART of an entry and keep the rest.
   *
   * A turn is not one thing. It holds the question, the answer, whatever page
   * was attached, the model's reasoning, and what tools returned - and the
   * attached page is routinely the largest of those by a wide margin. Forgetting
   * the whole turn to be rid of a page throws away the exchange as well, which
   * is the wrong trade when the exchange is the part worth keeping.
   */
  MEMORY_FORGET_PART: 'MEMORY_FORGET_PART',
} as const;

export type MemoryAction = (typeof MemoryAction)[keyof typeof MemoryAction];
