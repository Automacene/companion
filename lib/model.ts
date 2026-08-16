import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type ModelMessage } from 'ai';
import type { RequestShape } from './ollama-options';
import { readMetrics, type LastRun } from './last-run';

export interface OllamaModel {
  name: string;
}

export interface ModelSettings {
  ollamaHost: string;
  activeModel: string;
  /**
   * Sampling parameters, keep-alive, and the stream toggle, already derived
   * from the user's settings by `lib/ollama-options.ts`. Optional so a caller
   * that only wants a plain completion does not have to build one.
   */
  request?: RequestShape;
}

/**
 * Creates an official Vercel AI SDK provider pointing to 
 * Ollama's local OpenAI-compatible endpoint (/v1)
 */
export function getOllamaVercelProvider(hostUrl: string) {
  const cleanHost = hostUrl.replace(/\/+$/, '');
  
  return createOpenAI({
    baseURL: `${cleanHost}/v1`,
    apiKey: 'ollama', // Required placeholder for TypeScript
  });
}

/**
 * Health check & model discovery using local Ollama endpoint
 */
export async function checkOllamaConnection(
  hostUrl: string
): Promise<{ success: boolean; models: OllamaModel[]; error?: string }> {
  try {
    const cleanHost = hostUrl.replace(/\/+$/, '');
    const res = await fetch(`${cleanHost}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const models: OllamaModel[] = data?.models || [];
    return { success: true, models };
  } catch (err) {
    return { success: false, models: [], error: (err as Error).message };
  }
}

/**
 * Pure Vercel AI SDK streaming handler
 */
function normalizeMessages(messages: ModelMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return {
        role: message.role,
        content: message.content,
      };
    }

    return {
      role: message.role,
      content: Array.isArray(message.content)
        ? message.content
            .filter((part) => part && part.type === 'text')
            .map((part) => part.text)
            .join('')
        : String(message.content || ''),
    };
  });
}

export async function streamChatResponse(
  settings: ModelSettings,
  messages: ModelMessage[],
  onChunk: (textDelta: string) => void,
  signal?: AbortSignal,
  /**
   * Receives the timings and token counts Ollama attaches to the final object.
   * They were previously parsed and thrown away.
   */
  onMetrics?: (metrics: LastRun) => void
): Promise<string> {
  const cleanHost = settings.ollamaHost.replace(/\/+$/, '');
  const shape = settings.request;

  const response = await fetch(`${cleanHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: settings.activeModel,
      messages: normalizeMessages(messages),
      stream: shape?.stream ?? true,

      // Omitted rather than sent empty. Ollama treats a missing key as "use the
      // model's default", and there is no value that means the same thing — so
      // an empty options object has to actually be absent.
      ...(shape?.extras ?? {}),
      ...(shape && Object.keys(shape.options).length > 0 ? { options: shape.options } : {}),
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama HTTP error! status: ${response.status}`);
  }

  // Streaming off still returns one JSON object, just all at once. Reading it
  // as a whole body rather than pushing it through the line parser keeps the
  // two paths from having to agree about buffering.
  if (shape?.stream === false) {
    const payload = await response.json();

    // The whole body is the final object when not streaming, so it carries the
    // metrics directly.
    const metrics = readMetrics(payload, settings.activeModel);
    if (metrics) onMetrics?.(metrics);

    const text: string = payload?.message?.content ?? '';
    if (text) onChunk(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';

  // Ollama emits newline-delimited JSON, and a chunk boundary can land in the
  // middle of a line. Anything after the last newline is held back until the
  // next read completes it, otherwise long replies drop tokens at random.
  let pending = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });

    const lines = pending.split('\n');
    pending = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;

      const text = parsed.message?.content ?? '';
      if (text) {
        fullResponse += text;
        onChunk(text);
      }

      const metrics = readMetrics(parsed, settings.activeModel);
      if (metrics) onMetrics?.(metrics);
    }
  }

  // Whatever is left after the stream ends is a complete line or nothing.
  const tail = parseLine(pending);
  if (tail) {
    const text = tail.message?.content ?? '';
    if (text) {
      fullResponse += text;
      onChunk(text);
    }

    const metrics = readMetrics(tail, settings.activeModel);
    if (metrics) onMetrics?.(metrics);
  }

  return fullResponse;
}

/**
 * Parse one NDJSON line, or null if it is blank or incomplete.
 *
 * Returns the whole object rather than just the text, because the last line of
 * a stream carries no content at all — only `done: true` and the run metrics.
 * Pulling the text out here would have discarded them.
 */
function parseLine(line: string): any | null {
  if (!line.trim()) return null;

  try {
    return JSON.parse(line);
  } catch {
    return null; // partial or malformed line
  }
}
