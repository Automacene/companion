import { SIDEPANEL_CONNECTION_NAME } from '../lib/constants';
import { SessionManager } from '../lib/background/session';
import { SettingsManager } from '../lib/background/settings';
import { ScraperService } from '../lib/background/page';
import { StreamService } from '../lib/background/stream';
import { MessageDispatcher } from '../lib/background/dispatch';

// Instantiate immediately at module top-level (runs on script evaluation)
const sessionManager = new SessionManager();
const settingsManager = new SettingsManager();
const scraperService = new ScraperService();
const streamService = new StreamService();

// Attach to global scope immediately
const testServices = {
  sessionManager,
  settingsManager,
  scraperService,
  streamService,
};

(globalThis as any).__TEST_SERVICES__ = testServices;
(self as any).__TEST_SERVICES__ = testServices;

export default defineBackground(() => {
  console.log('[Background] Service worker booted. __TEST_SERVICES__ ready.');

  // Sidepanel behavior
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));

  // Tab Lifecycle
  browser.tabs.onRemoved.addListener((tabId) => {
    sessionManager.removeSession(tabId);
  });

  // Settings Sync
  settingsManager.onSettingsChanged((newSettings) => {
    sessionManager.applySettingsToAll(newSettings);
  });

  // Message Routing Dispatcher
  const dispatcher = new MessageDispatcher(
    sessionManager,
    settingsManager,
    scraperService,
    streamService
  );
  dispatcher.init();
});