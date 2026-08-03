import { defaultPipeline } from '../processors/pipeline';
import type { RawDOMPayload, ProcessedResult } from '../processors/types';
import { ToolAction } from '../../types/actions';
import { DEFAULT_PROCESSOR_NAME } from '../constants';
import type { VercelConversation } from '../conversation';

export class ScraperService {
  /**
   * Requests raw DOM payload from the content script on tabId,
   * routes it through the processing pipeline, and ingests context into conversation state.
   */
  public async scrapeTab(
    tabId: number,
    conversation: VercelConversation,
    processorName = DEFAULT_PROCESSOR_NAME
  ): Promise<ProcessedResult> {
    const response = await browser.tabs.sendMessage(tabId, {
      action: ToolAction.SCRAPE_DOM,
    });

    if (!response || !response.success || !response.data) {
      throw new Error(response?.error || 'Failed to capture DOM from content script.');
    }

    const rawPayload = response.data as RawDOMPayload;
    const processedResult = await defaultPipeline.run(processorName, rawPayload);

    // Ingest into conversation using title and url directly from rawPayload
    if (processedResult?.content) {
      conversation.addContext(
        rawPayload.title || 'Page',
        rawPayload.url || '',
        processedResult.content
      );
    }

    return processedResult;
  }
}