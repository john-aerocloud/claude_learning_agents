import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { observatoryApiPlugin } from './server/viteApiPlugin.js';

// ONE server, ONE port (:5173) — the SPA and the /api/* read layer are both
// served here. The Vite plugin mounts the API middleware via configureServer
// (dev) and configurePreviewServer (vite preview) so same-origin requests
// never need CORS.
//
// Build identity: the pipeline injects the commit sha via VITE_COMMIT_SHA at
// build time; we surface it as a build-time define so any surface can stamp it
// (principles/01). It is NEVER hardcoded — falls back to 'dev' locally.
const COMMIT_SHA = process.env.VITE_COMMIT_SHA || 'dev';

export default defineConfig({
  plugins: [preact(), observatoryApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  define: {
    __COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
