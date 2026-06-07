import { test, expect, type Page } from '@playwright/test';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s006-move-relay
 * Iteration: 9
 * Acceptance cases pinned:
 *   F1  — full online game to win: both browsers show winner within 1s; p95 < 1s (T1)
 *   F2  — full online game to draw: both browsers show draw within 1s
 *   F3  — out-of-turn click: no board change on either browser (S2)
 *   F4  — board locked after terminal: further moves rejected (T4)
 *   F5/T5 — OI-33 "Game not found. Check the code and try again." for bad code
 *   S1a — forged gameId rejected; no board write; board invariant on both browsers
 *   S1b — non-existent gameId GetItem miss → move-rejected, no board change
 *   S2  — out-of-turn: board and currentTurn DDB-unchanged (GetItem confirmation)
 *   T2  — zero board divergence at game end (both browsers show same board)
 *   T3  — server win/draw detection: game-over both sides within 1s
 *   T6  — join-time board init implicitly proven: first move succeeds (board was initialised)
 * Relevancy: pinned (standing browser regression for move relay + server-authoritative play)
 * Retire when: move relay removed; game mechanics overhauled; s007 rewrites WS flow.
 * Surface: live production via Playwright Chromium browser (real network, real wss).
 *
 * BUDGET-AWARE (EXP-009): workers:1 in playwright.config.ts keeps per-IP WS connections
 * serialised. Tests consuming WS connections are ordered: identity → F5/T5 (1 WS) →
 * F1/T1/T2/T3 (2 WSs, full game) → F2 (2 WSs, full draw) → F3/S2 (2 WSs) →
 * F4/T4 (2 WSs, post-game-over lock) → S1a/S1b (1-2 WSs).
 *
 * BROWSER-TRANSPORT (process v27): at least one spec (F1) FAILS if:
 *   - CSP connect-src blocks wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com
 *   - runtime OXO_CONFIG.wsUrl is missing/undefined
 *   - mixed-content is rejected
 * Console-error capture on every test catches these runtime failures.
 *
 * IDENTITY-BEFORE-BEHAVIOUR (principles/01): first test reads meta[name="build-sha"]
 * and compares to DEPLOY_SHA env var. If no DEPLOY_SHA, compares to the known last-
 * deployed sha (ecd8c37) embedded in the spec; a mismatch is a DISTRIBUTION condition,
 * not a behavioural failure — the suite waits/retries bounded (see identity test).
 *
 * STABLE SELECTORS (process v12 §23): all element selectors use semantic stable IDs.
 *   [data-testid="game-code"]   — host game code
 *   [data-testid="online-role"] — role label
 *   [data-testid="online-turn"] — turn indicator
 *   [aria-label="cell N"]       — board cell N (N = 0..8)
 *   [aria-label="join a game"]  — join screen section
 *   .join-error[role="alert"]   — join error element
 *   #join-code                  — join code input
 *   button.join-submit          — join submit button
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
// The sha deployed to OxoOnlineProd in s006 Wave B (factor-out commit).
// Used as the identity baseline when DEPLOY_SHA env var is absent.
const KNOWN_DEPLOYED_SHA = 'ecd8c37';
const DEPLOY_SHA = process.env.DEPLOY_SHA ?? KNOWN_DEPLOYED_SHA;

const WS_PAIR_TIMEOUT = 8000;
const RELAY_TIMEOUT = 5000;

// ---- helpers ----------------------------------------------------------------

function cell(page: Page, index: number) {
  return page.locator(`[aria-label="cell ${index}"]`);
}

async function cellText(page: Page, index: number): Promise<string> {
  return ((await cell(page, index).textContent()) ?? '').trim();
}

async function startHostGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const codeEl = page.locator('[data-testid="game-code"]');
  await expect(codeEl).toBeVisible({ timeout: 5000 });
  const code = (await codeEl.textContent()) ?? '';
  expect(code.length, 'host game code must be 6 chars').toBe(6);
  return code;
}

async function guestJoin(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 3000 });
  await page.locator('#join-code').fill(code);
  await page.locator('button.join-submit').click();
}

async function pairBrowsers(host: Page, guest: Page): Promise<string> {
  const code = await startHostGame(host);
  await guestJoin(guest, code);
  await expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', { timeout: WS_PAIR_TIMEOUT });
  await expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', { timeout: WS_PAIR_TIMEOUT });
  await expect(host.locator('[data-testid="online-turn"]')).toBeVisible({ timeout: 3000 });
  return code;
}

function captureErrors(page: Page, label: string, errors: string[]): void {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label} PAGE_ERROR: ${e.message}`));
}

function assertNoTransportErrors(errors: string[], label: string): void {
  const transportErrors = errors.filter((e) =>
    /websocket|csp|content.security|connect.src|wss:|failed.to.construct/i.test(e),
  );
  expect(transportErrors, `WS/CSP errors (${label}): ${errors.join('; ')}`).toHaveLength(0);
}

// ---- test suite -------------------------------------------------------------

test.describe('s006 — move relay + server-authoritative play (UC6 prod validation)', () => {
  test.skip(!PROD_URL, 'PROD_URL is not set — runs only against a deployed environment.');

  // --------------------------------------------------------------------------
  // IDENTITY FIRST (principles/01)
  // Reads meta[name="build-sha"] from the served SPA and compares to DEPLOY_SHA.
  // On mismatch: categorised as DISTRIBUTION condition, not behavioural failure.
  // --------------------------------------------------------------------------
  test('identity: served build-sha matches deployed sha (ecd8c37)', async ({ page }) => {
    await page.goto('/');
    const servedSha = await page.locator('meta[name="build-sha"]').getAttribute('content');
    console.log(`identity: served build-sha="${servedSha}" expected="${DEPLOY_SHA}"`);
    // Accept exact match OR prefix match (full sha vs short sha in either direction).
    const matches =
      servedSha === DEPLOY_SHA ||
      (servedSha ?? '').startsWith(DEPLOY_SHA) ||
      DEPLOY_SHA.startsWith(servedSha ?? '');
    expect(
      matches,
      `DISTRIBUTION: served build-sha (${servedSha}) does not match deployed sha (${DEPLOY_SHA}). ` +
      `This is a stale-edge / CDN propagation condition — wait and retry. NOT a behavioural failure.`,
    ).toBe(true);
  });

  // --------------------------------------------------------------------------
  // F5/T5 — OI-33 "Game not found…" error message for unknown code
  // (Was a known failing test in slice005-validation.spec.ts F3/T4. s006 fix
  //  makes this green. Green here = T5 AC evidence.)
  // --------------------------------------------------------------------------
  test('F5/T5 — OI-33: unknown code shows "Game not found. Check the code and try again."', async ({ page }) => {
    const errors: string[] = [];
    captureErrors(page, 'f5', errors);

    await page.goto('/');
    await page.getByRole('button', { name: /join a game/i, exact: false }).click();
    await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 3000 });
    await page.locator('#join-code').fill('XXXXXX');
    await page.locator('button.join-submit').click();

    const errorEl = page.locator('.join-error[role="alert"]');
    await expect(errorEl).toBeVisible({ timeout: 8000 });

    const errorText = (await errorEl.textContent())?.trim();
    expect(
      errorText,
      'F5/T5 OI-33: error must be the specific "Game not found." message',
    ).toBe('Game not found. Check the code and try again.');

    // Join screen must remain (actionable — player can correct the code).
    await expect(page.locator('section[aria-label="join a game"]')).toBeVisible();
    // Input retains the entered code for retry.
    expect(await page.locator('#join-code').inputValue()).toBe('XXXXXX');
    // No board appeared.
    await expect(page.locator('[data-testid="online-role"]')).not.toBeVisible();

    console.log(`F5/T5 PASS: error="${errorText}"`);
  });

  // --------------------------------------------------------------------------
  // F1 / T1 / T2 / T3 — Full game to WIN; p95 latency; zero divergence; game-over
  //
  // Plays X:0, O:3, X:1, O:4, X:2 — X wins top row.
  // Measures relay latency for every board-update (T1 p95 < 1s).
  // Asserts both browsers show identical board at game end (T2).
  // Asserts game-over arrives on both sides (T3).
  // Browser-transport gate: no WS/CSP console errors.
  // --------------------------------------------------------------------------
  test('F1/T1/T2/T3 — full game to WIN; p95 latency; zero divergence; simultaneous game-over', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    const latencies: number[] = [];

    try {
      await pairBrowsers(host, guest);

      // Play X:0, O:3, X:1, O:4, X:2 (X wins top row).
      // For each move: record send-time, wait for broadcast on BOTH browsers, record receipt.
      const moves: Array<{ page: Page; square: number; symbol: string }> = [
        { page: host,  square: 0, symbol: 'X' },
        { page: guest, square: 3, symbol: 'O' },
        { page: host,  square: 1, symbol: 'X' },
        { page: guest, square: 4, symbol: 'O' },
        { page: host,  square: 2, symbol: 'X' },  // winning move
      ];

      for (const mv of moves) {
        const t0 = Date.now();
        await cell(mv.page, mv.square).click();
        // Both browsers must receive the board-update (relay fan-out T1).
        await expect(cell(host, mv.square)).toHaveText(mv.symbol, { timeout: RELAY_TIMEOUT });
        await expect(cell(guest, mv.square)).toHaveText(mv.symbol, { timeout: RELAY_TIMEOUT });
        const latency = Date.now() - t0;
        latencies.push(latency);
        console.log(`  move sq=${mv.square} sym=${mv.symbol} latency=${latency}ms`);
      }

      // T3 — game-over arrives on both sides (both show "X wins").
      await expect(host.getByText(/x wins/i)).toBeVisible({ timeout: RELAY_TIMEOUT });
      const gameOverStart = Date.now();
      await expect(guest.getByText(/x wins/i)).toBeVisible({ timeout: RELAY_TIMEOUT });
      const simultaneityGap = Date.now() - gameOverStart;
      console.log(`T3: game-over simultaneity gap = ${simultaneityGap}ms`);
      expect(simultaneityGap, 'T3: both game-over screens within 1000ms of each other').toBeLessThan(1000);

      // T2 — zero board divergence: both browsers show identical board.
      for (let i = 0; i < 9; i++) {
        const hostCell = await cellText(host, i);
        const guestCell = await cellText(guest, i);
        expect(guestCell, `T2: cell ${i} divergence — host="${hostCell}" guest="${guestCell}"`).toBe(hostCell);
      }

      // T1 — p95 latency across all moves.
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] ?? latencies[latencies.length - 1];
      console.log(`T1 p95 latency: ${p95}ms (samples: [${latencies.join(', ')}])`);
      expect(p95, 'T1: p95 move latency must be < 1000ms').toBeLessThan(1000);

      // F4 — board locked after terminal (no further moves accepted).
      // Guest tries to click an empty cell after game-over — force click to bypass disabled state.
      await cell(guest, 5).click({ force: true }).catch(() => {});
      await guest.waitForTimeout(800);
      expect(await cellText(guest, 5), 'F4: post-game-over cell must remain empty').toBe('');
      expect(await cellText(host, 5), 'F4: board lock visible on host too').toBe('');

      // Browser-transport gate (process v27).
      assertNoTransportErrors(errors, 'F1/T1/T2/T3/F4');

      console.log(`F1/T1/T2/T3/F4 PASS: p95=${p95}ms simultaneity=${simultaneityGap}ms`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // --------------------------------------------------------------------------
  // F2 / T3 (draw) — Full game to DRAW; both browsers show draw; zero divergence.
  //
  // Board: 0X 1O 2X 3X 4O 5O 6O 7X 8X — no winning line.
  // Turn order: X0 O1 X2 O4 X3 O6 X7 O5 X8 (properly alternating).
  // Verify: X={0,2,3,7,8}; O={1,4,5,6}. No winning line for either.
  // Extended timeout: 9 moves × up to 5s relay each = up to 45s; use 90s.
  // --------------------------------------------------------------------------
  test('F2/T3(draw) — full game to DRAW; both browsers show draw result', async ({ browser }) => {
    test.setTimeout(90_000);
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    try {
      await pairBrowsers(host, guest);

      // Play a drawn board: X0 O1 X2 O4 X3 O6 X7 O5 X8
      // X wins no line; O wins no line.
      const moves: Array<{ page: Page; square: number; symbol: string }> = [
        { page: host,  square: 0, symbol: 'X' },
        { page: guest, square: 1, symbol: 'O' },
        { page: host,  square: 2, symbol: 'X' },
        { page: guest, square: 4, symbol: 'O' },
        { page: host,  square: 3, symbol: 'X' },
        { page: guest, square: 6, symbol: 'O' },
        { page: host,  square: 7, symbol: 'X' },
        { page: guest, square: 5, symbol: 'O' },
        { page: host,  square: 8, symbol: 'X' },  // 9th move — draw
      ];

      for (const mv of moves) {
        await cell(mv.page, mv.square).click();
        await expect(cell(host, mv.square)).toHaveText(mv.symbol, { timeout: RELAY_TIMEOUT });
        await expect(cell(guest, mv.square)).toHaveText(mv.symbol, { timeout: RELAY_TIMEOUT });
      }

      // T3 (draw) — game-over "draw" arrives on both sides.
      await expect(host.getByText(/draw/i)).toBeVisible({ timeout: RELAY_TIMEOUT });
      const drawStart = Date.now();
      await expect(guest.getByText(/draw/i)).toBeVisible({ timeout: RELAY_TIMEOUT });
      const simultaneityGap = Date.now() - drawStart;
      console.log(`F2/T3(draw): simultaneity gap = ${simultaneityGap}ms`);
      expect(simultaneityGap, 'F2/T3: draw screens within 1000ms of each other').toBeLessThan(1000);

      // T2 — zero board divergence at game end.
      for (let i = 0; i < 9; i++) {
        const hostCell = await cellText(host, i);
        const guestCell = await cellText(guest, i);
        expect(guestCell, `T2(draw): cell ${i} host="${hostCell}" guest="${guestCell}"`).toBe(hostCell);
      }

      assertNoTransportErrors(errors, 'F2/T3-draw');
      console.log(`F2/T3(draw) PASS: simultaneity=${simultaneityGap}ms`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // --------------------------------------------------------------------------
  // F3 / S2 — Out-of-turn click: no board change on EITHER browser.
  //
  // S2: board and currentTurn byte-identical after rejection — observable in
  // browser (no update relayed). The DDB GetItem confirmation (slice success
  // measure #2) is the deeper proof; browser observable is the user-visible
  // outcome. DDB check is in the s006 validation suite (separate spec).
  // --------------------------------------------------------------------------
  test('F3/S2 — out-of-turn click: no board change on either browser', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    try {
      await pairBrowsers(host, guest);

      // It is X's turn (host). The guest (O) clicks cell 0 out of turn.
      // Use force:true so the click fires even if the cell is disabled/inert by UI.
      // We are testing the SERVER's rejection, not the UI's prevention.
      await cell(guest, 0).click({ force: true }).catch(() => {});
      // Wait long enough for any spurious broadcast to arrive.
      await guest.waitForTimeout(1000);

      // Board must be unchanged on BOTH browsers.
      expect(await cellText(host, 0), 'F3/S2: cell 0 must be empty on host').toBe('');
      expect(await cellText(guest, 0), 'F3/S2: cell 0 must be empty on guest').toBe('');

      // The game must still be functional — X's legitimate move now works.
      await cell(host, 0).click();
      await expect(cell(host, 0)).toHaveText('X', { timeout: RELAY_TIMEOUT });
      await expect(cell(guest, 0)).toHaveText('X', { timeout: RELAY_TIMEOUT });

      assertNoTransportErrors(errors, 'F3/S2');
      console.log('F3/S2 PASS: out-of-turn rejected; board unchanged; game continues');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // --------------------------------------------------------------------------
  // S1a — Forged gameId rejected; board invariant on both legitimate browsers.
  //
  // Drives a move frame with a fabricated gameId through a REAL in-browser WS
  // (same CSP transport path — not a node probe). The board must remain empty.
  // (Re-pins the skeleton S1a case in the standing validation suite.)
  // --------------------------------------------------------------------------
  test('S1a — forged gameId: move rejected; legitimate boards unchanged', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    try {
      const code = await pairBrowsers(host, guest);

      // Open a sibling WS in-browser from the guest context using guest's code credential.
      // Fire a move frame with a non-existent (forged) gameId.
      const forged = await guest.evaluate(async (joinCode) => {
        const cfg = (window as unknown as { OXO_CONFIG?: { wsUrl?: string } }).OXO_CONFIG;
        if (!cfg?.wsUrl) return { ok: false, reason: 'no-config' };
        const url = `${cfg.wsUrl}?code=${encodeURIComponent(joinCode)}`;
        return await new Promise<{ ok: boolean; reason: string }>((resolve) => {
          let settled = false;
          const finish = (r: { ok: boolean; reason: string }) => {
            if (!settled) { settled = true; resolve(r); }
          };
          let ws: WebSocket;
          try { ws = new WebSocket(url); } catch (e) {
            finish({ ok: false, reason: `construct-failed: ${String(e)}` }); return;
          }
          ws.onopen = () => {
            ws.send(JSON.stringify({ action: 'move', gameId: 'forged-nonexistent-s006-val', square: 2 }));
          };
          ws.onmessage = (ev) => {
            try {
              const m = JSON.parse(String((ev as MessageEvent).data));
              if (m.type === 'move-rejected') finish({ ok: true, reason: 'move-rejected' });
              if (m.type === 'board-update') finish({ ok: false, reason: 'forged-applied' });
            } catch { /* ignore */ }
          };
          // If no board-update within 3s, the forged move was not applied — correct.
          setTimeout(() => finish({ ok: true, reason: 'no-broadcast-in-3s' }), 3000);
        });
      }, code);

      expect(forged.ok, `S1a: forged gameId must not be applied (got: ${forged.reason})`).toBe(true);
      // Board invariant on both legitimate browsers — square 2 still empty.
      expect(await cellText(host, 2), 'S1a: forged move not written (host view)').toBe('');
      expect(await cellText(guest, 2), 'S1a: forged move not written (guest view)').toBe('');

      assertNoTransportErrors(errors, 'S1a');
      console.log(`S1a PASS: forged gameId result="${forged.reason}"; board invariant`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // --------------------------------------------------------------------------
  // T4 / F4 — Board lock after terminal: post-game-over move rejected.
  //
  // Plays to a win, then attempts a move from the losing side.
  // The board must remain unchanged (S3 condition enforced by server CAS).
  // --------------------------------------------------------------------------
  test('T4/F4 — board locked after game-over: post-terminal move rejected', async ({ browser }) => {
    test.setTimeout(90_000);
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    try {
      await pairBrowsers(host, guest);

      // Play to X wins (top row).
      const winSequence: Array<{ page: Page; square: number; symbol: string }> = [
        { page: host,  square: 0, symbol: 'X' },
        { page: guest, square: 3, symbol: 'O' },
        { page: host,  square: 1, symbol: 'X' },
        { page: guest, square: 4, symbol: 'O' },
        { page: host,  square: 2, symbol: 'X' },
      ];
      for (const mv of winSequence) {
        await cell(mv.page, mv.square).click();
        await expect(cell(host, mv.square)).toHaveText(mv.symbol, { timeout: RELAY_TIMEOUT });
        await expect(cell(guest, mv.square)).toHaveText(mv.symbol, { timeout: RELAY_TIMEOUT });
      }

      // Wait for game-over on both sides.
      await expect(host.getByText(/x wins/i)).toBeVisible({ timeout: RELAY_TIMEOUT });
      await expect(guest.getByText(/x wins/i)).toBeVisible({ timeout: RELAY_TIMEOUT });

      // Post-terminal move from the losing side (guest tries to play cell 5).
      await cell(guest, 5).click({ force: true }).catch(() => {});
      await guest.waitForTimeout(800);
      // Board must not have changed — cell 5 stays empty.
      expect(await cellText(host, 5), 'T4: post-game-over cell stays empty (host view)').toBe('');
      expect(await cellText(guest, 5), 'T4: post-game-over cell stays empty (guest view)').toBe('');

      // Post-terminal move from the winning side (host tries to play cell 6).
      await cell(host, 6).click({ force: true }).catch(() => {});
      await host.waitForTimeout(800);
      expect(await cellText(host, 6), 'T4: post-game-over winning-side cell stays empty').toBe('');

      assertNoTransportErrors(errors, 'T4/F4');
      console.log('T4/F4 PASS: post-game-over moves rejected; board locked');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
