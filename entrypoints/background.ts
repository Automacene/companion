import { DEFAULT_PROCESSOR_NAME, DEFAULT_SYSTEM_PROMPT, MODEL_NAME, OLLAMA_HOST, SIDEPANEL_CONNECTION_NAME } from '../lib/constants';
import { VercelConversation } from '../lib/conversation';
import { streamChatResponse } from '../lib/model';
import { defaultPipeline } from '../lib/processors/pipeline';
import type { RawDOMPayload, ProcessedResult } from '../lib/processors/types';
import { PortAction, ToolAction } from '../types/actions';

const tabSessions = new Map<number, VercelConversation>();

function getSession(tabId: number, systemPrompt?: string): VercelConversation {
  let conversation = tabSessions.get(tabId);
  if (!conversation) {
    const prompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    conversation = new VercelConversation(prompt, 8000);
    tabSessions.set(tabId, conversation);
  }
  return conversation;
}

/**
 * Requests raw DOM from content script and routes it through ProcessingPipeline
 */
async function scrapeAndProcessTab(
  tabId: number,
  processorName = DEFAULT_PROCESSOR_NAME
): Promise<ProcessedResult> {
  const response = await browser.tabs.sendMessage(tabId, {
    action: ToolAction.SCRAPE_DOM,
  });

  if (!response || !response.success || !response.data) {
    throw new Error(response?.error || 'Failed to capture DOM from content script.');
  }

  const rawPayload = response.data as RawDOMPayload;
  return await defaultPipeline.run(processorName, rawPayload);
}

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));

  browser.tabs.onRemoved.addListener((tabId) => {
    tabSessions.delete(tabId);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== SIDEPANEL_CONNECTION_NAME) return;

    port.onMessage.addListener(async (msg) => {
      const tabId = msg.tabId ?? -1;
      const conversation = getSession(tabId, msg.systemPrompt);

      if (msg.action === PortAction.GET_HISTORY) {
        port.postMessage({
          action: PortAction.HISTORY_RESPONSE,
          messages: conversation.getMessages(),
        });
      }

      // DOM Extraction Action
      if (msg.action === ToolAction.SCRAPE_DOM) {
        try {
          const filterName = msg.processorName || DEFAULT_PROCESSOR_NAME;
          const processedResult = await scrapeAndProcessTab(tabId, filterName);

          port.postMessage({
            action: 'SCRAPE_COMPLETE',
            result: processedResult,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Scrape failed';
          port.postMessage({
            action: 'SCRAPE_ERROR',
            error: errorMessage,
          });
        }
      }

      if (msg.action === PortAction.SEND_MESSAGE) {
        const { prompt, hostUrl, modelName } = msg;

        conversation.addUser(prompt);

        try {
          let accumulatedText = '';

          await streamChatResponse(
            {
              ollamaHost: hostUrl || OLLAMA_HOST,
              activeModel: modelName || MODEL_NAME,
            },
            conversation.getMessages(),
            (textDelta) => {
              accumulatedText += textDelta;
              port.postMessage({
                action: PortAction.STREAM_CHUNK,
                fullText: accumulatedText,
              });
            }
          );

          conversation.addAssistant(accumulatedText);

          port.postMessage({
            action: PortAction.STREAM_COMPLETE,
            fullText: accumulatedText,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          port.postMessage({
            action: PortAction.STREAM_ERROR,
            error: message,
          });
        }
      }
    });
  });
});