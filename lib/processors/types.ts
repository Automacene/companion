/**
 * The processor contract.
 *
 * A processor turns a page into text for the model. It receives the live
 * `Document` and runs inside the content script, which is a change from the
 * previous version — that one received a string of HTML in the background
 * worker and pulled tags off it with regular expressions.
 *
 * The reason for the move is that most of what makes a page unreadable can only
 * be judged from the DOM. Whether an element is navigation, whether it is on
 * screen at all, how much of a block is link text — none of that survives being
 * flattened to a string. Working on the string also meant the entire document,
 * megabytes on a large page, crossed the extension message channel before
 * anything had looked at it.
 */

/** Everything a processor is given. */
export interface PageSource {
  /** The live document. Read it; do not modify it. */
  document: Document;
  /** Whatever the user had highlighted, if anything. */
  selection?: string;
  /** Ceiling on the returned text, in characters. */
  maxChars: number;
}

export interface ProcessedResult {
  processorName: string;
  contentType: 'text/plain' | 'text/markdown' | 'application/json' | 'text/html';
  content: string;
  title: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface PostProcessor {
  /** Unique. Registering a name twice replaces the earlier one. */
  name: string;
  /** Shown wherever a processor can be chosen. */
  description: string;
  process(source: PageSource): Promise<ProcessedResult>;
}
