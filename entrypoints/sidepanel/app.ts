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

    pulser?.addEventListener('click', () => this.chatUI.expandHero());

    // Typing counts as activity, so the field does not downshift to its idle
    // rate while somebody is composing a long prompt.
    this.chatInput.addEventListener('input', () => this.backdrop.markActive());
  }

  public async init(): Promise<void> {
    this.currentActiveTabId = await this.getCurrentTabId();

    const settings = await this.fetchSettings();
    await this.connectionManager.updateStatus(settings.ollamaHost || OLLAMA_HOST);

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
    // Shift+Enter newline handling
    this.chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const start = this.chatInput.selectionStart ?? this.chatInput.value.length;
        const end = this.chatInput.selectionEnd ?? this.chatInput.value.length;
        const val = this.chatInput.value;
        this.chatInput.value = `${val.slice(0, start)}\n${val.slice(end)}`;
        const pos = start + 1;
        this.chatInput.setSelectionRange(pos, pos);
      }
    });

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
      this.scrapeBtn.innerText = 'Scraped!';
      setTimeout(() => {
        if (this.scrapeBtn) this.scrapeBtn.innerText = 'Scrape';
      }, 2000);
    }
    const charCount = result?.metadata?.rawLength || 0;
    this.chatUI.appendSystemNotice(`Page context staged (${charCount.toLocaleString()} chars). It will attach to your next message.`);
  }

  private handleScrapeError(error: string): void {
    if (this.scrapeBtn) {
      this.scrapeBtn.disabled = false;
      this.scrapeBtn.innerText = 'Scrape';
    }
    alert(`Scrape failed: ${error}`);
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