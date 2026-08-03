import { streamChatResponse } from '../model';
import { PortAction } from '../../types/actions';
import type { VercelConversation } from '../conversation';

export class StreamService {
  /**
   * Streams completion tokens from Ollama to the active port connection,
   * updating conversation history on completion or reporting errors.
   */
  public async handleUserMessage(
    port: Browser.runtime.Port,
    conversation: VercelConversation,
    prompt: string,
    overrideHost?: string,
    overrideModel?: string
  ): Promise<void> {
    // 1. Update session config if explicit overrides were passed
    if (overrideHost || overrideModel) {
      conversation.updateConfig(overrideHost, overrideModel);
    }

    // 2. Append user prompt to conversation state
    conversation.addUser(prompt);

    try {
      let accumulatedText = '';

      // 3. Initiate stream to host/model configured in conversation
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

      // 4. Record assistant response upon stream completion
      conversation.addAssistant(accumulatedText);

      port.postMessage({
        action: PortAction.STREAM_COMPLETE,
        fullText: accumulatedText,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown streaming error';
      port.postMessage({
        action: PortAction.STREAM_ERROR,
        error,
      });
    }
  }
}