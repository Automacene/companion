import { streamChatResponse } from '../model';
import { buildRequestShape } from '../ollama-options';
import { saveLastRun } from '../last-run';
import { PortAction } from '../../types/actions';
import type { VercelConversation } from '../conversation';
import type { ExtensionSettings } from '../../types/state';

export class StreamService {
  /**
   * Streams completion tokens from Ollama to the active port connection,
   * updating conversation history on completion or reporting errors.
   */
  public async handleUserMessage(
    port: Browser.runtime.Port,
    conversation: VercelConversation,
    prompt: string,
    settings: ExtensionSettings,
    overrideHost?: string,
    overrideModel?: string
  ): Promise<void> {
    // Update session config if explicit overrides were passed
    if (overrideHost || overrideModel) {
      conversation.updateConfig(overrideHost, overrideModel);
    }

    // Append user prompt to conversation state
    conversation.addUser(prompt);

    try {
      let accumulatedText = '';

      // Initiate stream to host/model configured in conversation
      const model = conversation.getModelName();

      await streamChatResponse(
        {
          ollamaHost: conversation.getHostUrl(),
          activeModel: model,
          // Where the sampling parameters finally reach the request. Without
          // this the options page was writing to storage and nothing read it.
          request: buildRequestShape(settings, model),
        },
        conversation.getMessages(),
        (textDelta) => {
          accumulatedText += textDelta;
          port.postMessage({
            action: PortAction.STREAM_CHUNK,
            fullText: accumulatedText,
          });
        },
        undefined,
        // Stored rather than sent over the port: the model settings page wants
        // these, and it is a different document with no port of its own.
        (metrics) => void saveLastRun(metrics)
      );

      // Record assistant response upon stream completion
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