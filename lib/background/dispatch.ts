import { PortAction, ToolAction } from '../../types/actions';
import { SIDEPANEL_CONNECTION_NAME } from '../constants';
import { pageCharBudget } from '../mind/build';
import { readThread, type PageContext } from './thread';
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

  /**
   * Page reads waiting to be attached, keyed by tab.
   *
   * In memory only. If the service worker is killed between reading a page and
   * sending the message, the page is gone and the user reads "Scraped" against
   * nothing — which is the honest outcome, since re-reading is one click and
   * persisting it would mean a stale page attaching itself hours later.
   */
  private staged = new Map<number, PageContext>();

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
            void this.sessionManager.applySettings(msg.settings);
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

        switch (msg.action) {
          case PortAction.GET_HISTORY: {
            /*
              The panel throws its DOM away and rebuilds from here on every tab
              switch, so this is the scrollback.

              It reads the thread pool rather than the window, because eviction
              moves older turns into the shared archive and they would silently
              disappear from the panel while the model could still recall them.
              The thread holds ids in order and never evicts; each id is then
              resolved wherever the node now lives.
            */
            const scope = await this.sessionManager.scopeFor(tabId);
            port.postMessage({
              action: PortAction.HISTORY_RESPONSE,
              turns: await readThread(scope),
            });
            break;
          }

          case ToolAction.SCRAPE_DOM: {
            /*
              A page read is STAGED, not stored. It waits here until the next
              message, then rides on that turn as its own field.

              The old version wrote it into a slot on the conversation and
              spliced it into the message text, which is why a scraped page
              reappeared in the visible history when switching tabs.
            */
            this.scraperService
              .scrapeTab(tabId, { maxChars: pageCharBudget(currentSettings) })
              .then((result) => {
                this.staged.set(tabId, {
                  title: result.title,
                  url: result.url,
                  content: result.content,
                });

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
                  error: error.message || 'The page could not be read.',
                });
              });
            break;
          }

          case PortAction.SEND_MESSAGE:
            if (msg.prompt) {
              const context = this.staged.get(tabId);
              // One message, one page. Consumed whether the turn succeeds or
              // fails, so a stale page cannot attach itself to a later question.
              this.staged.delete(tabId);

              await this.streamService.handleUserMessage(
                port,
                tabId,
                msg.prompt,
                currentSettings,
                context
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
          void this.sessionManager.applySettings(settings);
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