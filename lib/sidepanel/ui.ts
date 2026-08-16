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

    // Always set, never only collapse. Loading an empty tab has to put the
    // hero back open AND write the button's accessible name, which starts
    // unset because the markup cannot know which state it will boot into.
    this.setHero(visible.length === 0);

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
    this.setHero(false);
  }

  public expandHero(): void {
    this.setHero(true);
  }

  /**
   * Flip the hero, and report where it ended up.
   *
   * The mark is the only control for this, so it has to work both ways —
   * opening the introduction with no way to put it away again leaves the panel
   * permanently shorter until a message is sent.
   */
  public toggleHero(): boolean {
    return this.setHero(this.hero?.classList.contains('is-collapsed') ?? false);
  }

  /**
   * The one place hero state is written.
   *
   * Three things move together: the class the layout reads, the mark reducing
   * to its square, and the button's accessible name. Splitting them across
   * collapse and expand is how they drift.
   *
   * @returns whether the hero is now open
   */
  private setHero(open: boolean): boolean {
    this.hero?.classList.toggle('is-collapsed', !open);
    setLogoMode(this.logo, open ? 'full' : 'mark');

    if (this.logo) {
      // The button IS the toggle, so its name has to say what pressing it does
      // next rather than what it did last.
      this.logo.setAttribute('aria-label', open ? 'Hide introduction' : 'Show introduction');
      this.logo.setAttribute('aria-expanded', String(open));
      this.logo.title = open ? 'Hide introduction' : 'Show introduction';
    }

    return open;
  }

  private resetSubmitButton(): void {
    this.runBtn.disabled = false;
    this.runBtn.textContent = 'Run →';
  }

  private scrollToBottom(): void {
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
}
