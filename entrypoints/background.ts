export default defineBackground(() => {
  // WXT provides types for 'browser' out of the box!
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));
});