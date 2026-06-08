/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * vite.local.config.ts — the UC5 local stand-up SPA dev server (OI-28,
 * principles/02). Identical to vite.config.ts EXCEPT it serves `/config.js`
 * in-process so the SPA's `window.OXO_CONFIG` points at the LOCAL WS server —
 * no cloud creds, no deploy pipeline. In prod `/config.js` is written by the
 * deploy step; here a dev middleware substitutes it so the browser-delivered
 * behaviour can be developed WITH a browser locally.
 *
 * NOTE: the s006/s009 feature flags (uc4Enabled, uc1NameEnabled,
 * uc3LeaderboardEnabled, uc4TwoCopyEnabled) were FACTORED OUT at slice delivery
 * (§40 code-then-config). The name field, leaderboard panel, and two copy
 * controls are now the UNCONDITIONAL SPA behaviour, so config.js carries only
 * the WS url — no flag entries here or in the prod deploy step.
 */

const LOCAL_WS_PORT = Number(process.env.LOCAL_WS_PORT ?? 8787);

/** Serve a local /config.js (local WS url only) and stub APIs. */
function localBackend(): Plugin {
  const configBody = `window.OXO_CONFIG = ${JSON.stringify({
    wsUrl: `ws://localhost:${LOCAL_WS_PORT}`,
  })};`;
  // s009 UC3 — a small fixed leaderboard fixture so the panel renders populated
  // locally (the real GET /api/leaderboard is the backend engineer's surface).
  const leaderboardBody = JSON.stringify({
    entries: [
      { name: 'ACE', wins: 3, draws: 1, losses: 0 },
      { name: 'BEE', wins: 1, draws: 0, losses: 2 },
    ],
    buildSha: 'local',
  });
  return {
    name: 'oxo-local-backend',
    configureServer(server) {
      server.middlewares.use('/config.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(configBody);
      });
      // s009 UC3 — local stub of GET /api/leaderboard so the idle-view panel
      // renders populated without the deployed backend.
      server.middlewares.use('/api/leaderboard', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(leaderboardBody);
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
