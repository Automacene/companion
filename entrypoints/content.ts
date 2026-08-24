import { defaultPipeline } from '../lib/processors/pipeline';
import { DEFAULT_PROCESSOR_NAME, DEFAULT_MAX_CHAR_BUDGET } from '../lib/constants';
import { ToolAction } from '../types/actions';

/**
 * The content script.
 *
 * It now runs the processor itself and returns finished text. Previously it
 * serialized `document.documentElement.outerHTML` and handed that to the
 * background worker to strip with regular expressions, which meant the whole
 * document — megabytes on a large page — crossed the message channel before
 * anything examined it, and the worker had no way to tell content from
 * navigation once the DOM was gone.
 *
 * Doing the work here is not an optimisation. Whether an element is on screen,
 * and whether it is navigation, are questions only the live DOM can answer.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action !== ToolAction.SCRAPE_DOM) return;

      const started = performance.now();

      defaultPipeline
        .run(message.processor ?? DEFAULT_PROCESSOR_NAME, {
          document,
          selection: window.getSelection()?.toString().trim() || undefined,
          maxChars: message.maxChars ?? DEFAULT_MAX_CHAR_BUDGET,
        })
        .then((result) => {
          sendResponse({
            success: true,
            data: {
              ...result,
              metadata: { ...result.metadata, elapsedMs: Math.round(performance.now() - started) },
            },
          });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Extraction failed',
          });
        });

      // Keeps the channel open, because the response is sent from the promise.
      return true;
    });
  },
});
