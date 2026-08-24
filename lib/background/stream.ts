import { streamChatResponse } from '../model';
import { buildRequestShape } from '../ollama-options';
import { saveLastRun } from '../last-run';
import { PortAction } from '../../types/actions';
import type { ExtensionSettings } from '../../types/state';
import { syncThread } from './thread';
import type { SessionManager } from './session';

/**
 * Runs one turn and streams it to the panel.
 *
 * The turn callback is where the model gets called. `step.prompt` is whatever
 * the assemble hook returned — for companion that is `ModelMessage[]`, built by
 * `lib/mind/assemble.ts`.
 *
 * Streaming is only for the panel. Tokens are posted to the port as they
 * arrive so text appears while it is being written, but the library sees one
 * finished string: returning it from the callback is what closes the turn and
 * writes the response onto the record.
 */
export class StreamService {
  constructor(private sessions: SessionManager) {}

  public async handleUserMessage(
    port: Browser.runtime.Port,
    tabId: number,
    prompt: string,
    settings: ExtensionSettings,
    context?: unknown
  ): Promise<void> {
    const scope = await this.sessions.scopeFor(tabId);

    try {
      let accumulated = '';

      const record = await scope.turn(
        prompt,
        async (step: { prompt: any }) => {
          const model = settings.activeModel ?? '';

          await streamChatResponse(
            {
              ollamaHost: settings.ollamaHost ?? '',
              activeModel: model,
              // Every sampling parameter the user set. Without this the request
              // carries only the model and the messages, which is what made the
              // whole settings page decorative.
              request: buildRequestShape(settings, model),
            },
            step.prompt,
            (delta) => {
              accumulated += delta;
              port.postMessage({ action: PortAction.STREAM_CHUNK, fullText: accumulated });
            },
            undefined,
            (metrics) => void saveLastRun(metrics)
          );

          // A string closes the turn. Returning nothing would run another pass,
          // which is how tool use will work once tools are registered.
          return accumulated;
        },
        // The page read rides on the turn as its own field rather than being
        // spliced into the text, so it never enters the stored history.
        context ? { context } : {}
      );

      // Index it for the panel's scrollback before telling the panel it is done.
      await syncThread(scope);

      port.postMessage({
        action: PortAction.STREAM_COMPLETE,
        fullText: accumulated,
        turn: {
          id: record.id,
          query: record.query,
          response: record.response,
          seq: record.seq,
          thinking: record.thinking,
          actions: record.actions,
        },
      });
    } catch (cause) {
      // A failed turn is still a turn: `turn()` closes it with stopped:"error"
      // and it stays in the window, so the panel should still show the question.
      await syncThread(scope);

      port.postMessage({
        action: PortAction.STREAM_ERROR,
        error: cause instanceof Error ? cause.message : 'Unknown streaming error',
      });
    }
  }
}
