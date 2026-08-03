import { renderMarkdown } from '../markdown';
import type { ModelMessage } from 'ai';

export class ChatUI {
  private activeAiBubble: HTMLDivElement | null = null;

  constructor(
    private chatContainer: HTMLElement,
    private runBtn: HTMLButtonElement,
    private hero: HTMLElement | null
  ) {}

  public appendBubble(role: 'user' | 'assistant', initialText = ''): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-bubble-row ${role}`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;

    if (role === 'assistant') {
      bubble.classList.add('markdown-body');
      bubble.innerHTML = renderMarkdown(initialText);
    } else {
      bubble.innerText = initialText;
    }

    wrapper.appendChild(bubble);
    this.chatContainer.appendChild(wrapper);
    this.scrollToBottom();

    return bubble;
  }

  /**
   * Appends a non-message system notification badge in the chat log
   */
  public appendSystemNotice(text: string): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-bubble-row system-notice';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble system-notice';
    bubble.style.cssText = 'font-size: 0.75rem; color: #888; font-style: italic; padding: 4px 8px; border: 1px dashed #444; border-radius: 6px; margin: 4px 0;';
    bubble.innerText = `[System]: ${text}`;

    wrapper.appendChild(bubble);
    this.chatContainer.appendChild(wrapper);
    this.scrollToBottom();
  }

  public renderHistory(messages: ModelMessage[]): void {
    this.chatContainer.innerHTML = '';
    const nonSystem = messages.filter((m) => m.role !== 'system');

    if (nonSystem.length > 0) {
      this.collapseHero();
    }

    for (const msg of nonSystem) {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (msg.role === 'user' || msg.role === 'assistant') {
        this.appendBubble(msg.role, text);
      }
    }
  }

  public startStream(): void {
    this.collapseHero();
    this.runBtn.disabled = true;
    this.runBtn.innerText = 'Running...';
    this.activeAiBubble = this.appendBubble('assistant', '');
  }

  public updateStreamChunk(fullText: string): void {
    if (this.activeAiBubble) {
      this.activeAiBubble.innerHTML = renderMarkdown(fullText);
      this.scrollToBottom();
    }
  }

  public completeStream(): void {
    this.resetSubmitButton();
    this.activeAiBubble = null;
  }

  public streamError(error: string): void {
    if (this.activeAiBubble) {
      this.activeAiBubble.innerText = `Error: ${error}`;
      this.activeAiBubble.classList.add('text-rose-600');
    }
    this.resetSubmitButton();
    this.activeAiBubble = null;
  }

  public collapseHero(): void {
    this.hero?.classList.add('is-collapsed');
  }

  public expandHero(): void {
    this.hero?.classList.remove('is-collapsed');
  }

  private resetSubmitButton(): void {
    this.runBtn.disabled = false;
    this.runBtn.innerText = 'Run →';
  }

  private scrollToBottom(): void {
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
}