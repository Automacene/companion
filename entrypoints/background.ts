import { VercelConversation } from '../lib/conversation';
import { streamChatResponse } from '../lib/model';
import { PortAction } from '../types/actions';

const OLLAMA_HOST = 'http://localhost:11434';
const MODEL_NAME = 'llama3';

const tabSessions = new Map<number, VercelConversation>();

function getSession(tabId: number, systemPrompt?: string): VercelConversation {
  let conversation = tabSessions.get(tabId);
  if (!conversation) {
    const prompt =
      systemPrompt ||
      'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.';
    conversation = new VercelConversation(prompt, 8000);
    tabSessions.set(tabId, conversation);
  }
  return conversation;
}

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));

  browser.tabs.onRemoved.addListener((tabId) => {
    tabSessions.delete(tabId);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel-connection') return;

    port.onMessage.addListener(async (msg) => {
      const tabId = msg.tabId ?? -1;
      const conversation = getSession(tabId, msg.systemPrompt);

      if (msg.action === PortAction.GET_HISTORY) {
        port.postMessage({
          action: PortAction.HISTORY_RESPONSE,
          messages: conversation.getMessages(),
        });
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