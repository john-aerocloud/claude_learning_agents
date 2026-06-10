// Observatory API — Vite plugin.
//
// Wires createApiMiddleware as a Vite server middleware via configureServer
// (dev) and configurePreviewServer (vite preview). Both hooks receive Vite's
// ViteDevServer / PreviewServer, which expose a `.middlewares` connect
// instance. We prepend our /api handler there so API routes are matched before
// Vite's own SPA-fallback handler.
//
// LIFECYCLE: the watcher is created ONCE here and shared between the dev-server
// middleware and the graceful-shutdown hook. On server close (SIGTERM/SIGINT or
// Vite HMR restart) watcher.stop() is called via the buildEnd + closeBundle
// hooks so no chokidar handle leaks. In dev the server lifecycle drives this;
// for vite preview the process exits naturally.
//
// ONE PORT (:5173 default) serves:
//   /api/*   → createApiMiddleware (same-origin, no CORS)
//   *        → Vite SPA + HMR

import { resolveRepoRoot } from './repoRoot.js';
import { createWatcher } from './watcher.js';
import { createApiMiddleware } from './apiMiddleware.js';

/**
 * @returns {import('vite').Plugin}
 */
export function observatoryApiPlugin() {
  const repoRoot = resolveRepoRoot();
  const watcher = createWatcher({ repoRoot });

  // Ready-promise is awaited before the first request can arrive (watcher.ready
  // resolves after chokidar's initial scan so no spurious events fire).
  const ready = watcher.ready();

  const middleware = createApiMiddleware({ repoRoot, watcher });

  // Shared setup for both dev and preview servers.
  function installOn(server) {
    // Prepend so API routes are matched before Vite's own middleware.
    server.middlewares.use(async (req, res, next) => {
      await ready; // wait for chokidar scan (idempotent after first resolve)
      middleware(req, res, next);
    });
  }

  return {
    name: 'observatory-api',

    // Dev server (vite dev).
    configureServer(server) {
      installOn(server);
    },

    // Preview server (vite preview — serves the built dist/).
    configurePreviewServer(server) {
      installOn(server);
    },

    // Stop the chokidar watcher when Vite's build process ends or the server
    // closes so no open handles keep the process alive.
    async closeBundle() {
      await watcher.stop();
    },
  };
}
