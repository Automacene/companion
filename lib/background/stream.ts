import { streamChatResponse } from '../model';
import { buildRequestShape } from '../ollama-options';
import { saveLastRun } from '../last-run';
import { PortAction } from '../../types/actions';
import type { ExtensionSettings } from '../../types/state';
import { syncThread } from './thread';
import { keepAwake } from './keepalive';
import { announceMemoryChanged } from './memory-events';
import type { SessionManager } from './session';

/**
 * Runs one turn and streams it to the panel.
 *
 * The turn callback is where the model gets called. `step.prompt` is whatever
 * the assemble hook returned - for companion that is `ModelMessage[]`, built by
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
  ): Promise<void> {
    // Inside the try, not before it.
    try {
      // Wrapped for the whole turn, not just the fetch.
      const { record, accumulated } = await keepAwake(async () => {
        const scope = await this.sessions.scopeFor(tabId);

        // Which page was open, as title and address only.
        const context = await this.sessions.attachedPage(tabId);

        let accumulated = '';

        const record = await scope.turn(
          prompt,
          async (step: { prompt: any }) => {
            const model = settings.activeModel ?? '';

            await streamChatResponse(
              {
                ollamaHost: settings.ollamaHost ?? '',
                activeModel: model,
                // Every sampling parameter the user set.
                request: buildRequestShape(settings, model),
              },
              step.prompt,
              (delta) => {
                accumulated += delta;
                port.postMessage({
                  action: PortAction.STREAM_CHUNK,
                  fullText: accumulated,
                });
              },
              undefined,
              (metrics) => void saveLastRun(metrics),
            );

            // A string closes the turn.
            return accumulated;
          },
          // A note of which page was open, not the page. See above.
          context ? { context } : {},
        );

        // Index it for the panel's scrollback before telling the panel it is done.
        await syncThread(scope, record);

        return { record, accumulated };
      });

      // A completed turn is a write.
      announceMemoryChanged();

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
      // A failed turn is still a turn, so the panel should still show the question.
      try {
        await syncThread(await this.sessions.scopeFor(tabId));
        announceMemoryChanged();
      } catch {
        // Indexing is best effort. The error below is what matters.
      }

      port.postMessage({
        action: PortAction.STREAM_ERROR,
        error: cause instanceof Error ? cause.message : 'Unknown streaming error',
      });
    }
  }
}
