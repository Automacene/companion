import { DEFAULT_ACTIVE_MODEL, OLLAMA_HOST, SIDEPANEL_CONNECTION_NAME } from '../../lib/constants';
import { PortAction, ToolAction } from '../../types/actions';
import type { ExtensionSettings } from '../../types/state';
import type { ChatUI } from '../../lib/sidepanel/ui';
import type { ConnectionManager } from '../../lib/sidepanel/connection';
import type { BackdropHandle } from '../../lib/backdrop';

/**
 * How long ago, in words.
 *
 * Rounded and plain rather than a timestamp. The question this answers is
 * "have I read this recently enough that reading it again is pointless", and a
 * date makes you do that arithmetic yourself.
 */
function describeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/**
 * The overlap sentence, coloured by how much of the reading was redundant.
 *
 * Green for nothing already stored through to red for all of it, because that
 * is the direction the news is good in: a reread that learned nothing cost a
 * duplicate copy and the recall slots that come with it, while a page that had
 * changed completely was worth reading again.
 *
 * Only the hue is set here. Saturation and lightness are palette tokens, so the
 * colour stays legible on both the light and dark backgrounds instead of a
 * single pair of values washing out on one of them. The endpoints are the hues
 * of the palette's own success and danger colours rather than pure green and
 * red, so this reads as part of the same set.
 */
const OVERLAP_HUE_CLEAR = 161;
const OVERLAP_HUE_STALE = 0;

function overlapText(sentence: string, ratio: number): HTMLElement {
  const span = document.createElement('span');
  span.className = 'sidepanel__overlap';
  span.textContent = sentence;

  const hue = OVERLAP_HUE_CLEAR + (OVERLAP_HUE_STALE - OVERLAP_HUE_CLEAR) * clamp01(ratio);
  span.style.setProperty('--ac-overlap-hue', Math.round(hue).toString());

  return span;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * If a turn produces no terminal message within this, the composer unlocks
 * anyway. A model loading cold can legitimately take a minute, so this is long
 * — it exists to stop the panel becoming permanently unusable, not to time
 * anything out.
 */
const REPLY_WATCHDOG_MS = 5 * 60 * 1000;

export class SidepanelApp {
  private port: Browser.runtime.Port;
  private currentActiveTabId = -1;

  /**
   * Whether a reply is in flight.
   *
   * Held here rather than read off the submit button's `disabled` state, which
   * is what it used to be. Two things went wrong with that. `requestSubmit()`
   * behaves as if the default submit button were clicked, so while the button
   * was disabled every Enter press was silently swallowed — a typed message
   * would vanish with no indication. And if a terminal message was ever missed,
   * the button stayed disabled forever, which made the composer permanently
   * dead rather than briefly stuck.
   */
  private awaitingReply = false;

  /** Cleared whenever the turn ends, however it ends. */
  private watchdog: number | undefined;

  /**
   * Settings, kept rather than re-fetched on every send.
   *
   * Each send used to make a round trip to the worker before it could post
   * anything, which widened the window in which a second submit could arrive
   * and be swallowed.
   */
  private settings: ExtensionSettings = {};

  constructor(
    private chatUI: ChatUI,
    private connectionManager: ConnectionManager,
    private chatForm: HTMLFormElement,
    private chatInput: HTMLTextAreaElement,
    private scrapeBtn: HTMLButtonElement | null,
    pulser: HTMLElement | null,
    private backdrop: BackdropHandle,
  ) {
    this.port = this.connect();

    // Toggle, not just expand: the mark is the only way back in either
    // direction once the conversation has started.
    pulser?.addEventListener('click', () => this.chatUI.toggleHero());

    // Typing counts as activity, so the field does not downshift to its idle
    // rate while somebody is composing a long prompt.
    this.chatInput.addEventListener('input', () => this.backdrop.markActive());
  }

  /**
   * Open the port, and notice when it dies.
   *
   * MV3 stops the service worker whenever it decides the worker is idle, and
   * that tears down every port with it. If it happens mid-reply the panel is
   * left waiting for a STREAM_COMPLETE that nothing can send any more, which
   * is the most likely way the composer ends up locked after a few turns.
   *
   * Reconnecting on demand is the documented way to handle this: the next
   * message wakes a fresh worker.
   */
  private connect(): Browser.runtime.Port {
    const port = browser.runtime.connect({ name: SIDEPANEL_CONNECTION_NAME });

    port.onDisconnect.addListener(() => {
      this.port = this.connect();
      this.bindPortListeners();

      if (!this.awaitingReply) return;

      // A reply was in flight. It is not coming back, so say so and unlock
      // rather than leaving the composer dead.
      this.chatUI.streamError(
        'The extension restarted while replying. Your message was not answered — send it again.',
      );
      this.endReply();
    });

    return port;
  }

  public async init(): Promise<void> {
    this.currentActiveTabId = await this.getCurrentTabId();

    this.settings = await this.fetchSettings();
    await this.connectionManager.updateStatus(this.settings.ollamaHost || OLLAMA_HOST);

    // Settings are shared through storage, so the panel follows a change made
    // on either settings page without asking the worker again.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const updated = changes.extensionSettings?.newValue as ExtensionSettings | undefined;
      if (updated) this.settings = updated;
    });

    // Size it once before anything is typed. The CSS height and the height
    // computed from scrollHeight differ by a couple of pixels, and without this
    // the box visibly jumps on the first keystroke.
    this.resizeComposer();

    this.bindPortListeners();
    this.bindTabListeners();
    this.bindFormEvents();
    this.bindScrapeButton();
    this.bindDetachButton();

    this.requestTabHistory(this.currentActiveTabId);
    this.requestPageStatus();
  }

  private bindPortListeners(): void {
    this.port.onMessage.addListener((msg) => {
      switch (msg.action) {
        case PortAction.HISTORY_RESPONSE:
          this.chatUI.renderHistory(msg.turns ?? []);
          break;
        case PortAction.STREAM_CHUNK:
          this.chatUI.updateStreamChunk(msg.fullText);
          break;
        case PortAction.STREAM_COMPLETE:
          this.chatUI.completeStream();
          this.endReply();
          break;
        case PortAction.STREAM_ERROR:
          this.chatUI.streamError(msg.error);
          this.endReply();
          break;
        case 'SCRAPE_COMPLETE':
          this.handleScrapeComplete(msg.result, msg.comparison, msg.page);
          break;
        case PortAction.PAGE_STATUS_RESPONSE:
          this.renderPageStatus(msg);
          break;
        case 'SCRAPE_ERROR':
          this.handleScrapeError(msg.error);
          break;
      }
    });
  }

  private bindTabListeners(): void {
    browser.tabs.onActivated.addListener(async (activeInfo) => {
      this.currentActiveTabId = activeInfo.tabId;
      this.requestTabHistory(this.currentActiveTabId);
      this.requestPageStatus();
    });

    /*
      Navigating within a tab changes the page without changing the tab, so
      `onActivated` never fires. Without this the line would keep describing the
      page you were on three links ago, which is the opposite of predictable.
    */
    browser.tabs.onUpdated.addListener((tabId, changed) => {
      if (tabId !== this.currentActiveTabId) return;
      if (!changed.url && changed.status !== 'complete') return;
      this.requestPageStatus();
    });
  }

  private bindFormEvents(): void {
    /**
     * Enter sends, Shift+Enter inserts a newline.
     *
     * The composer used to be an `<input>`, where Enter submitted the form for
     * free and the handler here had to fake a newline by splicing the value.
     * It is a `<textarea>` now, which reverses both: newlines are native, and
     * Enter no longer submits anything — so the browser's default has to be
     * cancelled and the submit driven by hand.
     *
     * `isComposing` guards an IME. Enter is how you accept a candidate word in
     * Japanese, Chinese, and Korean input, and swallowing it would send a
     * half-finished message mid-word.
     */
    this.chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;

      e.preventDefault();
      this.chatForm.requestSubmit();
    });

    // Grow with the text rather than scrolling a single line, now that a
    // message can genuinely be several lines long.
    this.chatInput.addEventListener('input', () => this.resizeComposer());

    this.chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      /*
        Refuse rather than swallow.

        A submit arriving mid-reply used to disappear: the button was disabled,
        so `requestSubmit()` did nothing at all and the text stayed in the box
        with no explanation. Saying so is the whole difference.
      */
      if (this.awaitingReply) {
        this.chatUI.appendSystemNotice('Still replying — wait for this one to finish.');
        return;
      }

      const prompt = this.chatInput.value.trim();
      if (!prompt) return;

      const targetTabId = this.currentActiveTabId;

      this.chatUI.appendBubble('user', prompt);
      this.chatInput.value = '';
      this.resizeComposer();

      this.beginReply();

      this.port.postMessage({
        action: PortAction.SEND_MESSAGE,
        tabId: targetTabId,
        prompt,
      });

      /*
        The connectivity check happens AFTER the send, not before it.

        It used to be awaited first and used to decide whether to send at all,
        which put a network round trip between pressing Enter and anything
        happening. The worker reports a failure through STREAM_ERROR anyway, so
        this only updates the status light.
      */
      void this.connectionManager.updateStatus(this.settings.ollamaHost || OLLAMA_HOST);
    });
  }

  /** Lock the composer and arm the watchdog. */
  private beginReply(): void {
    this.awaitingReply = true;
    this.chatUI.startStream();
    this.backdrop.setStreaming(true);

    window.clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => {
      // Nothing came back. Unlock regardless — a missing message must not cost
      // the user the ability to type.
      this.chatUI.streamError(
        'No reply came back. The model may still be loading, or the extension may have restarted.',
      );
      this.endReply();
    }, REPLY_WATCHDOG_MS);
  }

  /** Unlock the composer. Safe to call twice. */
  private endReply(): void {
    this.awaitingReply = false;
    window.clearTimeout(this.watchdog);
    this.watchdog = undefined;
    this.backdrop.setStreaming(false);
  }

  private bindScrapeButton(): void {
    if (!this.scrapeBtn) return;

    this.scrapeBtn.addEventListener('click', async () => {
      if (this.currentActiveTabId === -1) {
        alert('No active tab available to scrape.');
        return;
      }

      this.scrapeBtn!.disabled = true;
      this.scrapeBtn!.innerText = 'Scraping...';

      this.port.postMessage({
        action: ToolAction.SCRAPE_DOM,
        tabId: this.currentActiveTabId,
      });
    });
  }

  /** Ask the worker what it already holds for the page this tab is showing. */
  private requestPageStatus(): void {
    if (this.currentActiveTabId === -1) return;
    this.port.postMessage({ action: PortAction.PAGE_STATUS, tabId: this.currentActiveTabId });
  }

  /**
   * The line beside the buttons, and whether the remove button is offered.
   *
   * Always says something when there is a page to say it about. A status that
   * is blank half the time cannot be relied on, and the point of putting it
   * here is that you glance at the same spot every time and know where you
   * stand before pressing anything.
   */
  private renderPageStatus(msg: {
    url?: string | null;
    lastReadAt?: number | null;
    attached?: { title?: string; url?: string } | null;
  }): void {
    const status = document.getElementById('page-status');
    const detach = document.getElementById('detach-btn') as HTMLButtonElement | null;

    if (detach) {
      detach.hidden = !msg.attached;
      detach.disabled = false;
      detach.textContent = 'Remove page';
    }

    if (!status) return;

    status.classList.remove('is-known');

    if (!msg.url) {
      status.textContent = '';
      return;
    }

    if (!msg.lastReadAt) {
      status.textContent = 'not read before';
      return;
    }

    status.classList.add('is-known');
    status.textContent = `read ${describeAge(Date.now() - msg.lastReadAt)}`;
  }

  private bindDetachButton(): void {
    const detach = document.getElementById('detach-btn') as HTMLButtonElement | null;
    if (!detach) return;

    detach.addEventListener('click', () => {
      if (this.currentActiveTabId === -1) return;

      detach.disabled = true;
      detach.textContent = 'Removing…';
      this.port.postMessage({ action: PortAction.DETACH_PAGE, tabId: this.currentActiveTabId });

      this.chatUI.appendSystemNotice(
        'Page removed. It is no longer attached to your messages and none of it was kept.',
      );
    });
  }

  private handleScrapeComplete(result: any, comparison?: any, _page?: any): void {
    // Context landed. The field brightens for a moment, which is the one place
    // the backdrop reports something instead of only decorating.
    this.backdrop.pulse();

    if (this.scrapeBtn) {
      this.scrapeBtn.disabled = false;
      this.scrapeBtn.textContent = 'Scraped';
      setTimeout(() => {
        if (this.scrapeBtn) this.scrapeBtn.textContent = 'Scrape';
      }, 2000);
    }

    const meta = result?.metadata ?? {};
    const kept: number = meta.extractedChars ?? 0;
    const source: number = meta.sourceChars ?? 0;
    const reduction: number = meta.reduction ?? 0;

    /*
      Report what was KEPT, not what was found.

      The old notice said "Page context staged (603,821 chars)", which reads as
      a success and was the opposite. That figure was the whole document; the
      budget then kept the first 8,868 characters of it, and on that page the
      first 8,868 characters were the navigation bar. The model was handed a
      menu and said, correctly, that no content had been provided.
    */
    /*
      Nothing read is its own outcome and says so.

      This used to report "~0 tokens kept, 100% dropped" in the same shape as a
      successful read, which reads as though the page were genuinely empty. It
      was not — the extractor had failed on it — and the model still received
      the title and URL, so it would answer as if it had read the page while
      knowing only its name.
    */
    if (kept === 0) {
      this.chatUI.appendSystemNotice(
        'Nothing could be read from that page. Only its title and address will be ' +
          'attached, so the model will know which page you mean but not what is on it. ' +
          'Scrolling the content into view and reading again usually works.',
      );
      return;
    }

    /*
      How much of this reading was already stored.

      Reported as sections rather than characters. A site that reflows its
      navigation changes a great many characters while saying nothing new, so a
      character ratio swings for reasons nobody cares about, where a paragraph
      either came back or it did not.
    */
    let overlap: HTMLElement | undefined;
    if (comparison?.hadPrevious && comparison.total > 0) {
      const percent = Math.round(comparison.ratio * 100);

      let sentence: string;
      if (comparison.identical) {
        sentence = ' Identical to what was already stored — nothing new was learned.';
      } else if (comparison.unchanged === 0) {
        // Worth saying out loud rather than staying silent. On a front page
        // that turns over daily this is the normal answer, and it is the reason
        // rereading was worth it.
        sentence = ` None of it was already stored — all ${comparison.total} sections are new.`;
      } else {
        sentence =
          ` ${percent}% of it was already stored ` +
          `(${comparison.unchanged} of ${comparison.total} sections unchanged).`;
      }

      overlap = overlapText(sentence, comparison.ratio);
    }

    const tokens = Math.round(kept / 4).toLocaleString();
    const summary =
      source > kept
        ? `Page read: ~${tokens} tokens kept, ${reduction}% of the page dropped as navigation and chrome.`
        : `Page read: ~${tokens} tokens.`;

    this.chatUI.appendSystemNotice(
      meta.truncated
        ? `${summary} It hit the size limit, so the end was cut.`
        : `${summary} It attaches to your next message.`,
      overlap,
    );

    /*
      Refresh the line beside the button.

      Without this the status keeps describing the state before the scrape —
      still saying the page was read hours ago, still not offering to remove a
      page that is now attached — until something else happens to refresh it.
      Reloading the panel was the only way to see the truth.
    */
    this.requestPageStatus();
  }

  private handleScrapeError(error: string): void {
    if (this.scrapeBtn) {
      this.scrapeBtn.disabled = false;
      this.scrapeBtn.innerText = 'Scrape';
    }
    alert(`Scrape failed: ${error}`);
  }

  /**
   * Fit the composer to its content, up to a ceiling.
   *
   * Height is reset before measuring because `scrollHeight` never shrinks below
   * the element's current height — without the reset, deleting a line would
   * leave the box permanently tall.
   */
  private resizeComposer(): void {
    const maxHeight = 10 * 16; // about ten lines

    this.chatInput.style.height = 'auto';
    this.chatInput.style.height = `${Math.min(this.chatInput.scrollHeight, maxHeight)}px`;
    this.chatInput.style.overflowY = this.chatInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  private requestTabHistory(tabId: number): void {
    if (tabId !== -1) {
      this.port.postMessage({
        action: PortAction.GET_HISTORY,
        tabId,
      });
    }
  }

  private fetchSettings(): Promise<ExtensionSettings> {
    return new Promise((resolve) => {
      const handleResponse = (msg: any) => {
        if (msg.action === 'SETTINGS_RESPONSE') {
          this.port.onMessage.removeListener(handleResponse);
          resolve(msg.settings || {});
        } else if (msg.action === 'SETTINGS_ERROR') {
          this.port.onMessage.removeListener(handleResponse);
          console.error('[Sidepanel] Failed to retrieve settings:', msg.error);
          resolve({});
        }
      };

      this.port.onMessage.addListener(handleResponse);
      this.port.postMessage({ action: PortAction.GET_SETTINGS });
    });
  }

  private async getCurrentTabId(): Promise<number> {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id ?? -1;
    } catch {
      return -1;
    }
  }
}
