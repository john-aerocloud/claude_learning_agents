import { test, expect, Page } from '@playwright/test';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s005-h2-connect-auth
 * Acceptance pinned:
 *   AC7.1 — Local two-player full game completes without regression.
 *   AC7.2 — vs-AI game completes without regression.
 *   AC7.3 — Online create+join: both players reach the board with roles labelled
 *            within 3s of code entry — CRITICAL browser-transport spec (process v27).
 *            Two Playwright browser contexts, real wss through the s005-h2 REQUEST
 *            authorizer. FAILS if:
 *              - CSP connect-src blocks wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com
 *              - runtime config wsUrl is missing/undefined
 *              - wsToken is absent from POST /api/games response
 *              - SPA does not append ?wsToken= or ?code= to the WS URL
 *              - authorizer rejects a legitimate host or guest credential
 *   AC7.4 — POST /api/games → 201 with gameId, code, wsToken fields present.
 * Relevancy: pinned (standing browser regression for WS authorizer gate).
 * Retire when: online game mode removed; wsToken contract replaced; WS API replaced.
 * Surface: live production via Playwright Chromium browser (real network, real wss).
 * Replaces: the s005 slice005-validation.spec.ts F1/T1 pairing test still runs;
 *   this spec is the h2-specific assertion that the AUTHORIZER does not block the
 *   user-visible pairing. Both specs must pass concurrently.
 *
 * BROWSER-TRANSPORT REQUIREMENT (process v27): this spec MUST fail if the
 * authorizer rejects a legitimate wsToken or code at the HTTP upgrade layer,
 * because those failures surface in the browser as "The WebSocket could not be
 * established" / no board appearing. The test asserts the positive outcome
 * (board visible within 3s); absence of the board IS the failure signal.
 * Console-error capture additionally catches any "Failed to construct 'WebSocket'"
 * CSP errors or "WebSocket is closed before the connection is established" signals.
 */

const PROD_URL = process.env.PROD_URL;
const WS_JOIN_TIMEOUT_MS = 3000;

function getCells(page: Page) {
  return page.locator('[aria-label^="cell "]');
}

async function clickCell(page: Page, index: number) {
  await getCells(page).nth(index).click();
}

async function cellText(page: Page, index: number): Promise<string> {
  return (await getCells(page).nth(index).textContent()) ?? '';
}

/** Navigate to the host waiting screen and return the game code. */
async function startHostGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const gameCodeEl = page.locator('[data-testid="game-code"]');
  await expect(gameCodeEl).toBeVisible({ timeout: 3000 });
  const code = (await gameCodeEl.textContent()) ?? '';
  expect(code.length, 'host game code must be 6 chars').toBe(6);
  return code;
}

/** Navigate to the join screen on a page. */
async function openJoinScreen(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 2000 });
}

/** Submit a code on the join screen. */
async function submitJoinCode(page: Page, code: string): Promise<void> {
  const input = page.locator('#join-code');
  await input.fill(code);
  await page.locator('button.join-submit').click();
}

test.describe('s005-h2 — Regression + browser-transport pairing (AC7.1–AC7.4)', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — smoke runs only against a deployed environment.',
  );

  // ---------------------------------------------------------------------------
  // AC7.3 — CRITICAL browser-transport spec (process v27).
  // Two real Playwright browser contexts; real wss:// through the s005-h2 authorizer.
  // HOST context: POST /api/games → wsToken in response → SPA opens wss?wsToken=…
  // GUEST context: enters code → SPA opens wss?code=…
  // Both reach the game board within 3s of guest submitting the code.
  // ---------------------------------------------------------------------------
  test('AC7.3 — BROWSER: host+guest both reach board via authorizer within 3s', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const hostErrors: string[] = [];
    const guestErrors: string[] = [];

    // Capture console errors — these will contain WebSocket/CSP failures if
    // the authorizer rejects the connection or CSP blocks the wss URL.
    hostPage.on('console', (msg) => {
      if (msg.type() === 'error') hostErrors.push(msg.text());
    });
    guestPage.on('console', (msg) => {
      if (msg.type() === 'error') guestErrors.push(msg.text());
    });

    // Also capture page errors (unhandled JS exceptions).
    hostPage.on('pageerror', (err) => hostErrors.push(`PAGE_ERROR: ${err.message}`));
    guestPage.on('pageerror', (err) => guestErrors.push(`PAGE_ERROR: ${err.message}`));

    try {
      // Host creates a game — the SPA internally POSTs /api/games and receives
      // { gameId, code, wsToken }. The SPA then opens wss?wsToken=<token>.
      const code = await startHostGame(hostPage);
      console.log(`AC7.3: host code=${code}`);

      // Host WS connecting indicator must appear (proves WS open attempt started).
      const hostConnecting = hostPage.locator('[data-testid="host-connecting"]');
      await expect(hostConnecting).toBeVisible({ timeout: 2000 });

      // Guest opens join screen and submits the code.
      await openJoinScreen(guestPage);

      const t0 = Date.now();
      await submitJoinCode(guestPage, code);

      // Guest board must appear within 3s (AC7.3 / SM-4).
      const guestRole = guestPage.locator('[data-testid="online-role"]');
      await expect(guestRole, 'guest board must appear within 3s').toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });

      const elapsed = Date.now() - t0;
      console.log(`AC7.3: guest board appeared in ${elapsed}ms`);
      expect(elapsed, 'guest board must appear within 3000ms').toBeLessThan(WS_JOIN_TIMEOUT_MS);

      // Guest must be O.
      const guestRoleText = await guestRole.textContent();
      expect(guestRoleText?.trim(), 'guest role must be "You are O"').toBe('You are O');

      // Host board must also appear within the 3s window (timing from t0).
      const hostRole = hostPage.locator('[data-testid="online-role"]');
      await expect(hostRole, 'host board must appear within 3s').toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });
      const hostRoleText = await hostRole.textContent();
      expect(hostRoleText?.trim(), 'host role must be "You are X"').toBe('You are X');

      // §23 surface migration (s006): with UC4 live the inert "moves coming in
      // the next update" status line is replaced by the server-authoritative turn
      // indicator. Pairing completeness is now confirmed by the turn indicator
      // being visible on both boards (host to move = X).
      await expect(hostPage.locator('[data-testid="online-turn"]'), 'host turn indicator').toBeVisible({ timeout: 2000 });
      await expect(guestPage.locator('[data-testid="online-turn"]'), 'guest turn indicator').toBeVisible({ timeout: 2000 });

      // Browser-transport assertion: no console errors (CSP/WS failures would show here).
      expect(
        hostErrors.filter((e) =>
          /websocket|csp|content.security|connect.src|wss:|failed.to.construct/i.test(e),
        ),
        `Host WS/CSP console errors: ${hostErrors.join('; ')}`,
      ).toHaveLength(0);
      expect(
        guestErrors.filter((e) =>
          /websocket|csp|content.security|connect.src|wss:|failed.to.construct/i.test(e),
        ),
        `Guest WS/CSP console errors: ${guestErrors.join('; ')}`,
      ).toHaveLength(0);

      console.log(`AC7.3 PASS: host=X guest=O elapsed=${elapsed}ms (${elapsed < 3000 ? 'within' : 'OVER'} 3s limit)`);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC7.4 — POST /api/games → 201 with gameId, code, wsToken (regression).
  // Browser-level fetch via page.evaluate so it exercises the same CF endpoint
  // the SPA uses, including CSP and request headers.
  // ---------------------------------------------------------------------------
  test('AC7.4 — POST /api/games returns 201 with gameId, code, wsToken from browser', async ({ page }) => {
    await page.goto('/');

    // Use browser fetch (via page.evaluate) to hit the same origin as the SPA.
    const result = await page.evaluate(async (prodUrl) => {
      const res = await fetch(`${prodUrl}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json();
      return { status: res.status, body };
    }, PROD_URL!);

    expect(result.status, 'POST /api/games must return 201').toBe(201);
    expect(result.body.gameId, 'gameId must be present').toBeTruthy();
    expect(result.body.code, 'code must be present').toBeTruthy();
    expect(result.body.wsToken, 'wsToken must be present in response').toBeTruthy();

    // Shape check: <b64url>.<b64url>
    const parts = (result.body.wsToken as string).split('.');
    expect(parts.length, 'wsToken must be two dot-separated parts').toBe(2);

    console.log(`AC7.4 PASS: 201 gameId=${result.body.gameId} code=${result.body.code} wsToken present`);
  });

  // ---------------------------------------------------------------------------
  // AC7.1 — Local two-player regression: full game completes (X wins top row).
  // ---------------------------------------------------------------------------
  test('AC7.1 — Local two-player regression: X wins top row without breakage', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto('/');

    await expect(page.getByRole('button', { name: /two player/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    await expect(getCells(page)).toHaveCount(9);

    // X:0, O:3, X:1, O:4, X:2 — X wins top row.
    await clickCell(page, 0);
    await clickCell(page, 3);
    await clickCell(page, 1);
    await clickCell(page, 4);
    await clickCell(page, 2);

    await expect(page.getByText(/x wins/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();

    await page.getByRole('button', { name: /play again/i }).click();
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    for (let i = 0; i < 9; i++) {
      expect((await cellText(page, i)).trim()).toBe('');
    }

    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('AC7.1 PASS: Local two-player X wins top row, play again resets');
  });

  // ---------------------------------------------------------------------------
  // AC7.2 — vs-AI regression: game completes (Draw or O wins, X never wins).
  // ---------------------------------------------------------------------------
  test('AC7.2 — vs-AI regression: game completes in Draw or O wins', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto('/');
    await page.getByRole('button', { name: /vs computer/i }).click();

    await expect(page.getByRole('button', { name: /vs computer/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    await expect(getCells(page)).toHaveCount(9);

    for (let step = 0; step < 20; step++) {
      const xTurn = await page.getByText(/x's turn/i).isVisible().catch(() => false);
      if (!xTurn) break;

      const cells = getCells(page);
      let clicked = false;
      for (let i = 0; i < 9 && !clicked; i++) {
        const txt = ((await cells.nth(i).textContent()) ?? '').trim();
        const disabled = await cells.nth(i).isDisabled();
        if (txt === '' && !disabled) {
          await cells.nth(i).click();
          clicked = true;
          await page.waitForTimeout(350);
        }
      }
      if (!clicked) break;

      const ended = await page.locator('text=/o wins|draw|x wins/i').first().isVisible().catch(() => false);
      if (ended) break;
    }

    const xWins = await page.getByText(/x wins/i).isVisible().catch(() => false);
    expect(xWins, 'X must not win against the unbeatable AI').toBe(false);

    const oWins = await page.getByText(/o wins/i).isVisible().catch(() => false);
    const draw = await page.getByText(/draw/i).isVisible().catch(() => false);
    expect(oWins || draw, 'Game must end in Draw or O wins').toBe(true);

    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();
    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('AC7.2 PASS: vs-AI game completed without regression');
  });
});
