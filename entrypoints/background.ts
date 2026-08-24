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

/*
  Built with the defaults so the module has no top-level await, then given the
  stored settings as soon as they arrive.

  The mind is derived from `num_ctx` and the memory shares, so constructing it
  before settings are read would give every tab the wrong budgets until
  something happened to rebuild it.
*/
const sessionManager = new SessionManager(DEFAULT_SETTINGS);
const scraperService = new ScraperService();
const streamService = new StreamService(sessionManager);
const memoryService = new MemoryService(sessionManager);

const testServices = { sessionManager, settingsManager, scraperService, streamService, memoryService };
(globalThis as any).__TEST_SERVICES__ = testServices;
(self as any).__TEST_SERVICES__ = testServices;

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));

  // Real settings, as early as possible. Anything arriving before this resolves
  // uses the defaults and gets corrected when the mind is rebuilt.
  void settingsManager
    .getSettings()
    .then((settings) => sessionManager.applySettings(settings))
    .catch((error) => console.warn('[background] could not read settings:', error));

  /*
    A closed tab ends its conversation, and ending it is how its turns reach the
    shared archive: `closeScope` runs each pool's own eviction policy first, so
    the window, thinking, and actions all land in the archive before the pools
    are removed. Another tab can then recall them.
  */
  browser.tabs.onRemoved.addListener((tabId) => {
    void sessionManager.closeTab(tabId);
  });

  // Changing `num_ctx` or the memory shares changes every budget, so the mind
  // is rebuilt. Storage is untouched and read back on the next use.
  settingsManager.onSettingsChanged((settings) => {
    void sessionManager.applySettings(settings as never);
  });

  // Reading and pruning the archive. Separate from the dispatcher because it is
  // not tab-scoped: the archive belongs to the browser, not to a conversation.
  memoryService.init();

  new MessageDispatcher(
    sessionManager,
    settingsManager,
    scraperService,
    streamService
  ).init();
});
