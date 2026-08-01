import type { ModelMessage } from 'ai';

export class VercelConversation {
  private messages: ModelMessage[] = [];
  private maxCharBudget: number;

  constructor(systemPrompt: string, maxCharBudget = 12000) {
    this.messages = [{ role: 'system', content: systemPrompt }];
    this.maxCharBudget = maxCharBudget;
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

  getMessages(): ModelMessage[] {
    // Check if system message exists (or use non-null assertion `this.messages[0]!`)
    const systemMsg = this.messages[0];
    if (!systemMsg) return [];

    const history = this.messages.slice(1);

    let currentLength = this.getContentLength(systemMsg.content);
    const trimmedHistory: ModelMessage[] = [];

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      // Handled if array element access returns undefined under noUncheckedIndexedAccess
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