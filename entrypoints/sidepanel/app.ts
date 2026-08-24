import { 
  DEFAULT_ACTIVE_MODEL, 
  OLLAMA_HOST, 
  SIDEPANEL_CONNECTION_NAME 
} from '../../lib/constants';
import { PortAction, ToolAction } from '../../types/actions';
import type { ExtensionSettings } from '../../types/state';
import type { ChatUI } from '../../lib/sidepanel/ui';
import type { ConnectionManager } from '../../lib/sidepanel/connection';
import type { BackdropHandle } from '../../lib/backdrop';

export class SidepanelApp {
  private port: Browser.runtime.Port;
  private currentActiveTabId = -1;

  constructor(
    private chatUI: ChatUI,
    private connectionManager: ConnectionManager,
    private chatForm: HTMLFormElement,
    private chatInput: HTMLTextAreaElement,
    private scrapeBtn: HTMLButtonElement | null,
    pulser: HTMLElement | null,
    private backdrop: BackdropHandle
  ) {
    this.port = browser.runtime.connect({ name: SIDEPANEL_CONNECTION_NAME });

    // Toggle, not just expand: the mark is the only way back in either
    // direction once the conversation has started.
    pulser?.addEventListener('click', () => this.chatUI.toggleHero());

    // Typing counts as activity, so the field does not downshift to its idle
    // rate while somebody is composing a long prompt.
    this.chatInput.addEventListener('input', () => this.backdrop.markActive());
  }

  public async init(): Promise<void> {
    this.currentActiveTabId = await this.getCurrentTabId();

    const settings = await this.fetchSettings();
    await this.connectionManager.updateStatus(settings.ollamaHost || OLLAMA_HOST);

    // Size it once before anything is typed. The CSS height and the height
    // computed from scrollHeight differ by a couple of pixels, and without this
    // the box visibly jumps on the first keystroke.
    this.resizeComposer();

    this.bindPortListeners();
    this.bindTabListeners();
    this.bindFormEvents();
    this.bindScrapeButton();

    this.requestTabHistory(this.currentActiveTabId);
  }

  private bindPortListeners(): void {
    this.port.onMessage.addListener((msg) => {
      switch (msg.action) {
        case PortAction.HISTORY_RESPONSE:
          this.chatUI.renderHistory(msg.messages);
          break;
        case PortAction.STREAM_CHUNK:
          this.chatUI.updateStreamChunk(msg.fullText);
          break;
        case PortAction.STREAM_COMPLETE:
          this.chatUI.completeStream();
          this.backdrop.setStreaming(false);
          break;
        case PortAction.STREAM_ERROR:
          this.chatUI.streamError(msg.error);
          this.backdrop.setStreaming(false);
          break;
        case 'SCRAPE_COMPLETE':
          this.handleScrapeComplete(msg.result);
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

    // Form submission
    this.chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = this.chatInput.value.trim();
      if (!prompt) return;

      const targetTabId = this.currentActiveTabId;
      const currentSettings = await this.fetchSettings();
      const hostUrl = currentSettings.ollamaHost || OLLAMA_HOST;
      const modelName = currentSettings.activeModel || DEFAULT_ACTIVE_MODEL;

      const isConnected = await this.connectionManager.updateStatus(hostUrl);
      if (!isConnected) {
        alert(
          `Ollama is not reachable at ${hostUrl}. Make sure Ollama is open and the host/model settings are correct.`
        );
        return;
      }

      this.chatUI.appendBubble('user', prompt);
      this.chatInput.value = '';
      this.resizeComposer();
      this.chatUI.startStream();
      this.backdrop.setStreaming(true);

      this.port.postMessage({
        action: PortAction.SEND_MESSAGE,
        tabId: targetTabId,
        prompt,
        hostUrl,
        modelName,
      });
    });
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

  private handleScrapeComplete(result: any): void {
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
    const tokens = Math.round(kept / 4).toLocaleString();
    const summary =
      source > kept
        ? `Page read: ~${tokens} tokens kept, ${reduction}% of the page dropped as navigation and chrome.`
        : `Page read: ~${tokens} tokens.`;

    this.chatUI.appendSystemNotice(
      meta.truncated
        ? `${summary} It hit the size limit, so the end was cut.`
        : `${summary} It attaches to your next message.`
    );
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
    this.chatInput.style.overflowY =
      this.chatInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
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