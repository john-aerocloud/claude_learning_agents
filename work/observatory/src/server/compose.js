// UC6 composition seam — assembles the FULL read-layer route table into one app.
//
// HEXAGONAL ROLE: this is the composition root. It constructs the watcher adapter
// (UC5), then wires every UC2-UC5 router via createApp's extraRouters seam. UC1's
// projects router is mounted by createApp itself (do NOT double-mount it here).
// CORS + the read-only guard live in createApp (app.js) so they apply to every
// router uniformly — composition only chooses WHAT to mount, not the posture.
//
// Returns { app, watcher } so the CALLER owns teardown: server.js stops the
// watcher + closes the http server on SIGTERM/SIGINT; tests stop the watcher in
// afterAll. The watcher's lifetime is the server's, not any router's (the events
// router only owns per-connection subscriptions — see routes/events.js).
//
// This realises the change-impact edges SERVER --> WATCH (constructs/owns stop)
// and SERVER --> R_EVENTS (injects via extraRouters) from class-deps.mmd.

import { createApp } from './app.js';
import { resolveRepoRoot } from './repoRoot.js';
import { createWatcher } from './watcher.js';
import { createItemsQueuesRouter } from './routes/items-queues.js';
import { createDoraRouter } from './routes/dora.js';
import { createSlicesRouter } from './routes/slices.js';
import { createEventsRouter } from './routes/events.js';
import { createStageFlowRouter } from './routes/stageFlow.js';

/**
 * Build the fully-composed read-layer app plus the watcher backing /api/events.
 * @param {{ repoRoot?: string, allowedOrigin?: string }} [opts]
 * @returns {{ app: import('express').Express, watcher: ReturnType<typeof createWatcher> }}
 */
export function buildServerApp(opts = {}) {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();

  // UC5: construct the single watcher; the events router subscribes to its port.
  const watcher = createWatcher({ repoRoot });

  // UC2-UC5 routers mounted via the extraRouters seam. UC1 (projects/active) is
  // mounted inside createApp — listing it here would double-register it.
  const extraRouters = [
    createItemsQueuesRouter({ repoRoot }), // UC2
    createDoraRouter({ repoRoot }), // UC3
    createSlicesRouter({ repoRoot }), // UC4
    createEventsRouter({ watcher }), // UC5
    createStageFlowRouter({ repoRoot }), // UC-S004-1 (stage-flow aggregation)
  ];

  const app = createApp({ repoRoot, extraRouters, allowedOrigin: opts.allowedOrigin });

  return { app, watcher };
}
