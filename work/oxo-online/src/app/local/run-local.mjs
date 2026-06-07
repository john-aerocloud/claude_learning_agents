/**
 * run-local.mjs — the committed UC5 stand-up entry point (OI-28, §33 tooling
 * self-service). Starts BOTH halves of the local stack with NO cloud creds:
 *   1. the local WS server (local/server.ts) via vite-node on LOCAL_WS_PORT
 *      (default 8787) — vite-node resolves the cross-package domain imports
 *      (../../lambda/move/*) the same way vitest/the SPA do (no .ts juggling).
 *   2. the SPA dev server (vite.local.config.ts) on LOCAL_SPA_PORT (default 5183)
 *      serving a local /config.js → { wsUrl: ws://localhost:<port>, uc4Enabled }.
 *
 * Invoked via `npm --prefix .../src/app run local` or `make run-local`. Used in
 * BUILD phase to develop the move-relay behaviour with a real browser and to run
 * the local Playwright suite (tests/local/) against it. Both children inherit
 * stdio; SIGINT/SIGTERM tear both down; if either dies the other is stopped so
 * the stand-up never half-runs.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  process.exit(code);
}

function start(command, args) {
  const child = spawn(command, args, { cwd: appRoot, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => shutdown(code ?? 0));
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// 1. local WS server through vite-node (bundler-style resolution + TS).
start(npx, ['vite-node', 'local/server.ts']);
// 2. SPA dev server with the local /config.js middleware.
start(npx, ['vite', '--config', 'vite.local.config.ts']);
