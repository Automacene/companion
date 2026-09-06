/**
 * The service worker.
 *
 * It owns the one `Conversation` and every tab's scope, for one reason: a tab
 * closing has to be handled by something that outlives the tab, and
 * `tabs.onRemoved` only fires here.
 *
 * MV3 kills this worker whenever it goes idle and starts it again on the next
 * message, so nothing here may assume it stayed alive. Memory is read back from
 * IndexedDB on the first thing that touches a scope, which is why
 * `SessionManager.ready()` is awaited rather than the instance being built once
 * and handed around.
 */
import { SettingsManager } from '../lib/background/settings';
import { SessionManager } from '../lib/background/session';
import { ScraperService } from '../lib/background/page';
import { StreamService } from '../lib/background/stream';
import { MessageDispatcher } from '../lib/background/dispatch';
import { MemoryService } from '../lib/background/memory';
import { DEFAULT_SETTINGS } from '../lib/constants';

const settingsManager = new SettingsManager();

// Defaults first so the module has no top-level await; real settings follow.
const sessionManager = new SessionManager(DEFAULT_SETTINGS);
const scraperService = new ScraperService();
const streamService = new StreamService(sessionManager);
const memoryService = new MemoryService(sessionManager);

const testServices = {
  sessionManager,
  settingsManager,
  scraperService,
  streamService,
  memoryService,
  /**
   * Tab recognition, reachable from the service worker console as
   * `__TEST_SERVICES__.identity.debug()`.
   *
   * Every failure inside it is caught, because none of them should be allowed
   * to break a conversation - which also means none of them announce
   * themselves. This is how to see what it decided and why.
   */
  identity: sessionManager.identity,
};
(globalThis as any).__TEST_SERVICES__ = testServices;
(self as any).__TEST_SERVICES__ = testServices;

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));

  // Real settings, as early as possible.
  void settingsManager
    .getSettings()
    .then((settings) => sessionManager.applySettings(settings))
    .catch((error) => console.warn('[background] could not read settings:', error));

  // Closing a tab ends its conversation, which is how its turns reach the archive.
  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // A window closing is not the same as a tab being closed.
    if (removeInfo?.isWindowClosing) {
      void sessionManager.identity.forget(tabId);
      return;
    }

    void sessionManager.closeTab(tabId).then(() => sessionManager.identity.forget(tabId));
  });

  // Keep each conversation's description current as its tab moves.
  browser.tabs.onUpdated.addListener((tabId, changed) => {
    if (!changed.url && changed.status !== 'complete') return;
    void sessionManager.identity.note(tabId);
  });

  // Changing `num_ctx` or the memory shares changes every budget, so the mind is rebuilt.
  settingsManager.onSettingsChanged((settings) => {
    void sessionManager.applySettings(settings as never);
  });

  // Reading and pruning the archive.
  memoryService.init();

  new MessageDispatcher(sessionManager, settingsManager, scraperService, streamService).init();
});
