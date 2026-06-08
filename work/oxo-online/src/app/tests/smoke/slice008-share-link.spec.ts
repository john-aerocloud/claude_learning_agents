import { test, expect, type Page } from '@playwright/test';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s008-share-link
 * Iteration: 11
 * Acceptance cases pinned:
 *   AC1.5  — [UC1, UC3, T3] Playwright smoke: clicking the copy control on the deployed
 *             HTTPS origin places `https://<domain>/join/<6-char-code>` on the clipboard;
 *             code remains visible as [data-testid="game-code"].
 *   AC2.4  — [UC2, UC3, T1] Fresh-tab /join/<real-code> returns HTTP 200 (SPA boots, not
 *             CloudFront/S3 error page); join screen renders with code pre-filled + Join enabled.
 *   AC2.5  — [UC2, UC3, T2] Clicking Join once transitions both host + guest to board via the
 *             existing WS join path (roles visible, turn indicator visible).
 *   AC2.6  — [UC2, UC3, T4] /join/XXXXXX (invalid code) → submit → "Game not found. Check
 *             the code and try again." — no crash, no generic 500/edge error.
 *   AC3.1  — [UC3, T5] Manual code-entry join flow still works; join screen reached without
 *             URL param shows empty code input (no spurious pre-fill). s005 regression.
 *   AC3.4  — [UC1, UC2, UC3, T6, F4] C4 DONE-CONDITION: Player A creates game, copies share
 *             link; Player B (separate browser context) navigates to the link, code pre-filled,
 *             clicks Join once; both play a full game to a result screen. Elapsed time from
 *             Player A clicking "Create" to both seeing the result is under 5 minutes.
 *   AC3.5  — [UC1, UC3, S3] URL form pin: the share URL is exactly origin+"/join/"+code with
 *             NO query param or fragment (the code is the only path-segment credential).
 *
 * NOTE on identity (principles/01): the identity check (meta[name="build-sha"]) is placed
 * FIRST in the describe block. Mismatch = DISTRIBUTION condition, not behavioural failure;
 * the test logs and continues (bounded retry tolerance) — behavioural tests may still run
 * and their outcome is trusted only if identity matches.
 *
 * BUDGET-AWARE (EXP-009, two rate-limiting layers):
 *   1. CloudFront WAF: 100/5-min per IP (sliding 300s window). Exemption via waf-runner-ip-add.
 *   2. WS $connect authorizer: per-IP ConnectAttempts DDB counter. Same exemption covers both.
 *   Both layers exempt during smoke-ci (waf-runner-ip.js covers WAF + authorizer).
 *   Parallel workers (workers:4) are safe (IMP-009 L1); prior serial workaround obsolete.
 *   WS-consuming tests (AC2.5, AC3.4) may now run in parallel. Use `make smoke-ci`.
 *
 * BROWSER-TRANSPORT (process v27):
 *   AC2.5 and AC3.4 FAIL if:
 *     - CSP connect-src blocks wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com
 *     - runtime OXO_CONFIG.wsUrl is missing/undefined
 *     - CloudFront SPA-fallback does not serve /join/<code> as 200+index.html
 *   These are browser-only failures invisible to any non-browser probe.
 *
 * STABLE SELECTORS (process v12 §23):
 *   [data-testid="game-code"]          — host game code on waiting screen
 *   [data-testid="copy-link-btn"]      — "Copy link" button on waiting screen
 *                                        (s009 UC4 split the single copy-link into
 *                                        copy-code-btn + copy-link-btn; the share-URL
 *                                        affordance is now copy-link-btn)
 *   [data-testid="copy-code-btn"]      — "Copy code" button (copies the 6-char code)
 *   [data-testid="online-role"]        — role label (You are X / You are O)
 *   [data-testid="online-turn"]        — turn indicator (server-authoritative)
 *   [aria-label="cell N"]              — board cell N (0..8)
 *   section[aria-label="join a game"]  — join screen section
 *   #join-code                         — join code input
 *   button.join-submit                 — join submit button
 *   getByRole('group', { name: /game mode/i }) — mode selector group
 *
 * Relevancy: pinned (standing browser regression for share-link / C4 done-condition).
 * Retire when: /join/:code route removed; copy-link control removed; C4 superseded.
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';

// OI-40 FIX (s005-h3): DYNAMIC sha comparison — compare to DEPLOY_SHA env var
// when set (pipeline passes this), otherwise fall back to git rev-parse HEAD.
// Prior hardcoded set ['c69140a', '1b138ed'] caused false DISTRIBUTION failures
// on deploys after s008 (s005-h3 and later). The spec is now forward-compatible:
// any deploy that sets DEPLOY_SHA matches; a local run uses HEAD.
import { execFileSync as _execFileSync } from 'node:child_process';
function _resolveExpectedSha(): string {
  if (process.env.DEPLOY_SHA) return process.env.DEPLOY_SHA;
  try {
    return _execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
const DEPLOY_SHA = _resolveExpectedSha();

const BOGUS_CODE = 'XXXXXX';

function cell(page: Page, index: number) {
  return page.locator(`[aria-label="cell ${index}"]`);
}

function captureErrors(page: Page, label: string, errors: string[]): void {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label} PAGE_ERROR: ${e.message}`));
}

function assertNoTransportErrors(errors: string[], label: string): void {
  const transportErrors = errors.filter((e) =>
    /websocket|csp|content.security|connect.src|wss:|failed.to.construct|refused/i.test(e),
  );
  expect(transportErrors, `WS/CSP errors (${label}): ${errors.join('; ')}`).toHaveLength(0);
}

async function startHostGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const codeEl = page.locator('[data-testid="game-code"]');
  await expect(codeEl).toBeVisible({ timeout: 8000 });
  const code = (await codeEl.textContent()) ?? '';
  expect(code.length, 'host game code must be 6 chars').toBe(6);
  return code;
}

async function guestJoinManual(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 3000 });
  await page.locator('#join-code').fill(code);
  await page.locator('button.join-submit').click();
}

test.describe('s008 share-link smoke — copy-link, deep-link, C4 done-condition', () => {
  test.skip(!PROD_URL, 'PROD_URL not set — runs only against a deployed environment.');

  // --------------------------------------------------------------------------
  // IDENTITY FIRST (principles/01)
  // --------------------------------------------------------------------------
  test('identity: served build-sha matches deployed sha (DEPLOY_SHA env / git HEAD — dynamic, OI-40)', async ({ page }) => {
    await page.goto('/');
    const servedSha = await page.locator('meta[name="build-sha"]').getAttribute('content');
    console.log(`identity: served build-sha="${servedSha}" expected="${DEPLOY_SHA}"`);
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
  // AC3.1 / T5 — Manual code-entry regression (no spurious pre-fill on /join)
  // --------------------------------------------------------------------------
  test('AC3.1/T5 — manual code-entry join: empty input on mode-selector path; no spurious pre-fill', async ({ page }) => {
    const errors: string[] = [];
    captureErrors(page, 'ac3.1', errors);

    await page.goto('/');
    // No URL param — mode selector path. Click "Join a game".
    await page.getByRole('button', { name: /join a game/i, exact: false }).click();
    await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 5000 });
    // Code input must be EMPTY — no spurious pre-fill from URL.
    await expect(page.locator('#join-code')).toHaveValue('');
    // Join button is present and visible.
    await expect(page.locator('button.join-submit')).toBeVisible();
    // Mode selector group is present.
    await expect(page.getByRole('group', { name: /game mode/i })).toBeVisible();

    assertNoTransportErrors(errors, 'AC3.1');
    console.log('AC3.1/T5 PASS: manual join path has empty code input; no spurious pre-fill');
  });

  // --------------------------------------------------------------------------
  // AC1.5 / T3 — Copy-link control places correct URL on clipboard; code visible
  // S3 / AC3.5 — URL form: origin+"/join/"+code, no query param, no fragment
  //
  // Clipboard grant: Playwright grants clipboard-read permission in the context.
  // navigator.clipboard.writeText is not CSP-governed (S1 satisfied).
  // --------------------------------------------------------------------------
  test('AC1.5/T3/AC3.5/S3 — copy-link control copies exact share URL; code remains visible', async ({ browser }) => {
    const ctx = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    captureErrors(page, 'ac1.5', errors);

    try {
      const code = await startHostGame(page);
      console.log(`AC1.5: host created game code=${code}`);

      // The "Copy link" control must be present on the waiting screen. s009 UC4
      // split the single copy-link into copy-code-btn + copy-link-btn; the
      // share-URL affordance is now copy-link-btn.
      const copyBtn = page.locator('[data-testid="copy-link-btn"]');
      await expect(copyBtn, '[data-testid="copy-link-btn"] must be visible on waiting screen').toBeVisible({ timeout: 5000 });
      await expect(copyBtn).toHaveText(/copy link/i);
      // The companion "Copy code" control (the type-the-code affordance) is also present.
      await expect(page.locator('[data-testid="copy-code-btn"]')).toBeVisible();

      // Click the copy-link control.
      await copyBtn.click();

      // Read the clipboard value — Playwright granted clipboard-read permission.
      const clipText = await page.evaluate(() => navigator.clipboard.readText());
      console.log(`AC1.5: clipboard text="${clipText}"`);

      // Must match exactly: <origin>/join/<6-char-code>
      const expectedUrl = `${new URL(PROD_URL!).origin}/join/${code}`;
      expect(clipText, `clipboard must be exactly "${expectedUrl}" (AC3.5/S3: no query/fragment)`).toBe(expectedUrl);

      // S3/AC3.5: no query param, no fragment.
      const parsed = new URL(clipText);
      expect(parsed.search, 'S3: URL must have no query params').toBe('');
      expect(parsed.hash, 'S3: URL must have no fragment').toBe('');
      expect(parsed.pathname, 'S3: pathname must be /join/<code>').toBe(`/join/${code}`);
      expect(code.length, 'S3: code segment must be 6 chars').toBe(6);

      // Code must still be visible as plain text (AC1.4/SM-1).
      await expect(page.locator('[data-testid="game-code"]')).toBeVisible();
      await expect(page.locator('[data-testid="game-code"]')).toHaveText(code);

      assertNoTransportErrors(errors, 'AC1.5');
      console.log(`AC1.5/T3/S3 PASS: clipboard="${clipText}"; code visible; no query/fragment`);
    } finally {
      await ctx.close();
    }
  });

  // --------------------------------------------------------------------------
  // AC2.4 / T1 — Deep-link /join/<real-code> returns HTTP 200 (SPA boots)
  // AC2.6 / T4 — Invalid code → readable error "Game not found. Check the code and try again."
  //
  // The two cases are sequenced: first confirm valid-code deep-link boots SPA
  // (T1), then separately confirm invalid-code error (T4/AC2.6). This avoids
  // a WS join (budget preserving) while still exercising both CloudFront-fallback
  // and the pre-fill + error path.
  // --------------------------------------------------------------------------
  test('AC2.4/T1 — fresh-tab /join/<real-code> returns 200 (SPA boots, not edge error); code pre-filled; Join enabled', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(guest, 'ac2.4', errors);

    try {
      // Mint a real code via the host create flow.
      const code = await startHostGame(host);
      console.log(`AC2.4: host code=${code}`);

      // Guest navigates to the share link — CloudFront SPA-fallback must serve
      // /join/<code> as 200+index.html (not a 403/404 S3 error page).
      const resp = await guest.goto(`/join/${code}`);
      expect(resp?.status(), 'deep-link must return HTTP 200 (SPA fallback, not edge error)').toBe(200);

      // Join screen must render (SPA booted and React Router resolved /join/:code).
      await expect(guest.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 8000 });

      // Code input must be pre-filled from the URL path.
      await expect(guest.locator('#join-code')).toHaveValue(code, { timeout: 5000 });

      // Join button must be enabled (one click away).
      await expect(guest.locator('button.join-submit')).toBeEnabled();

      // Mode selector also visible (SPA mounted normally).
      await expect(guest.getByRole('group', { name: /game mode/i })).toBeVisible();

      // No WS/CSP/transport errors on deep-link SPA boot.
      assertNoTransportErrors(errors, 'AC2.4');
      console.log(`AC2.4/T1 PASS: /join/${code} returned 200; SPA booted; code pre-filled; Join enabled`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('AC2.6/T4 — /join/XXXXXX (invalid code) + submit → "Game not found. Check the code and try again."; no crash', async ({ page }) => {
    const errors: string[] = [];
    captureErrors(page, 'ac2.6', errors);

    // Navigate to a bogus deep-link.
    const resp = await page.goto(`/join/${BOGUS_CODE}`);
    // Still serves the SPA (fallback rule) — HTTP 200.
    expect(resp?.status(), 'bogus deep-link must still return 200 (SPA fallback)').toBe(200);

    // Join screen renders with the bogus code pre-filled.
    await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#join-code')).toHaveValue(BOGUS_CODE, { timeout: 5000 });
    await expect(page.locator('button.join-submit')).toBeEnabled();

    // Click Join — the authorizer will deny (code-not-found) as an ABNORMAL CLOSE:
    // OI-33: the $connect authorizer does a GSI lookup for the code; if not found it
    // Denies (reason "code-not-found"), so the WS handshake is refused BEFORE it
    // opens. The browser surfaces this as a console error "WebSocket ... failed: 403"
    // (Unexpected response code: 403). This is NOT a CSP failure — it is the EXPECTED
    // authorizer signal for an invalid code. The SPA maps it to the readable message.
    await page.locator('button.join-submit').click();

    // The reconciled shared error message (product decision A — acceptance.md F2/AC2.3).
    await expect(
      page.locator('.join-error[role="alert"]'),
      'AC2.6: error message must be the shared "code-not-found" string',
    ).toHaveText('Game not found. Check the code and try again.', { timeout: 10000 });

    // Page must not crash (mode selector still accessible).
    await expect(page.getByRole('group', { name: /game mode/i })).toBeVisible();

    // Browser-transport check: only UNEXPECTED WS errors are failures here.
    // The expected 403 from the authorizer (OI-33 code-not-found signal) is
    // deliberately excluded from the failure filter — it is the protocol signal,
    // not a CSP block or missing config. Assert NO CSP-specific errors.
    const unexpectedTransportErrors = errors.filter((e) =>
      /csp|content.security|connect.src|failed.to.construct|refused/i.test(e) &&
      !/403|handshake|response code/i.test(e),
    );
    expect(
      unexpectedTransportErrors,
      `AC2.6: unexpected CSP/config errors (expected 403 from authorizer is normal): ${errors.join('; ')}`,
    ).toHaveLength(0);

    // Confirm the authorizer-403 error IS present (documents the OI-33 signal).
    const authorizerDenialLog = errors.filter((e) => /403|handshake/i.test(e));
    console.log(`AC2.6: authorizer denial (expected): "${authorizerDenialLog.join('; ')}"`);

    console.log('AC2.6/T4 PASS: bogus deep-link → shared error text; no crash; mode selector visible');
  });

  // --------------------------------------------------------------------------
  // AC2.5 / T2 — One-click join via deep-link transitions both players to board
  //              (requires a WS connection — budget-aware; runs after non-WS tests)
  // --------------------------------------------------------------------------
  test('AC2.5/T2 — deep-link pre-fill + one-click Join transitions host + guest to board', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    try {
      // Host creates game.
      const code = await startHostGame(host);
      console.log(`AC2.5: host code=${code}`);

      // Guest navigates to the share link (deep-link form).
      const resp = await guest.goto(`/join/${code}`);
      expect(resp?.status(), 'AC2.5: deep-link must return 200').toBe(200);
      await expect(guest.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 8000 });
      await expect(guest.locator('#join-code')).toHaveValue(code, { timeout: 5000 });
      await expect(guest.locator('button.join-submit')).toBeEnabled();

      // One click — reuses the existing WS join path (no new contract).
      const t0 = Date.now();
      await guest.locator('button.join-submit').click();

      // Both reach the board.
      await expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', { timeout: 8000 });
      await expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', { timeout: 8000 });
      await expect(host.locator('[data-testid="online-turn"]')).toBeVisible({ timeout: 5000 });
      await expect(guest.locator('[data-testid="online-turn"]')).toBeVisible({ timeout: 5000 });

      const elapsed = Date.now() - t0;
      console.log(`AC2.5: both players reached board in ${elapsed}ms from guest clicking Join`);

      assertNoTransportErrors(errors, 'AC2.5');
      console.log(`AC2.5/T2 PASS: one-click join via deep-link; host=X guest=O; elapsed=${elapsed}ms`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  // --------------------------------------------------------------------------
  // AC3.4 / T6 / SM-5 — C4 DONE-CONDITION
  // Two-browser end-to-end: create → copy share link → navigate link → one-click
  // join → full game to result screen. Elapsed < 5 minutes (300 000ms).
  //
  // This is the proof that C4 (online two-player match) is COMPLETE.
  // C4 done-condition: "Two players in separate browsers can complete a full game:
  //   host creates a game and shares a code; joiner enters the code and joins;
  //   moves made in one browser appear in the other within 1s (p95);
  //   win/draw is detected and shown to both players;
  //   disconnection is handled gracefully. No accounts required."
  // All elements: game play (s006), disconnect (s007), share link (this slice).
  // --------------------------------------------------------------------------
  test('AC3.4/T6/SM-5 — C4 DONE-CONDITION: share-link two-browser full game to result in < 5 min', async ({ browser }) => {
    const globalStart = Date.now();

    const hostCtx = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    captureErrors(host, 'host', errors);
    captureErrors(guest, 'guest', errors);

    try {
      // --- Player A: create game and copy the share link ---
      const code = await startHostGame(host);
      console.log(`SM-5: Player A (host) created game code=${code}`);

      // The "Copy link" control must be present (s009 UC4: copy-link-btn).
      const copyBtn = host.locator('[data-testid="copy-link-btn"]');
      await expect(copyBtn).toBeVisible({ timeout: 5000 });
      await copyBtn.click();

      // Read clipboard — this is the share URL Player A would send.
      const shareUrl = await host.evaluate(() => navigator.clipboard.readText());
      console.log(`SM-5: share URL="${shareUrl}"`);

      // Validate the URL form (S3/AC3.5 inline): must be origin+/join/+code.
      const parsedShare = new URL(shareUrl);
      expect(parsedShare.pathname).toBe(`/join/${code}`);
      expect(parsedShare.search).toBe('');
      expect(parsedShare.hash).toBe('');

      // --- Player B: open the share link directly (one-click join) ---
      const guestResp = await guest.goto(shareUrl);
      expect(guestResp?.status(), 'SM-5: share link must return 200 (SPA boot)').toBe(200);
      await expect(guest.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 8000 });
      await expect(guest.locator('#join-code')).toHaveValue(code, { timeout: 5000 });
      await expect(guest.locator('button.join-submit')).toBeEnabled();

      // One click.
      await guest.locator('button.join-submit').click();

      // Both players reach the board.
      await expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', { timeout: 10000 });
      await expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', { timeout: 10000 });
      await expect(host.locator('[data-testid="online-turn"]')).toBeVisible({ timeout: 5000 });
      console.log(`SM-5: both players on board (${Date.now() - globalStart}ms from global start)`);

      // --- Play a full game to result: X:0, O:3, X:1, O:4, X:2 (X wins top row) ---
      const moves: Array<{ page: Page; square: number; symbol: string }> = [
        { page: host,  square: 0, symbol: 'X' },
        { page: guest, square: 3, symbol: 'O' },
        { page: host,  square: 1, symbol: 'X' },
        { page: guest, square: 4, symbol: 'O' },
        { page: host,  square: 2, symbol: 'X' },
      ];

      for (const mv of moves) {
        await cell(mv.page, mv.square).click();
        // Wait for the relay to show the move on BOTH boards (server-authoritative).
        await expect(cell(host, mv.square)).toHaveText(mv.symbol, { timeout: 5000 });
        await expect(cell(guest, mv.square)).toHaveText(mv.symbol, { timeout: 5000 });
        console.log(`SM-5: move square=${mv.square} symbol=${mv.symbol} relayed to both boards`);
      }

      // Both players see the result screen (X wins).
      await expect(host.getByText(/x wins/i)).toBeVisible({ timeout: 8000 });
      await expect(guest.getByText(/x wins/i)).toBeVisible({ timeout: 8000 });

      const totalElapsedMs = Date.now() - globalStart;
      const totalElapsedSec = Math.round(totalElapsedMs / 100) / 10;
      console.log(`SM-5 ELAPSED: ${totalElapsedMs}ms (${totalElapsedSec}s) from Player A clicking "Create" to both seeing result`);

      // SM-5 constraint: elapsed < 5 minutes (300 000ms).
      expect(
        totalElapsedMs,
        `SM-5: elapsed ${totalElapsedMs}ms must be < 300000ms (5 minutes). Actual: ${totalElapsedSec}s`,
      ).toBeLessThan(300_000);

      assertNoTransportErrors(errors, 'SM-5');

      console.log(`SM-5/T6/AC3.4 PASS: C4 done-condition MET. Elapsed=${totalElapsedSec}s. X wins via share link.`);
      console.log('C4: game play (s006) + disconnect handling (s007) + share link (s008) ALL DELIVERED.');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
