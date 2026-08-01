import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Automacene Companion',
    permissions: ['sidePanel', 'activeTab', 'tabs', 'downloads', 'scripting'],
    host_permissions: ['http://localhost:11434/*', '<all_urls>'],
    action: {
      default_title: 'Open Automacene Sidepanel', 
    },
  },
});