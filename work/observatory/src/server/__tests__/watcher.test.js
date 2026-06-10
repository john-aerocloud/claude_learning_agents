// @covers UC5 — file-watch domain (watcher.js): start/subscribe/stop semantics.
// Acceptance: AC5.2 (ignoreInitial), AC5.3 (<1s emit), AC5.5 (no crash after
// unsubscribe), T-READ-14, T-READ-16, F6.
//
// The watcher is the domain core for UC5: it owns the "a repo file changed"
// concept and exposes a port (subscribe(listener) -> unsubscribe; stop()) so the
// SSE adapter never imports chokidar. Tests drive it against a temp fixture dir,
// not the real work/ tree, and always stop() in afterEach so the suite exits.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatcher } from '../watcher.js';

// Wait for a predicate-satisfying event or reject after `ms` — no sleep.
function waitForChange(watcher, predicate, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`no matching change within ${ms}ms`));
    }, ms);
    const unsub = watcher.subscribe((evt) => {
      if (predicate(evt)) {
        clearTimeout(timer);
        unsub();
        resolve({ evt, at: Date.now() });
      }
    });
  });
}

describe('createWatcher — file-watch domain', () => {
  let root;
  let watcher;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-watch-'));
    mkdirSync(join(root, 'work'), { recursive: true });
  });

  afterEach(async () => {
    if (watcher) await watcher.stop();
    watcher = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('AC5.3/F6: emits a change with the repo-relative path within 1000ms of a write', async () => {
    watcher = createWatcher({ repoRoot: root });
    await watcher.ready();
    const target = join(root, 'work', 'alpha.txt');
    const start = Date.now();
    const pending = waitForChange(
      watcher,
      (e) => e.type === 'change' && e.path === join('work', 'alpha.txt'),
      1000,
    );
    writeFileSync(target, 'hello');
    const { at } = await pending;
    expect(at - start).toBeLessThan(1000);
  });

  it('AC5.2/T-READ-14: ignoreInitial — no event for files present before start', async () => {
    // Pre-existing file written and ALLOWED TO SETTLE before the watcher starts,
    // so the OS watch backend (FSEvents/inotify) cannot replay its recent write
    // as a post-ready `change`. Settling here removes the flake source — a fixed
    // post-start sleep was racing chokidar's initial-scan tail (OI-FLAKY-WATCHER).
    const pre = join(root, 'work', 'pre.txt');
    writeFileSync(pre, 'existing');
    await new Promise((r) => setTimeout(r, 50)); // let the write timestamp settle

    watcher = createWatcher({ repoRoot: root });
    await watcher.ready();

    // Record any path the watcher emits AFTER ready (must never include pre.txt).
    const seen = [];
    const unsub = watcher.subscribe((e) => seen.push(e.path));

    // Event-driven bound: write a NEW file and wait for ITS event. Once a
    // post-ready event has been delivered, the watcher is provably live — so if
    // the pre-existing file were going to fire, it would have by now. This makes
    // the assertion deterministic instead of leaning on a fixed sleep length.
    const pending = waitForChange(watcher, (e) => e.path === join('work', 'live.txt'), 1000);
    writeFileSync(join(root, 'work', 'live.txt'), 'new');
    await pending;
    unsub();

    expect(seen).not.toContain(join('work', 'pre.txt'));
  });

  it('AC5.5/T-READ-16: after a subscriber unsubscribes, a later write does not crash and the watcher still serves remaining subscribers', async () => {
    watcher = createWatcher({ repoRoot: root });
    await watcher.ready();
    // A subscriber that would throw if ever invoked, then immediately removed.
    const unsub = watcher.subscribe(() => { throw new Error('removed listener must not be called'); });
    unsub();
    // A still-registered subscriber must keep receiving events with no crash.
    const pending = waitForChange(watcher, (e) => e.path === join('work', 'after.txt'), 1000);
    writeFileSync(join(root, 'work', 'after.txt'), 'x');
    const { evt } = await pending;
    expect(evt.type).toBe('change');
  });

  it('AC5.4/T-READ-15: multiple subscribers all receive the same event', async () => {
    watcher = createWatcher({ repoRoot: root });
    await watcher.ready();
    const a = waitForChange(watcher, (e) => e.path === join('work', 'fan.txt'), 1000);
    const b = waitForChange(watcher, (e) => e.path === join('work', 'fan.txt'), 1000);
    writeFileSync(join(root, 'work', 'fan.txt'), 'fanout');
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.evt.type).toBe('change');
    expect(rb.evt.type).toBe('change');
  });

  it('stop() is idempotent and resolves (suite must exit cleanly)', async () => {
    watcher = createWatcher({ repoRoot: root });
    await watcher.ready();
    await expect(watcher.stop()).resolves.toBeUndefined();
    await expect(watcher.stop()).resolves.toBeUndefined();
    watcher = undefined; // already stopped; skip afterEach stop
  });
});
