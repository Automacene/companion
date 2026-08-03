export interface RawDOMPayload {
  title: string;
  url: string;
  html: string;           // Unmodified raw HTML / DOM string
  selectedText?: string;  // Optional user text selection
  metadata?: Record<string, unknown>;
}

export interface ProcessedResult {
  processorName: string;
  contentType: 'text/plain' | 'text/markdown' | 'application/json' | 'text/html';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PostProcessor {
  name: string;
  description: string;
  process(payload: RawDOMPayload): Promise<ProcessedResult>;
}
