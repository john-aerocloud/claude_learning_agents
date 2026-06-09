// Server bootstrap — starts the observatory read layer on localhost.
//
// COMPOSITION POINT: this is where the full route table is assembled. UC1 ships
// the base app with only the projects router. As UC2–UC5 land, their routers
// are imported here and passed via `extraRouters` into createApp — keeping each
// UC's handler file untouched by the others (the §F6 scaffold seam contract).

import { createApp } from './app.js';
import { resolveRepoRoot } from './repoRoot.js';

const PORT = Number(process.env.PORT) || 3001;
const SHA = process.env.OBSERVATORY_SHA || process.env.GIT_SHA || 'dev';

const repoRoot = resolveRepoRoot();

// extraRouters: UC2–UC5 append their routers here as they land.
const app = createApp({ repoRoot, extraRouters: [] });

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

// Graceful shutdown so start:check's SIGTERM exits cleanly (exit 0).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}

export { server };
