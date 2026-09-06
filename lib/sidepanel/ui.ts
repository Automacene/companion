import { renderMarkdown } from '../markdown';
import { setLogoMode } from '../logo';
import type { ThreadTurn } from '../background/thread';

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
    private logo: HTMLElement | null = null,
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
   * A non-message notice in the stream.
   *
   * `tail` is appended after the text as a real node, for the rare case where
   * part of a notice needs its own styling. Text stays `textContent` so nothing
   * a page supplied can be interpreted as markup; the caller builds the node it
   * wants instead of handing over a string of HTML.
   */
  public appendSystemNotice(text: string, tail?: Node): void {
    const row = document.createElement('div');
    row.className = 'ac-message ac-message--system';

    const body = document.createElement('div');
    body.className = 'ac-message__body';
    body.textContent = text;
    if (tail) body.appendChild(tail);

    row.appendChild(body);
    this.chatContainer.appendChild(row);
    this.scrollToBottom();
  }

  /**
   * Rebuild the whole conversation from storage.
   *
   * The panel throws its DOM away and calls this on every tab switch, so this
   * is the scrollback rather than an optimisation.
   *
   * It takes TURNS now, not messages. A turn holds both halves of an exchange
   * and carries a stable id, where the old message array was a flat list in
   * which a question and its answer were unrelated entries. That matters here
   * because a turn can be open - `response` is null until it closes - and only
   * a turn can say so.
   */
  public renderHistory(turns: ThreadTurn[]): void {
    this.chatContainer.replaceChildren();

    // Always set, never only collapse.
    this.setHero(turns.length === 0);

    for (const turn of turns) {
      if (turn.query) {
        // A page read shows as a marker, not as the page.
        if (turn.page?.title || turn.page?.url) {
          this.appendPageMarker(turn.page.title || turn.page.url);
        }
        this.appendBubble('user', turn.query);
      }

      if (turn.response !== null && turn.response !== undefined) {
        this.appendBubble('assistant', turn.response);
      } else {
        // An open turn.
        this.appendPending();
      }
    }
  }

  /** A question whose answer never arrived, or has not arrived yet. */
  private appendPending(): void {
    const row = document.createElement('div');
    row.className = 'ac-message ac-message--assistant ac-message--pending';

    const body = document.createElement('div');
    body.className = 'ac-message__body';
    body.textContent = 'No reply was recorded for this message.';

    row.appendChild(body);
    this.chatContainer.appendChild(row);
    this.scrollToBottom();
  }

  /** The one-line note that a page was attached to the message below it. */
  private appendPageMarker(label: string): void {
    const row = document.createElement('div');
    row.className = 'ac-message ac-message--note';

    const body = document.createElement('div');
    body.className = 'ac-message__body';
    body.textContent = `Read: ${label}`;

    row.appendChild(body);
    this.chatContainer.appendChild(row);
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
      // The error state sits on the bubble, not its content.
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
   * The mark is the only control for this, so it has to work both ways -
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
      // The button IS the toggle.
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
