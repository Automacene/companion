import type { PostProcessor, RawDOMPayload, ProcessedResult } from './types';

export class BasicProcessor implements PostProcessor {
  name = 'basic';
  description = 'Strips out noise (scripts, styles, nav) and extracts clean text and links.';

  async process(payload: RawDOMPayload): Promise<ProcessedResult> {
    let html = payload.html || '';

    // Remove <script>, <style>, <noscript>, <iframe>, and <svg> blocks completely
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    html = html.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    html = html.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

    // Remove HTML comments
    html = html.replace(/<!--[\s\S]*?-->/gi, '');

    // Normalize anchor tags to preserve link targets alongside text: [Link Text](href)
    html = html.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text) => {
      const cleanText = text.replace(/<[^>]+>/g, '').trim();
      return cleanText ? ` [${cleanText}](${href}) ` : '';
    });

    // Strip remaining HTML tags while preserving spaces where block tags existed
    html = html.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>|<br\s*\/?>/gi, '\n');
    html = html.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    html = html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    //Collapse excessive whitespace and blank lines
    const cleanedContent = html
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');

    return {
      processorName: this.name,
      contentType: 'text/markdown',
      content: cleanedContent,
      metadata: {
        rawLength: payload.html.length,
        processedLength: cleanedContent.length,
        url: payload.url,
      },
    };
  }
}