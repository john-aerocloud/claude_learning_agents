import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Wire-on-deploy contract (process v27) for the UC4 flag flip (§40, §19 edge #4).
 *
 * The deployed SPA's move-send / render-on-broadcast path is gated by
 * window.OXO_CONFIG.uc4Enabled (default OFF). UC3 is now deployed (OxoGameProd
 * routes `action:'move'`), so the §19 hard edge is satisfied and the deploy
 * pipeline must write uc4Enabled:true into the prod /config.js — otherwise the
 * walking-skeleton's two real browsers face an inert board (a leak only a human
 * watching a browser would catch). This test FAILS until the deploy workflow
 * wires the flag ON, the same way the wsUrl injection is pinned by ws-contract.
 *
 * It is REMOVED together with the flag in the R4.7 factor-out (the flag is
 * slice-scoped; an orphan flag/test at retro is a §40 principle failure).
 */
const DEPLOY_WORKFLOW = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'deploy-oxo-online.yml',
);

describe('UC4 flag flip — deploy pipeline writes uc4Enabled:true into prod config.js (§40/§19)', () => {
  it('the config.js injection step sets uc4Enabled true (UC3 is deployed)', () => {
    const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
    expect(workflow).toContain('uc4Enabled');
    expect(workflow).toMatch(/uc4Enabled["\\:]+\s*true/);
  });
});
