// Consolidated single-server entry point — Observatory.
//
// TOPOLOGY: one Express process on :3001 serves BOTH:
//   /api/*          → Express route handlers (UC1-UC5, read-only)
//   everything else → Vite dev server in middleware mode (SPA + HMR)
//
// In dev (NODE_ENV !== 'production'):
//   Vite's createServer({ middlewareMode: true }) is mounted AFTER the /api
//   routes. Vite transforms JSX/CSS on the fly and provides HMR via its own
//   WebSocket upgrade on the same port — no separate process needed.
//
// In production (NODE_ENV === 'production'):
//   The pre-built dist/ is served statically via express.static, with an
//   index.html fallback for SPA client-side routing.
//
// Result: `npm --prefix work/observatory run dev` launches ONE process;
//   SPA and API share an origin → no CORS needed (CORS layer deleted).
//   Editing .jsx hot-reloads instantly via Vite HMR.

import { createServer as createViteServer } from 'vite';
import express from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServerApp } from './compose.js';
import { resolveRepoRoot } from './repoRoot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// SPA root: work/observatory/src/app (where index.html lives)
const SPA_ROOT = resolve(__dirname, '..', 'app');
const SPA_DIST = resolve(SPA_ROOT, 'dist');

const PORT = Number(process.env.PORT) || 3001;
const SHA = process.env.OBSERVATORY_SHA || process.env.GIT_SHA || 'dev';
const IS_PROD = process.env.NODE_ENV === 'production';

const repoRoot = resolveRepoRoot();

// Full composed API app + the watcher backing /api/events.
const { app, watcher } = buildServerApp({ repoRoot });

if (IS_PROD) {
  // Serve the pre-built Vite dist/ statically; fall back to index.html for SPA
  // client-side routing (any non-/api path that isn't a file → index.html).
  app.use(express.static(SPA_DIST));
  app.use((_req, res) => {
    res.sendFile(resolve(SPA_DIST, 'index.html'));
  });
} else {
  // Dev: mount Vite as middleware so HMR WebSocket upgrade lives on the same
  // port. middlewareMode: true means Vite doesn't create its own http.Server —
  // Express owns the socket; Vite's WS upgrade hooks into it via
  // vite.middlewares (which includes the HMR upgrade handler).
  const vite = await createViteServer({
    root: SPA_ROOT,
    server: {
      middlewareMode: true,
      hmr: true,
    },
    appType: 'spa', // serve index.html for unmatched routes (SPA fallback)
  });

  // Mount Vite middleware AFTER the API routes so /api/* is handled by Express
  // first. Vite catches everything else (SPA entry, assets, HMR websocket).
  app.use(vite.middlewares);

  // Graceful shutdown: also close the Vite server.
  process.on('SIGTERM', async () => {
    await vite.close();
  });
  process.on('SIGINT', async () => {
    await vite.close();
  });
}

const server = app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      event: 'server_start',
      sha: SHA,
      port: PORT,
      repoRoot,
      mode: IS_PROD ? 'production' : 'dev',
      spa: IS_PROD ? `${SPA_DIST} (static)` : `${SPA_ROOT} (Vite HMR)`,
      readOnly: true,
    }),
  );
});

// Graceful shutdown — stop the watcher + close the http server.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await watcher.stop();
  } catch {
    // watcher already closed — not fatal.
  }
  server.close(() => process.exit(0));
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => shutdown());
}

export { server, watcher };
