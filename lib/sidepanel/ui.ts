import { renderMarkdown } from '../markdown';
import { setLogoMode } from '../logo';
import type { ModelMessage } from 'ai';

/**
 * Renders the conversation into the message list.
 *
 * NOTE: the conversation layer is being replaced, so treat this as the least
 * settled file here. It is included in the reorganization so nothing is left
 * referencing the old class names.
 */
export class ChatUI {
  private activeAiBubble: HTMLDivElement | null = null;

  constructor(
    private chatContainer: HTMLElement,
    private runBtn: HTMLButtonElement,
    private hero: HTMLElement | null,
    /**
     * The mark. Collapsing the hero reduces it to the pulsing square, which
     * stays clickable and is the way back.
     */
    private logo: HTMLElement | null = null
  ) {}

  /**
   * Append a bubble and return the element its content lives in.
   */
  public appendBubble(role: 'user' | 'assistant', initialText = ''): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `ac-message ac-message--${role}`;

    const body = document.createElement('div');
    body.className = 'ac-message__body';

    const content = document.createElement('div');
    content.className = 'ac-message__content';

    if (role === 'assistant') {
      content.innerHTML = renderMarkdown(initialText);
    } else {
      content.textContent = initialText;
    }

    body.appendChild(content);
    row.appendChild(body);
    this.chatContainer.appendChild(row);
    this.scrollToBottom();

    return content;
  }

  /**
   * A non-message notice in the stream, for staged context and the like.
   */
  public appendSystemNotice(text: string): void {
    const row = document.createElement('div');
    row.className = 'ac-message ac-message--system';

    const body = document.createElement('div');
    body.className = 'ac-message__body';
    body.textContent = text;

    row.appendChild(body);
    this.chatContainer.appendChild(row);
    this.scrollToBottom();
  }

  public renderHistory(messages: ModelMessage[]): void {
    this.chatContainer.replaceChildren();
    const visible = messages.filter((m) => m.role !== 'system');

    if (visible.length > 0) {
      this.collapseHero();
    }

    for (const msg of visible) {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (msg.role === 'user' || msg.role === 'assistant') {
        this.appendBubble(msg.role, text);
      }
    }
  }

  public startStream(): void {
    this.collapseHero();
    this.runBtn.disabled = true;
    this.runBtn.textContent = 'Running...';
    this.activeAiBubble = this.appendBubble('assistant', '');
  }

  public updateStreamChunk(fullText: string): void {
    if (!this.activeAiBubble) return;
    this.activeAiBubble.innerHTML = renderMarkdown(fullText);
    this.scrollToBottom();
  }

  public completeStream(): void {
    this.resetSubmitButton();
    this.activeAiBubble = null;
  }

  public streamError(error: string): void {
    if (this.activeAiBubble) {
      this.activeAiBubble.textContent = `Error: ${error}`;
      // The error state sits on the bubble, not its content, so the whole
      // card recolours rather than just the text inside it.
      this.activeAiBubble.closest('.ac-message__body')?.classList.add('is-error');
    }
    this.resetSubmitButton();
    this.activeAiBubble = null;
  }

  public collapseHero(): void {
    this.hero?.classList.add('is-collapsed');
    setLogoMode(this.logo, 'mark');
  }

  public expandHero(): void {
    this.hero?.classList.remove('is-collapsed');
    setLogoMode(this.logo, 'full');
  }

  private resetSubmitButton(): void {
    this.runBtn.disabled = false;
    this.runBtn.textContent = 'Run →';
  }

  private scrollToBottom(): void {
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
}
