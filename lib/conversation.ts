import { DEFAULT_MAX_CHAR_BUDGET, DEFAULT_SYSTEM_PROMPT, MODEL_NAME, OLLAMA_HOST } from './constants';
import type { ModelMessage } from 'ai';

export class VercelConversation {
  private messages: ModelMessage[] = [];
  private maxCharBudget: number;
  private hostUrl: string;
  private modelName: string;

  constructor(
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT, 
    maxCharBudget = DEFAULT_MAX_CHAR_BUDGET,
    hostUrl: string = OLLAMA_HOST,
    modelName: string = MODEL_NAME
  ) {
    this.messages = [{ role: 'system', content: systemPrompt }];
    this.maxCharBudget = maxCharBudget;
    this.hostUrl = hostUrl;
    this.modelName = modelName;
  }

  getHostUrl(): string {
    return this.hostUrl;
  }

  getModelName(): string {
    return this.modelName;
  }

  updateConfig(hostUrl?: string, modelName?: string) {
    if (hostUrl) this.hostUrl = hostUrl;
    if (modelName) this.modelName = modelName;
  }

  private getContentLength(content: ModelMessage['content']): number {
    if (typeof content === 'string') {
      return content.length;
    }
    if (Array.isArray(content)) {
      return JSON.stringify(content).length;
    }
    return 0;
  }

  addUser(content: string) {
    this.messages.push({ role: 'user', content });
  }

  addAssistant(content: string) {
    this.messages.push({ role: 'assistant', content });
  }

  updateSystemPrompt(content: string) {
    if (this.messages.length > 0 && this.messages[0]?.role === 'system') {
      this.messages[0].content = content;
    } else {
      this.messages.unshift({ role: 'system', content });
    }
  }

  /**
   * Injects scraped DOM or external context directly into conversation state.
   * Marked clearly so the LLM understands it is background context, not user speech.
   */
  addContext(title: string, url: string, content: string) {
    const formattedContext = `[PAGE CONTEXT INGESTED]\nTitle: ${title}\nURL: ${url}\n\nContent:\n${content}`;
    this.messages.push({
      role: 'user',
      content: formattedContext,
    });

    this.messages.push({
      role: 'assistant',
      content: `I have received and ingested the page context for "${title}". How can I help you with this page?`,
    });
  }

  getMessages(): ModelMessage[] {
    const systemMsg = this.messages[0];
    if (!systemMsg) return [];

    const history = this.messages.slice(1);

    let currentLength = this.getContentLength(systemMsg.content);
    const trimmedHistory: ModelMessage[] = [];

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (!msg) continue;

      const len = this.getContentLength(msg.content);

      if (currentLength + len > this.maxCharBudget) break;

      currentLength += len;
      trimmedHistory.unshift(msg);
    }

    return [systemMsg, ...trimmedHistory];
  }

  clear() {
    const systemMsg = this.messages[0];
    if (systemMsg) {
      this.messages = [systemMsg];
    }
  }
}