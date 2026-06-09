import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Vite dev server for the Observatory SPA (CHK-2).
// - Dev server on :5173 (CHK-1 CORS already allows this origin); calls the
//   read layer at :3001 directly (no proxy).
// - Build identity: the pipeline injects the commit sha via VITE_COMMIT_SHA at
//   build time; we surface it as a build-time define so any surface can stamp it
//   (principles/01). It is NEVER hardcoded — falls back to 'dev' locally.
const COMMIT_SHA = process.env.VITE_COMMIT_SHA || 'dev';

export default defineConfig({
  plugins: [preact()],
  // SPA root is this directory (index.html lives here).
  root: __dirname,
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
