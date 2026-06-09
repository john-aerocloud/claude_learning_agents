// Server bootstrap — starts the observatory read layer on localhost.
//
// COMPOSITION POINT (UC6): the full route table is assembled by buildServerApp
// (compose.js), which constructs the watcher (UC5) and wires UC1-UC5 routers via
// createApp's extraRouters seam. CORS + the read-only guard live in createApp.
// This file owns only the process concerns: listen on PORT, log build identity,
// and on SIGTERM/SIGINT stop the watcher AND close the server so the process
// exits cleanly (no leaked chokidar handle, no hung socket).

import { buildServerApp } from './compose.js';
import { resolveRepoRoot } from './repoRoot.js';

const PORT = Number(process.env.PORT) || 3001;
const SHA = process.env.OBSERVATORY_SHA || process.env.GIT_SHA || 'dev';

const repoRoot = resolveRepoRoot();

// Full composed app + the watcher backing /api/events (lifetime owned here).
const { app, watcher } = buildServerApp({ repoRoot });

const server = app.listen(PORT, () => {
  // Structured startup log (sha as a field, read from env per principles/01).
  console.log(
    JSON.stringify({
      event: 'server_start',
      sha: SHA,
      port: PORT,
      repoRoot,
      readOnly: true,
    }),
  );
});

// Graceful shutdown so start:check's SIGTERM exits cleanly (exit 0): stop the
// watcher first (closes chokidar) then close the http server. Idempotent guard
// so a double signal cannot double-exit.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await watcher.stop();
  } catch {
    // watcher already closed or never opened — not fatal to a clean exit.
  }
  server.close(() => process.exit(0));
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    shutdown();
  });
}

export { server, watcher };
