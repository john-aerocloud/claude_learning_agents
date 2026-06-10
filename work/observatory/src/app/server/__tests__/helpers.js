// Test helpers — thin http.Server wrapper around the API middleware.
// Used by all server-side tests instead of Express/supertest-app: createTestServer
// creates a real http.Server from createApiMiddleware so supertest can drive it.

import http from 'node:http';
import { createWatcher } from '../watcher.js';
import { createApiMiddleware } from '../apiMiddleware.js';

/**
 * Build a real http.Server backed by createApiMiddleware (no Express, no Vite).
 * Returns { server, watcher } so callers can stop both in afterEach/afterAll.
 * The server is NOT yet listening — call listen(0) yourself or pass to supertest.
 *
 * @param {{ repoRoot: string, skipWatcher?: boolean }} opts
 *   skipWatcher: if true, a no-op stub watcher is used (for tests that don't need SSE).
 */
export function createTestServer({ repoRoot, skipWatcher = false }) {
  const watcher = skipWatcher
    ? { subscribe: () => () => {}, ready: () => Promise.resolve(), stop: async () => {} }
    : createWatcher({ repoRoot });

  const middleware = createApiMiddleware({ repoRoot, watcher });

  // A minimal http.Server that routes /api/* through our middleware and returns
  // 404 for everything else. supertest(server) works with this.
  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.writeHead(404);
      res.end('not found');
    });
  });

  return { server, watcher };
}
