import { ToolAction } from '../../types/actions';
import { DEFAULT_PROCESSOR_NAME, DEFAULT_MAX_CHAR_BUDGET } from '../constants';
import type { ProcessedResult } from '../processors/types';

export interface ScrapeOptions {
  processor?: string;
  /** Ceiling for the extracted text. Defaults to the memory budget. */
  maxChars?: number;
}

/**
 * Asks the content script for the page, already read.
 *
 * This used to receive raw HTML and run the processor here. The processor moved
 * into the content script, so all that is left is the request and staging the
 * result - which is the whole point: what arrives is a few thousand characters
 * of text rather than the entire document.
 */
export class ScraperService {
  public async scrapeTab(tabId: number, options: ScrapeOptions = {}): Promise<ProcessedResult> {
    let response;

    try {
      response = await browser.tabs.sendMessage(tabId, {
        action: ToolAction.SCRAPE_DOM,
        processor: options.processor ?? DEFAULT_PROCESSOR_NAME,
        maxChars: options.maxChars ?? DEFAULT_MAX_CHAR_BUDGET,
      });
    } catch (cause) {
      // The usual cause is a tab that was already open when the extension was.
      throw new Error(
        'No content script on that tab. Reload the page and try again. ' +
          `(${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }

    if (!response?.success || !response.data) {
      throw new Error(response?.error || 'The page could not be read.');
    }

    // Returned rather than stored.
    return response.data as ProcessedResult;
  }
}
