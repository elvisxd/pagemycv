import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifest: {
    name: 'PageMyCV',
    description:
      'Fills job application forms from a CV stored only on this machine. It fills, you review, you submit.',
    // Phase 1 asks for nothing it does not use, and this list is checked by
    // scripts/guard.mjs against its own allowlist. 'storage' was here and was
    // never called: the vault lives in the origin private file system, which
    // needs 'unlimitedStorage' for quota and nothing else. No host permissions
    // exist yet because no code in this phase can reach a page or the network.
    permissions: ['offscreen', 'unlimitedStorage', 'sidePanel'],
    // chrome.offscreen needs 109, chrome.sidePanel 114, and hasDocument() 116,
    // which background.ts calls unguarded. Below that the first message throws
    // and the panel shows a failure it cannot explain.
    minimum_chrome_version: '116',
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    side_panel: { default_path: 'sidepanel.html' },
    action: { default_title: 'PageMyCV' },
  },
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
});
