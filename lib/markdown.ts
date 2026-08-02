import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked options (e.g., enable line breaks)
marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content) as string;
  return DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target'], // Allow target="_blank" for links
  });
}