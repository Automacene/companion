import { 
  DEFAULT_ACTIVE_MODEL, 
  OLLAMA_HOST, 
  SIDEPANEL_CONNECTION_NAME 
} from '../../lib/constants';
import { PortAction } from '../../types/actions';
import type { ExtensionSettings } from '../../types/state';
import type { ChatUI } from '../../lib/sidepanel/ui';
import type { ConnectionManager } from '../../lib/sidepanel/connection';

export class SidepanelApp {
  private port: Browser.runtime.Port;
  private currentActiveTabId = -1;

  constructor(
    private chatUI: ChatUI,
    private connectionManager: ConnectionManager,
    private chatForm: HTMLFormElement,
    private chatInput: HTMLTextAreaElement,
    pulser: HTMLElement | null
  ) {
    this.port = browser.runtime.connect({ name: SIDEPANEL_CONNECTION_NAME });

    pulser?.addEventListener('click', () => this.chatUI.expandHero());
  }

  public async init(): Promise<void> {
    this.currentActiveTabId = await this.getCurrentTabId();

    const settings = await this.fetchSettings();
    await this.connectionManager.updateStatus(settings.ollamaHost || OLLAMA_HOST);

    this.bindPortListeners();
    this.bindTabListeners();
    this.bindFormEvents();

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
          break;
        case PortAction.STREAM_ERROR:
          this.chatUI.streamError(msg.error);
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

      this.port.postMessage({
        action: PortAction.SEND_MESSAGE,
        tabId: targetTabId,
        prompt,
        hostUrl,
        modelName,
      });
    });
  }

  private requestTabHistory(tabId: number): void {
    if (tabId !== -1) {
      this.port.postMessage({
        action: PortAction.GET_HISTORY,
        tabId,
      });
    }
  }

  /**
   * Triggers the background worker to execute SettingsManager.getSettings(),
   * which merges saved user settings with default fallback models/hosts.
   */
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