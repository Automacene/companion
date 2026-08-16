import { PortAction, ToolAction } from '../../types/actions';
import { SIDEPANEL_CONNECTION_NAME } from '../constants';
import type { SessionManager } from './session';
import type { SettingsManager } from './settings';
import type { ScraperService } from './page';
import type { StreamService } from './stream';

export class MessageDispatcher {
  constructor(
    private sessionManager: SessionManager,
    private settingsManager: SettingsManager,
    private scraperService: ScraperService,
    private streamService: StreamService
  ) {}

  public init(): void {
    // Long-lived Port connections (Sidepanel <-> Background)
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== SIDEPANEL_CONNECTION_NAME) return;

      port.onMessage.addListener(async (msg) => {
        const tabId = msg.tabId ?? -1;

        // Settings actions can run globally without tab context
        if (msg.action === PortAction.GET_SETTINGS) {
          try {
            const settings = await this.settingsManager.getSettings();
            port.postMessage({ action: 'SETTINGS_RESPONSE', settings });
          } catch (err) {
            port.postMessage({
              action: 'SETTINGS_ERROR',
              error: err instanceof Error ? err.message : 'Failed to retrieve settings',
            });
          }
          return;
        }

        if (msg.action === PortAction.SAVE_SETTINGS) {
          try {
            await this.settingsManager.saveSettings(msg.settings);
            this.sessionManager.applySettingsToAll(msg.settings);
            port.postMessage({ success: true });
          } catch (err) {
            port.postMessage({
              success: false,
              error: err instanceof Error ? err.message : 'Failed to save settings',
            });
          }
          return;
        }

        // Tab-scoped actions require a valid tabId
        if (tabId === -1) return;

        const currentSettings = await this.settingsManager.getSettings();
        const conversation = this.sessionManager.getSession(tabId, currentSettings);

        switch (msg.action) {
          case PortAction.GET_HISTORY:
            port.postMessage({
              action: PortAction.HISTORY_RESPONSE,
              messages: conversation.getHistory(), // <-- Calls getHistory() instead of getMessages()
            });
            break;

          case ToolAction.SCRAPE_DOM: {
            const targetTabId = msg.tabId;
            const session = this.sessionManager.getSession(targetTabId);

            this.scraperService
              .scrapeTab(targetTabId, session)
              .then((result) => {
                port.postMessage({
                  action: 'SCRAPE_COMPLETE',
                  result: {
                    processorName: result.processorName,
                    contentType: result.contentType,
                    metadata: result.metadata,
                  },
                });
              })
              .catch((error) => {
                port.postMessage({
                  action: 'SCRAPE_ERROR',
                  error: error.message || 'Scrape pipeline failed',
                });
              });
            break;
          }

          case PortAction.SEND_MESSAGE:
            if (msg.prompt) {
              await this.streamService.handleUserMessage(
                port,
                conversation,
                msg.prompt,
                msg.hostUrl,
                msg.modelName
              );
            }
            break;
        }
      });
    });

    // One-off runtime messages (browser.runtime.sendMessage). Both settings
    // pages use this rather than a port, since neither is tab-scoped.
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const isReplace = msg.action === PortAction.SAVE_SETTINGS;
      const isPatch = msg.action === PortAction.PATCH_SETTINGS;
      if (!isReplace && !isPatch) return;

      // A patch merges and returns the merged result, so live sessions are
      // updated with the complete settings rather than only the changed keys.
      const write = isPatch
        ? this.settingsManager.patchSettings(msg.settings)
        : this.settingsManager
            .replaceSettings(msg.settings)
            .then(() => msg.settings as typeof msg.settings);

      write
        .then((settings) => {
          this.sessionManager.applySettingsToAll(settings);
          sendResponse({ success: true, settings });
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : 'Failed to save settings',
          });
        });

      return true; // Keeps channel open for async sendResponse
    });
  }
}