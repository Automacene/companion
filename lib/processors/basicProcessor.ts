import { extractPage } from '../extract';
import type { PageSource, PostProcessor, ProcessedResult } from './types';

/**
 * The default processor: what a person would read, and nothing else.
 *
 * Everything it drops is dropped for a stated reason rather than by pattern
 * matching on tags. Script and style never held readable text. Navigation,
 * headers, footers and sidebars are furniture. Anything not currently on screen
 * was not being read by anyone, which covers collapsed menus, inactive tabs,
 * and the duplicate copy of a layout that sites render for a different screen
 * width and hide with CSS.
 *
 * What survives is the block with the most text that is not link text, rendered
 * with its headings, lists and code blocks intact.
 */
export class BasicProcessor implements PostProcessor {
  name = 'basic';
  description = 'Keeps the readable content and drops navigation, chrome, and anything off screen.';

  async process(source: PageSource): Promise<ProcessedResult> {
    const result = extractPage(source.document, {
      maxChars: source.maxChars,
      visibleOnly: true,
      // Link targets roughly double the cost of a link and the model can rarely act on them.
      keepLinks: false,
    });

    return {
      processorName: this.name,
      contentType: 'text/markdown',
      content: result.text,
      title: result.title,
      url: result.url,
      metadata: {
        ...result.meta,
        // The ratio that matters when judging whether a scrape went well.
        reduction: result.meta.sourceChars
          ? Math.round((1 - result.meta.extractedChars / result.meta.sourceChars) * 100)
          : 0,
      },
    };
  }
}
