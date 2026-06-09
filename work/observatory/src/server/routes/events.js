// HTTP adapter for UC5 — translates the file-watch port (watcher.subscribe)
// into a long-lived Server-Sent Events stream on GET /api/events.
//
// HEXAGONAL ROLE: adapter depends on the watcher port; it imports NO chokidar
// and knows nothing of the filesystem — it only forwards domain-shaped
// { type:'change', path } events the watcher emits. The watcher is injected so
// the same router serves both the real server (server.js, via UC6) and tests
// (a temp-fixture watcher). The router holds GET only (read-only posture).
//
// LIFECYCLE / CLEAN TEARDOWN (AC5.5): each connection subscribes to the watcher
// on open and UNSUBSCRIBES on 'close' — so a disconnected client leaks no
// listener and a later file change cannot write to a dead socket. The watcher's
// own stop() is the server's responsibility (UC6 / server.js); this router does
// not own the watcher's lifetime, only its per-connection subscription.
//
// HEARTBEAT: a 30s SSE comment (":\n\n") keeps the connection alive through
// idle-timeout proxies. unref() so the interval never holds the process / test
// runner open; clearInterval on disconnect for tidy teardown.

import { Router } from 'express';

const HEARTBEAT_MS = 30_000;

/**
 * @param {{ watcher: { subscribe: (fn: (evt: {type:string,path:string}) => void) => () => void } }} deps
 * @returns {import('express').Router}
 */
export function createEventsRouter({ watcher }) {
  const router = Router();

  // GET /api/events → long-lived text/event-stream; one change frame per
  // watched-file event: `data: {"type":"change","path":"<rel>"}\n\n`.
  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering so frames flush live
    });
    // Open the stream immediately so the client sees headers + a primer.
    res.write(':\n\n'); // initial heartbeat comment (no data frame on connect — AC5.2)
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const unsubscribe = watcher.subscribe((evt) => {
      // writableEnded guards against writing to a socket already torn down.
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(':\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    // Clean teardown on disconnect: drop the listener + stop the heartbeat so
    // no dead-socket writes and no leaked subscriptions (AC5.5 / T-READ-16).
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
