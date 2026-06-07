import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// @covers adapter-games-ddb
// @covers domain-move
//
// BUILD-COVERAGE / wire-on-deploy contract (process v27): the ws-fn DEPLOY
// bundle (tsconfig.ws.json) must compile the new move/ DOMAIN + ws/adapters
// that import it. vitest resolves TS directly and would NOT catch a bundle that
// fails `tsc --project tsconfig.ws.json` (the s006 move adapter imports
// ../../move/ports, which is OUTSIDE the old rootDir './ws'). This test FAILS
// until the bundle build is wired (rootDir=lambda root + move/ included), and it
// asserts the handler nests at ws/dist/ws/handler.js — the coupled fact that the
// CDK ws-fn handler entry must be 'ws/handler.handler' (FLAGGED to UC3/infra).

const lambdaRoot = path.resolve(__dirname, '..');

describe('ws-fn deploy bundle compiles the move domain + adapters (tsconfig.ws.json)', () => {
  it('tsc --project tsconfig.ws.json succeeds and emits ws/dist/ws/handler.js + move domain', () => {
    // Compile the real deploy bundle. Throws (failing the test) on any TS error,
    // e.g. a rootDir/import regression on the move adapter.
    execFileSync(
      'npx',
      ['tsc', '--project', 'tsconfig.ws.json'],
      { cwd: lambdaRoot, stdio: 'pipe' },
    );
    // Handler nests under ws/dist/ws/ because rootDir is the lambda root — this
    // is exactly why the CDK ws-fn handler entry must be 'ws/handler.handler'.
    expect(existsSync(path.join(lambdaRoot, 'ws/dist/ws/handler.js'))).toBe(true);
    // The domain + adapter are bundled alongside it.
    expect(existsSync(path.join(lambdaRoot, 'ws/dist/move/move.js'))).toBe(true);
    expect(existsSync(path.join(lambdaRoot, 'ws/dist/move/ports.js'))).toBe(true);
    expect(
      existsSync(path.join(lambdaRoot, 'ws/dist/ws/adapters/games-ddb.js')),
    ).toBe(true);
  }, 60_000);
});
