import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      /**
       * Without an explicit target the CSS minifier guesses an old baseline and
       * "helpfully" rewrites `backdrop-filter` to `-webkit-backdrop-filter`
       * only. Current Chrome has dropped that prefixed alias, so the frosted
       * panels silently stopped blurring in built output while still working in
       * source. We ship Chromium-only, so say so.
       */
      cssTarget: 'chrome111',
    },
  }),
  webExt: {
    binaries: {
      // Chromium target. Override per-machine with CHROME_BIN, since the
      // default only exists on Linux boxes with Brave installed.
      chrome: process.env.CHROME_BIN || '/usr/bin/brave-browser',
    },
  },
  manifest: {
    name: 'Automacene Companion',
    permissions: ['sidePanel', 'activeTab', 'tabs', 'downloads', 'scripting', 'storage'],
    host_permissions: ['http://localhost:11434/*', '<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';"
    },
    action: {
      default_title: 'Open Automacene Sidepanel',
    },
  },
});