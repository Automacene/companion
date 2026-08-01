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
export async function streamChatResponse(
  settings: ModelSettings,
  messages: ModelMessage[],
  onChunk: (textDelta: string) => void
): Promise<string> {
  const openai = getOllamaVercelProvider(settings.ollamaHost);

  const result = streamText({
    model: openai(settings.activeModel),
    messages,
  });

  let fullResponse = '';

  for await (const delta of result.textStream) {
    fullResponse += delta;
    onChunk(delta);
  }

  return fullResponse;
}