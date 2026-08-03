import { DEFAULT_MAX_CHAR_BUDGET, DEFAULT_SYSTEM_PROMPT, MODEL_NAME, OLLAMA_HOST } from './constants';
import type { ModelMessage } from 'ai';

export interface PageContextSlot {
  title: string;
  url: string;
  content: string;
}

export class VercelConversation {
  private messages: ModelMessage[] = [];
  private maxCharBudget: number;
  private hostUrl: string;
  private modelName: string;
  private contextSlot: PageContextSlot | null = null;

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

  updateConfig(hostUrl?: string, modelName?: string): void {
    if (hostUrl) this.hostUrl = hostUrl;
    if (modelName) this.modelName = modelName;
  }

  setContext(title: string, url: string, content: string): void {
    this.contextSlot = { title, url, content };
  }

  hasContext(): boolean {
    return this.contextSlot !== null;
  }

  getContext(): PageContextSlot | null {
    return this.contextSlot;
  }

  clearContext(): void {
    this.contextSlot = null;
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

  addUser(content: string): void {
    let finalPrompt = content;

    if (this.contextSlot) {
      const { title, url, content: pageContent } = this.contextSlot;
      const systemLen = this.getContentLength(this.messages[0]?.content || '');
      const promptLen = content.length;
      
      const maxAllowedDomLen = Math.max(1000, this.maxCharBudget - systemLen - promptLen - 3000);
      
      let safePageContent = pageContent;
      if (safePageContent.length > maxAllowedDomLen) {
        safePageContent = `${safePageContent.slice(0, maxAllowedDomLen)}\n\n... [PAGE CONTEXT TRUNCATED TO FIT MODEL MEMORY BUDGET]`;
      }

      finalPrompt = `[PAGE CONTEXT INGESTED]\nTitle: ${title}\nURL: ${url}\n\nContent:\n${safePageContent}\n\n[USER PROMPT]\n${content}`;
      this.clearContext();
    }

    this.messages.push({ role: 'user', content: finalPrompt });
  }

  addAssistant(content: string): void {
    this.messages.push({ role: 'assistant', content });
  }

  updateSystemPrompt(content: string): void {
    if (this.messages.length > 0 && this.messages[0]?.role === 'system') {
      this.messages[0].content = content;
    } else {
      this.messages.unshift({ role: 'system', content });
    }
  }

  /**
   * Returns the FULL un-truncated conversation log for UI rendering.
   */
  getHistory(): ModelMessage[] {
    return [...this.messages];
  }

  /**
   * Returns the budget-controlled window for Ollama model execution.
   */
  getMessages(): ModelMessage[] {
    const systemMsg = this.messages[0];
    if (!systemMsg) return [];

    const history = this.messages.slice(1);
    if (history.length === 0) return [systemMsg];

    let currentLength = this.getContentLength(systemMsg.content);
    const trimmedHistory: ModelMessage[] = [];

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (!msg) continue;

      const len = this.getContentLength(msg.content);

      if (trimmedHistory.length > 0 && currentLength + len > this.maxCharBudget) {
        break;
      }

      currentLength += len;
      trimmedHistory.unshift(msg);
    }

    while (trimmedHistory.length > 1 && trimmedHistory[0]?.role === 'assistant') {
      trimmedHistory.shift();
    }

    return [systemMsg, ...trimmedHistory];
  }

  clear(): void {
    this.clearContext();
    const systemMsg = this.messages[0];
    if (systemMsg) {
      this.messages = [systemMsg];
    }
  }
}