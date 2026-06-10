// File-watch adapter for UC5 (live-refresh).
//
// HEXAGONAL ROLE: this is the ADAPTER that fronts a single external concept —
// the filesystem watch (chokidar) — and translates raw chokidar events into a
// domain-shaped change event: { type: 'change', path: <repo-root-relative> }.
// It exposes a small PORT so the SSE route adapter and any future consumer
// never import chokidar:
//
//   const w = createWatcher({ repoRoot });
//   await w.ready();                 // resolves once the initial scan is done
//   const unsub = w.subscribe(fn);   // fn({ type, path }); returns unsubscribe()
//   await w.stop();                  // closes chokidar; idempotent; lets the
//                                    //   test suite / server exit cleanly
//
// chokidar is the ONLY SDK import in this file by design (one adapter, one
// external concept). The route layer above stays SDK-free.
//
// LATENCY (F6 / AC5.3, N<1s): no debounce is applied to the emit path. chokidar
// on macOS uses FSEvents (sub-200ms typical); on Linux, inotify. Adding a
// debounce would only add latency against the 1s budget for no benefit at this
// volume, so we forward each event immediately.

import chokidar from 'chokidar';
import { relative } from 'node:path';

/**
 * @param {{ repoRoot: string }} deps
 */
export function createWatcher({ repoRoot }) {
  /** @type {Set<(evt: {type: string, path: string}) => void>} */
  const listeners = new Set();
  let stopped = false;

  const watcher = chokidar.watch(repoRoot, {
    ignoreInitial: true, // AC5.2 / T-READ-14: no events for the initial scan.
    ignored: [
      /(^|[/\\])\.git([/\\]|$)/,
      /(^|[/\\])node_modules([/\\]|$)/,
    ],
    // Reduce false negatives on some filesystems without inflating latency.
    awaitWriteFinish: false,
  });

  function emit(rawPath) {
    if (stopped) return;
    const rel = relative(repoRoot, rawPath);
    const evt = { type: 'change', path: rel };
    // Snapshot so an unsubscribe during dispatch is safe; isolate listener
    // throws so one bad subscriber cannot crash the watcher (AC5.5/T-READ-16).
    for (const fn of [...listeners]) {
      try {
        fn(evt);
      } catch {
        // Swallow: a listener fault is its own concern, not a watcher failure.
      }
    }
  }

  for (const ev of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) {
    watcher.on(ev, (p) => emit(p));
  }

  const readyPromise = new Promise((resolve) => {
    watcher.once('ready', () => resolve());
  });

  return {
    /** Resolves once chokidar's initial scan is complete. */
    ready() {
      return readyPromise;
    },
    /**
     * @param {(evt: {type: string, path: string}) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Close the watcher. Idempotent; safe to await more than once. */
    async stop() {
      if (stopped) return;
      stopped = true;
      listeners.clear();
      await watcher.close();
    },
  };
}
