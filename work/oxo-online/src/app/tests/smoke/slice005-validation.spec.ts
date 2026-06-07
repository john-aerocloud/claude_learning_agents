import { test, expect, Page, Browser } from '@playwright/test';

/**
 * Slice 005 smoke suite — join-game (live two-browser WebSocket pairing)
 *
 * Exercises acceptance criteria against the live production URL.
 * Requires PROD_URL env var.
 *
 * F1/T1: Both players reach the board with correct role labels within 3s of
 *         the joiner submitting the code; game-ready arrives via real wss.
 * F2:    DynamoDB Games record is active with both connectionIds populated
 *         (verified by the AWS-policy spec; smoke confirms the UI reached board).
 * F3/T4: Unknown code shows "Game not found…"; join screen remains; code retained.
 * F4/T5: Already-active game shows "This game is no longer available."; no hijack.
 * F6:    Host waiting screen shows "Connecting…" indicator while WS establishes.
 * F7:    Board squares are inert; clicking does nothing; status line persists.
 * F8/S5: Regression — two-player local and vs-AI complete without breakage.
 * F9/S3: Simulated backend error shows readable message; no white-screen.
 *
 * Stable selectors (§23):
 *   aria-label="join a game"  — join-screen section wrapper
 *   data-testid="online-role" — role label ("You are X" / "You are O")
 *   data-testid="game-code"   — host's shareable code
 *   data-testid="host-connecting" — host WS connecting indicator
 *   data-testid="join-connecting" — joiner WS connecting indicator
 *   aria-label="cell N"       — board cells
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

async function selectVsComputer(page: Page) {
  await page.getByRole('button', { name: /vs computer/i }).click();
}

/** Navigate to the host waiting screen and return the game code. */
async function startHostGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const gameCodeEl = page.locator('[data-testid="game-code"]');
  await expect(gameCodeEl).toBeVisible({ timeout: 3000 });
  const code = (await gameCodeEl.textContent()) ?? '';
  expect(code.length).toBe(6);
  return code;
}

/** Navigate to the join screen on a page. */
async function openJoinScreen(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /join a game/i, exact: false }).click();
  await expect(page.locator('section[aria-label="join a game"]')).toBeVisible({
    timeout: 2000,
  });
}

/** Submit a code on the join screen. */
async function submitJoinCode(page: Page, code: string): Promise<void> {
  const input = page.locator('#join-code');
  await input.fill(code);
  await page.locator('button.join-submit').click();
}

test.describe('Slice 005 — join game by code (live WebSocket)', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — validation runs only against a deployed environment.',
  );

  // -------------------------------------------------------------------------
  // F1/T1 — Live two-browser pairing: both players reach the board with correct
  // role labels within 3s; game-ready delivered via real wss.
  // -------------------------------------------------------------------------
  test('F1/T1 — two-context pairing: host gets X, guest gets O within 3s', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const hostErrors: string[] = [];
    const guestErrors: string[] = [];
    hostPage.on('console', (msg) => {
      if (msg.type() === 'error') hostErrors.push(msg.text());
    });
    guestPage.on('console', (msg) => {
      if (msg.type() === 'error') guestErrors.push(msg.text());
    });

    try {
      // Host creates a game and reaches the waiting screen.
      const code = await startHostGame(hostPage);
      console.log(`F1: Host code = ${code}`);

      // Host waiting screen shows the connecting indicator.
      const hostConnecting = hostPage.locator('[data-testid="host-connecting"]');
      await expect(hostConnecting).toBeVisible({ timeout: 2000 });

      // Guest opens the join screen.
      await openJoinScreen(guestPage);

      // Record time before guest submits the code.
      const t0 = Date.now();

      // Guest submits the valid code.
      await submitJoinCode(guestPage, code);

      // Guest board must appear within 3s.
      const guestRole = guestPage.locator('[data-testid="online-role"]');
      await expect(guestRole).toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });

      const elapsed = Date.now() - t0;
      console.log(`F1: Guest board appeared in ${elapsed}ms`);
      expect(elapsed, 'Both boards must appear within 3000ms').toBeLessThan(
        WS_JOIN_TIMEOUT_MS,
      );

      // Guest must be O.
      const guestRoleText = await guestRole.textContent();
      expect(guestRoleText?.trim()).toBe('You are O');

      // Host board must also appear within the 3s window.
      const hostRole = hostPage.locator('[data-testid="online-role"]');
      await expect(hostRole).toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });
      const hostRoleText = await hostRole.textContent();
      expect(hostRoleText?.trim()).toBe('You are X');

      // §23 surface migration (s006): with UC4 live the inert status line is
      // replaced by the server-authoritative turn indicator — pairing
      // completeness is confirmed by the turn indicator on both boards.
      await expect(
        hostPage.locator('[data-testid="online-turn"]'),
      ).toBeVisible({ timeout: 2000 });
      await expect(
        guestPage.locator('[data-testid="online-turn"]'),
      ).toBeVisible({ timeout: 2000 });

      console.log(`F1/T1 PASS: host=X guest=O elapsed=${elapsed}ms`);

      expect(
        hostErrors,
        `Host console errors: ${hostErrors.join('; ')}`,
      ).toHaveLength(0);
      expect(
        guestErrors,
        `Guest console errors: ${guestErrors.join('; ')}`,
      ).toHaveLength(0);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  // -------------------------------------------------------------------------
  // F6 — Host waiting screen shows "Connecting…" indicator while WS establishes.
  // -------------------------------------------------------------------------
  test('F6 — host waiting screen shows connecting indicator; code remains visible', async ({ page }) => {
    const code = await startHostGame(page);
    expect(code.length, 'game code must be 6 chars').toBe(6);

    // The connecting indicator and the code must both be visible.
    await expect(
      page.locator('[data-testid="host-connecting"]'),
    ).toBeVisible({ timeout: 2000 });
    await expect(
      page.locator('[data-testid="game-code"]'),
    ).toHaveText(code);

    console.log(`F6 PASS: connecting indicator visible, code="${code}"`);
  });

  // -------------------------------------------------------------------------
  // F7 — Board squares inert; clicking does nothing; status line persists.
  // Uses a two-context pair (F1 must succeed first to reach the board).
  // -------------------------------------------------------------------------
  // §23 SURFACE-CHANGE MIGRATION (s006/R4.5): the online board is no longer
  // permanently inert. With UC4 live (uc4Enabled ON), the board is
  // SERVER-AUTHORITATIVE: it stays empty until a server `board-update`, the
  // player-to-move's empty cells are actionable, and an accepted move renders on
  // BOTH browsers from the broadcast (never optimistically). The s005 "all cells
  // permanently disabled" assertion is RETIRED here — it described the dark
  // flag-OFF state that no longer ships. The full F/T/S move suite is UC6
  // (tester); this smoke pins the surface invariant: empty-on-pair, then the
  // host's move relays to both.
  test('F7 (s006-migrated) — board empty on pair; host move relays to both browsers', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const hostConsoleMsgs: string[] = [];
    hostPage.on('console', (msg) => {
      if (msg.type() === 'error') hostConsoleMsgs.push(msg.text());
    });

    try {
      const code = await startHostGame(hostPage);
      await openJoinScreen(guestPage);
      await submitJoinCode(guestPage, code);

      // Wait for both boards (game-ready fires once both are bound).
      await expect(
        guestPage.locator('[data-testid="online-role"]'),
      ).toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });
      await expect(
        hostPage.locator('[data-testid="online-role"]'),
      ).toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });

      const hostCells = getCells(hostPage);
      await expect(hostCells).toHaveCount(9);

      // Empty on pair — no X/O placed before any move (no optimistic render).
      for (let i = 0; i < 9; i++) {
        expect((await cellText(hostPage, i)).trim(), `Cell ${i} empty on pair`).toBe('');
      }

      // Server-authoritative relay: the host (X, to move) plays square 4; it must
      // render on BOTH browsers from the server broadcast (NOT just locally).
      await hostCells.nth(4).click();
      await expect(getCells(hostPage).nth(4), 'host sees own move via broadcast').toHaveText('X', {
        timeout: WS_JOIN_TIMEOUT_MS,
      });
      await expect(getCells(guestPage).nth(4), 'guest sees host move relayed').toHaveText('X', {
        timeout: WS_JOIN_TIMEOUT_MS,
      });

      expect(
        hostConsoleMsgs,
        `Console errors during move relay: ${hostConsoleMsgs.join('; ')}`,
      ).toHaveLength(0);

      console.log('F7 (s006-migrated) PASS: empty-on-pair, host move relayed to both');
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  // -------------------------------------------------------------------------
  // F3/T4 — Unknown code shows "Game not found…"; join screen remains; code retained.
  // -------------------------------------------------------------------------
  test('F3/T4 — unknown code: error message shown; join screen remains; code retained', async ({ page }) => {
    await openJoinScreen(page);

    const FAKE_CODE = 'XXXXXX';
    await submitJoinCode(page, FAKE_CODE);

    // The connecting indicator appears briefly, then the error must render.
    const errorEl = page.locator('.join-error[role="alert"]');
    await expect(errorEl).toBeVisible({ timeout: 5000 });

    const errorText = await errorEl.textContent();
    expect(
      errorText?.trim(),
      'Unknown code error message must match F3 spec',
    ).toBe('Game not found. Check the code and try again.');

    // Join screen section must still be present (not replaced by something else).
    await expect(
      page.locator('section[aria-label="join a game"]'),
    ).toBeVisible();

    // The code input must retain the entered value (F3).
    const inputValue = await page.locator('#join-code').inputValue();
    expect(inputValue, 'Input must retain entered code for retry').toBe(FAKE_CODE);

    // No board or online-role element should have appeared.
    await expect(page.locator('[data-testid="online-role"]')).not.toBeVisible();

    console.log('F3/T4 PASS: error shown, join screen usable, code retained');
  });

  // -------------------------------------------------------------------------
  // F4/T5 — Already-active game: "This game is no longer available.";
  //         no hijack of the guestConnectionId.
  // Uses a three-context sequence: create game, first joiner, second joiner.
  // -------------------------------------------------------------------------
  test('F4/T5 — already-active game: second joiner rejected with correct message', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guest1Context = await browser.newContext();
    const guest2Context = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guest1Page = await guest1Context.newPage();
    const guest2Page = await guest2Context.newPage();

    try {
      // Set up a paired game (host + guest1).
      const code = await startHostGame(hostPage);
      await openJoinScreen(guest1Page);
      await submitJoinCode(guest1Page, code);

      // Wait for guest1 to reach the board (game is now active).
      await expect(
        guest1Page.locator('[data-testid="online-role"]'),
      ).toBeVisible({ timeout: WS_JOIN_TIMEOUT_MS });

      // guest2 now tries to join the same active game.
      await openJoinScreen(guest2Page);
      await submitJoinCode(guest2Page, code);

      // guest2 must see the "no longer available" error.
      const errorEl = guest2Page.locator('.join-error[role="alert"]');
      await expect(errorEl).toBeVisible({ timeout: 5000 });

      const errorText = await errorEl.textContent();
      expect(
        errorText?.trim(),
        'Active-game error message must match F4 spec',
      ).toBe('This game is no longer available.');

      // Join screen must remain accessible for guest2 (no white-screen).
      await expect(
        guest2Page.locator('section[aria-label="join a game"]'),
      ).toBeVisible();

      // guest2 must NOT have reached the board.
      await expect(
        guest2Page.locator('[data-testid="online-role"]'),
      ).not.toBeVisible();

      // guest1 (the legitimate joiner) must still see their board unchanged.
      await expect(
        guest1Page.locator('[data-testid="online-role"]'),
      ).toBeVisible();

      console.log('F4/T5 PASS: second joiner rejected; first joiner board intact');
    } finally {
      await hostContext.close();
      await guest1Context.close();
      await guest2Context.close();
    }
  });

  // -------------------------------------------------------------------------
  // F9/S3 — Simulated backend error on join: readable error, no white-screen.
  // We intercept the WS connection open by making the wsUrl invalid in the config.
  // In practice, the SPA gracefully degrades when wsUrl is missing; we simulate
  // that by intercepting the config.js so the wsUrl is absent.
  // -------------------------------------------------------------------------
  test('F9/S3 — WS config absent: generic error shown; no white-screen', async ({ page }) => {
    // Intercept config.js to strip the wsUrl — simulates F9 degraded-config path.
    await page.route('**/config.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.OXO_CONFIG = {};',
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /join a game/i, exact: false }).click();

    // The join screen appears.
    await expect(
      page.locator('section[aria-label="join a game"]'),
    ).toBeVisible({ timeout: 2000 });

    // Submit any code — the socket factory will immediately fire onClose(4500).
    await submitJoinCode(page, 'ABCDEF');

    // Generic error message must appear.
    const errorEl = page.locator('.join-error[role="alert"]');
    await expect(errorEl).toBeVisible({ timeout: 3000 });

    const errorText = await errorEl.textContent();
    // The generic message is one of the three defined messages (4500 -> "Something went wrong…").
    expect(errorText?.trim()).toMatch(/something went wrong|try again|not found|no longer available/i);

    // Page must NOT white-screen: root element and join section still present.
    await expect(page.locator('#root')).toBeAttached();
    await expect(
      page.locator('section[aria-label="join a game"]'),
    ).toBeVisible();

    // No board should have appeared.
    await expect(page.locator('[data-testid="online-role"]')).not.toBeVisible();

    console.log(`F9/S3 PASS: error="${errorText?.trim()}" — no white-screen`);
  });

  // -------------------------------------------------------------------------
  // F8/S5 regression — Two-Player local mode plays to completion (X wins).
  // Mirrors the s004 regression test; must pass unchanged.
  // -------------------------------------------------------------------------
  test('F8 regression — Two-Player local mode plays to completion (X wins)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    await expect(
      page.getByRole('button', { name: /two player/i }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    await expect(getCells(page)).toHaveCount(9);

    // X:0, O:3, X:1, O:4, X:2 — X wins top row.
    await clickCell(page, 0);
    await clickCell(page, 3);
    await clickCell(page, 1);
    await clickCell(page, 4);
    await clickCell(page, 2);

    await expect(page.getByText(/x wins/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /play again/i }),
    ).toBeVisible();

    // Play again resets.
    await page.getByRole('button', { name: /play again/i }).click();
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    for (let i = 0; i < 9; i++) {
      expect((await cellText(page, i)).trim()).toBe('');
    }

    expect(
      consoleErrors,
      `Console errors: ${consoleErrors.join('; ')}`,
    ).toHaveLength(0);
    console.log('F8 regression Two-Player PASS');
  });

  // -------------------------------------------------------------------------
  // F8/S5 regression — vs-Computer mode plays to completion (Draw or O wins).
  // -------------------------------------------------------------------------
  test('F8 regression — vs-Computer mode plays to completion (Draw or O wins)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await selectVsComputer(page);

    await expect(
      page.getByRole('button', { name: /vs computer/i }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    await expect(getCells(page)).toHaveCount(9);

    for (let step = 0; step < 20; step++) {
      const xTurn = await page
        .getByText(/x's turn/i)
        .isVisible()
        .catch(() => false);
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

      const ended = await page
        .locator('text=/o wins|draw|x wins/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (ended) break;
    }

    const xWins = await page
      .getByText(/x wins/i)
      .isVisible()
      .catch(() => false);
    expect(xWins, 'X must not win against the unbeatable AI').toBe(false);

    const oWins = await page
      .getByText(/o wins/i)
      .isVisible()
      .catch(() => false);
    const draw = await page
      .getByText(/draw/i)
      .isVisible()
      .catch(() => false);
    expect(oWins || draw, 'Game must end in Draw or O wins').toBe(true);

    await expect(
      page.getByRole('button', { name: /play again/i }),
    ).toBeVisible();

    expect(
      consoleErrors,
      `Console errors: ${consoleErrors.join('; ')}`,
    ).toHaveLength(0);
    console.log('F8 regression vs-Computer PASS');
  });
});
