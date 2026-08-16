import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type ModelMessage } from 'ai';

export interface OllamaModel {
  name: string;
}

export interface ModelSettings {
  ollamaHost: string;
  activeModel: string;
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
  onChunk: (textDelta: string) => void
): Promise<string> {
  const cleanHost = settings.ollamaHost.replace(/\/+$/, '');
  
  const response = await fetch(`${cleanHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.activeModel,
      messages: normalizeMessages(messages),
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama HTTP error! status: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const content = parsed.message?.content || '';
        if (content) {
          fullResponse += content;
          onChunk(content);
        }
      } catch {
        // Skip malformed chunk segments
      }
    }
  }

  return fullResponse;
}