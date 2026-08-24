import type { PageSource, PostProcessor, ProcessedResult } from './types';

/**
 * Everything, unread and unfiltered.
 *
 * For debugging a page the basic processor gets wrong. It is genuinely the
 * whole document, so on a large page this is hundreds of thousands of
 * characters and will not fit in any context window worth using.
 *
 * NOTE: this used to be unreachable. Its name was `DEFAULT_PROCESSOR_NAME`,
 * which is the string `'basic'` — the same name `BasicProcessor` registers
 * under. The pipeline registered raw first and basic overwrote it, so asking
 * for raw silently returned basic. Naming it here rather than through the
 * constant is what stops that recurring.
 */
export class RawProcessor implements PostProcessor {
  name = 'raw';
  description = 'The entire document, unfiltered. For debugging; far too large to send.';

  async process(source: PageSource): Promise<ProcessedResult> {
    const html = source.document.documentElement?.outerHTML ?? '';

    return {
      processorName: this.name,
      contentType: 'text/html',
      content: html,
      title: source.document.title || 'Untitled Page',
      url: source.document.location?.href ?? '',
      metadata: { sourceChars: html.length, extractedChars: html.length, reduction: 0 },
    };
  }
}
