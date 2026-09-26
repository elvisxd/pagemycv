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
    // Phase 1 asks for nothing it does not use. No host permissions exist yet
    // because no code in this phase can reach a page or the network.
    permissions: ['offscreen', 'storage', 'unlimitedStorage', 'sidePanel'],
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
