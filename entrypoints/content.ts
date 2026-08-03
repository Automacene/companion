import type { RawDOMPayload } from '../lib/processors/types';
import { ToolAction } from '../types/actions';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // Listen for extraction requests from background.ts
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === ToolAction.SCRAPE_DOM) {
        try {
          // Capture user text selection if present
          const selection = window.getSelection()?.toString().trim() || undefined;

          // Assemble the unmodified DOM payload
          const payload: RawDOMPayload = {
            title: document.title || 'Untitled Page',
            url: window.location.href,
            html: document.documentElement.outerHTML, // Full, raw DOM tree
            selectedText: selection,
          };

          sendResponse({ success: true, data: payload });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown DOM capture error';
          sendResponse({ success: false, error: errorMessage });
        }

        // Keep the message channel open for async response
        return true;
      }
    });
  },
});