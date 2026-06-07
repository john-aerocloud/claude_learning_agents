/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * vite.local.config.ts — the UC5 local stand-up SPA dev server (OI-28,
 * principles/02). Identical to vite.config.ts EXCEPT it serves `/config.js`
 * in-process so the SPA's `window.OXO_CONFIG` points at the LOCAL WS server and
 * the UC4 flag is ON — no cloud creds, no deploy pipeline. In prod `/config.js`
 * is written by the deploy step; here a dev middleware substitutes it so the
 * browser-delivered move-relay behaviour can be developed WITH a browser locally.
 */

const LOCAL_WS_PORT = Number(process.env.LOCAL_WS_PORT ?? 8787);

/** Serve a local /config.js (local WS url + uc4Enabled ON) and a stub create API. */
function localBackend(): Plugin {
  const configBody = `window.OXO_CONFIG = ${JSON.stringify({
    wsUrl: `ws://localhost:${LOCAL_WS_PORT}`,
    uc4Enabled: true,
  })};`;
  return {
    name: 'oxo-local-backend',
    configureServer(server) {
      server.middlewares.use('/config.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(configBody);
      });
      // Local stub of POST /api/games so the HOST flow ("Play Online") reaches
      // the waiting screen and opens the socket (the local WS server binds the
      // first connection as host). No wsToken locally — the host connects with
      // no $connect credential (the local server authorises by connection order,
      // not by token), exactly the degraded-mint graceful path the SPA supports.
      server.middlewares.use('/api/games', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ gameId: 'g-1', code: 'LOCAL1' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localBackend()],
  server: {
    port: Number(process.env.LOCAL_SPA_PORT ?? 5183),
    strictPort: true,
  },
});
