import { PortAction, ToolAction } from '../../types/actions';
import { SIDEPANEL_CONNECTION_NAME } from '../constants';
import { pageCharBudget } from '../mind/build';
import { readThread } from './thread';
import type { SessionManager } from './session';
import type { SettingsManager } from './settings';
import type { ScraperService } from './page';
import type { StreamService } from './stream';

export class MessageDispatcher {
  constructor(
    private sessionManager: SessionManager,
    private settingsManager: SettingsManager,
    private scraperService: ScraperService,
    private streamService: StreamService,
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

        /*
          What we already hold for the page this tab is showing.

          The URL comes from the browser rather than from the panel, because the
          panel cannot see the page it is beside — it only knows a tab id.
        */
        if (msg.action === PortAction.PAGE_STATUS) {
          try {
            const tab = await browser.tabs.get(tabId);
            const history = await this.sessionManager.pageHistory(tab.url ?? '');
            const attached = await this.sessionManager.attachedPage(tabId);

            port.postMessage({
              action: PortAction.PAGE_STATUS_RESPONSE,
              url: tab.url ?? null,
              attached,
              ...history,
            });
          } catch {
            // A tab that vanished mid-question is not an error worth reporting;
            // the panel simply shows nothing for it.
          }
          return;
        }

        if (msg.action === PortAction.DETACH_PAGE) {
          await this.sessionManager.detachPage(tabId);
          const tab = await browser.tabs.get(tabId).catch(() => null);
          const history = await this.sessionManager.pageHistory(tab?.url ?? '');

          port.postMessage({
            action: PortAction.PAGE_STATUS_RESPONSE,
            url: tab?.url ?? null,
            attached: null,
            ...history,
          });
          return;
        }

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
              A page read goes into this tab's context pool, which holds exactly
              one. Putting the new page in is what evicts the old one, and the
              old one is cut into pieces on its way to `scraped`.

              This used to be a Map on this class, consumed by the very next
              message. A pool survives the worker being killed and keeps the
              page attached across several questions rather than one, which is
              what somebody means by "the page I am looking at".
            */
            this.scraperService
              .scrapeTab(tabId, { maxChars: pageCharBudget(currentSettings) })
              .then(async (result) => {
                // How much of this reading was already stored. Computed before
                // the page is added, or it would be compared against itself.
                const comparison = await this.sessionManager.attachPage(tabId, {
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
                  comparison,
                  page: { title: result.title, url: result.url },
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
              await this.streamService.handleUserMessage(port, tabId, msg.prompt, currentSettings);
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
