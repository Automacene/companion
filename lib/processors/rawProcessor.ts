import { DEFAULT_PROCESSOR_NAME } from '../constants';
import type { PostProcessor, RawDOMPayload, ProcessedResult } from './types';

export class RawProcessor implements PostProcessor {
  name = DEFAULT_PROCESSOR_NAME;
  description = 'Returns the raw, unmodified HTML/DOM content.';

  async process(payload: RawDOMPayload): Promise<ProcessedResult> {
    return {
      processorName: this.name,
      contentType: 'text/html',
      content: payload.html,
      metadata: {
        rawLength: payload.html.length,
        url: payload.url,
      },
    };
  }
}