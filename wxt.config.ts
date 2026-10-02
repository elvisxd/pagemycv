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
    // needs 'unlimitedStorage' for quota, and 'storage' for exactly one value:
    // the vault key, which replaced the passphrase. It is the whole reason the
    // permission is here, so src/vault/key-store.ts is the only module allowed
    // to use it and the guard enforces that. No host permissions: the content
    // script is declared per board, and anywhere else only the active tab,
    // after a click, so the extension is never granted a page nobody pointed
    // it at.
    // 'activeTab' + 'scripting': the content script can be put into the tab
    // the person last clicked the icon on, and no other, so an application on
    // a site this list does not name can still be filled. That grant is
    // Chrome's, per tab, gone on navigation; the extension holds nothing. See
    // src/fill/inject.ts, the only module allowed to use it.
    permissions: [
      'offscreen',
      'unlimitedStorage',
      'sidePanel',
      'storage',
      'activeTab',
      'scripting',
    ],
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
