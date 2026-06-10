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
//
// OI-SERVER-RESTART (fixed): configureServer installs a watch on the server/
// source directory (this file's parent). Any .js change under server/ (excluding
// __tests__/) triggers server.restart() after a 300ms debounce. Vite re-runs
// config + plugins → the API middleware module is re-imported fresh. Client
// files under src/ remain HMR-only (they are never under server/, so no full
// restart). No restart loop: server/ files are not in the Vite HMR module graph.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { resolveRepoRoot } from './repoRoot.js';
import { createWatcher } from './watcher.js';
import { createApiMiddleware } from './apiMiddleware.js';

// Absolute path of the server source directory (this file's parent).
// Using import.meta.url avoids any reliance on process.cwd().
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = `${SERVER_DIR}/__tests__`;

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

      // OI-SERVER-RESTART: watch server source dir; restart on .js changes.
      // Excludes __tests__/ (test code does not affect the runtime API).
      // Debounce 300ms so a multi-file save (editor writes several files) only
      // triggers one restart. Guard: only .js files trigger; non-JS ignored.
      // Loop guard: Vite does NOT put server/ files in the HMR module graph
      // (they are not imported by client code), so restart never re-triggers
      // the change event.
      let restartTimer = null;

      server.watcher.add(SERVER_DIR);

      server.watcher.on('change', (filePath) => {
        if (!filePath.startsWith(SERVER_DIR)) return;   // not our dir
        if (filePath.startsWith(TESTS_DIR)) return;     // test-only files
        if (!filePath.endsWith('.js')) return;           // non-JS (docs etc)

        clearTimeout(restartTimer);
        restartTimer = setTimeout(async () => {
          restartTimer = null;
          const rel = filePath.slice(SERVER_DIR.length + 1);
          console.log(`[observatory-api] server source changed (${rel}), restarting…`);
          try {
            await server.restart();
          } catch (err) {
            console.error('[observatory-api] restart failed:', err.message);
          }
        }, 300);
      });
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
