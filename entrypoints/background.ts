import { DEFAULT_PROCESSOR_NAME, DEFAULT_SYSTEM_PROMPT, MODEL_NAME, OLLAMA_HOST, SIDEPANEL_CONNECTION_NAME } from '../lib/constants';
import { VercelConversation } from '../lib/conversation';
import { streamChatResponse } from '../lib/model';
import { defaultPipeline } from '../lib/processors/pipeline';
import type { RawDOMPayload, ProcessedResult } from '../lib/processors/types';
import { PortAction, ToolAction } from '../types/actions';
import type { ExtensionSettings } from '../types/state';

const tabSessions = new Map<number, VercelConversation>();

function getSession(tabId: number): VercelConversation {
  let conversation = tabSessions.get(tabId);
  if (!conversation) {
    conversation = new VercelConversation();
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

  // Listen for changes to extension settings
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.extensionSettings) {
      const newSettings = changes.extensionSettings.newValue as {
        systemPrompt?: string;
        ollamaHost?: string;
        activeModel?: string;
      };
      
      if (newSettings) {
        for (const conversation of tabSessions.values()) {
          if (newSettings.systemPrompt) {
            conversation.updateSystemPrompt(newSettings.systemPrompt);
          }
          if (newSettings.ollamaHost || newSettings.activeModel) {
            conversation.updateConfig(newSettings.ollamaHost, newSettings.activeModel);
          }
        }
      }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== SIDEPANEL_CONNECTION_NAME) return;

    port.onMessage.addListener(async (msg) => {
      const tabId = msg.tabId ?? -1;
      const conversation = getSession(tabId);

      if (msg.action === PortAction.GET_HISTORY) {
        port.postMessage({
          action: PortAction.HISTORY_RESPONSE,
          messages: conversation.getMessages(),
        });
      }

      if (msg.action === PortAction.SAVE_SETTINGS) {
        try {
          const newSettings = msg.settings as ExtensionSettings;

          // 1. Update browser storage directly
          await browser.storage.local.set({ extensionSettings: newSettings });

          // 2. Update all active conversation session instances in memory immediately
          for (const conversation of tabSessions.values()) {
            if (newSettings.systemPrompt) {
              conversation.updateSystemPrompt(newSettings.systemPrompt);
            }
            if (newSettings.ollamaHost || newSettings.activeModel) {
              conversation.updateConfig(newSettings.ollamaHost, newSettings.activeModel);
            }
          }

          port.postMessage({ success: true });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to save settings';
          port.postMessage({ success: false, error: errorMessage });
        }
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
        const { prompt } = msg;

        conversation.addUser(prompt);

        try {
          let accumulatedText = '';

          await streamChatResponse(
            {
              ollamaHost: conversation.getHostUrl(),
              activeModel: conversation.getModelName(),
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

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log("ALL YOUR BASE")
    if (msg.action === PortAction.SAVE_SETTINGS) {
      (async () => {
        try {
          const newSettings = msg.settings as ExtensionSettings;
          await browser.storage.local.set({ extensionSettings: newSettings });

          for (const conversation of tabSessions.values()) {
            if (newSettings.systemPrompt) {
              conversation.updateSystemPrompt(newSettings.systemPrompt);
            }
            if (newSettings.ollamaHost || newSettings.activeModel) {
              conversation.updateConfig(newSettings.ollamaHost, newSettings.activeModel);
            }
          }

          sendResponse({ success: true });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to save settings';
          sendResponse({ success: false, error: errorMessage });
        }
      })();
      return true; // Keeps the message channel open for async sendResponse
    }
  });
});