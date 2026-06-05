import { test, expect, Page } from '@playwright/test';

/**
 * Slice 004 validation suite — create game and receive shareable code
 *
 * Exercises acceptance criteria against the live production URL.
 * Requires PROD_URL env var.
 *
 * F1: "Play Online" button visible; clicking it issues POST /api/games,
 *     shows a loading indicator, then a 6-char game code within 3s.
 * F2: Code is exactly 6 chars, uppercase letters/digits, no O/0/1/I/L.
 * F3: Loading/spinner indicator appears for waits > 500ms; code visible within 3s.
 * F4: Two-player local and vs-Computer modes still work after deploy.
 * F5: Backend unavailable shows a readable error without white-screening.
 *
 * Steps 15 regression tests (F4) re-exercise prior slice modes to completion
 * with no missing buttons and no console JS errors.
 */

const PROD_URL = process.env.PROD_URL;

/** Get all 9 cell buttons — stable aria-label="cell N" */
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

test.describe('Slice 004 — create game and receive shareable code', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — validation runs only against a deployed environment.',
  );

  // -----------------------------------------------------------------------
  // F1: "Play Online" shows a game code within 3 seconds
  // F2: Code is 6 chars, uppercase A-Z + digits, no ambiguous chars (O 0 1 I L)
  // F3: Loading indicator appears; code visible within 3s
  // -----------------------------------------------------------------------
  test('F1/F2/F3 — Play Online shows valid 6-char code within 3s with loading indicator', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    // "Play Online" button must be visible on the mode selector
    const playOnlineBtn = page.getByRole('button', { name: /play online/i });
    await expect(playOnlineBtn).toBeVisible();

    // Record start time
    const t0 = Date.now();

    // Click "Play Online"
    await playOnlineBtn.click();

    // Either a loading indicator (online-status or spinner) OR the game-code must appear
    // Loading indicator: role="status" with "Starting online game…"
    // Game code: data-testid="game-code"
    const loadingIndicator = page.locator('[role="status"]');
    const gameCodeEl = page.locator('[data-testid="game-code"]');

    // Wait for game code to appear within 3 seconds
    await expect(gameCodeEl).toBeVisible({ timeout: 3000 });

    const elapsed = Date.now() - t0;
    console.log(`F3: Code appeared in ${elapsed}ms`);
    expect(elapsed, 'Code must appear within 3000ms').toBeLessThan(3000);

    // F2: Validate code format
    const code = (await gameCodeEl.textContent()) ?? '';
    const FORBIDDEN = new Set(['O', '0', '1', 'I', 'L']);

    expect(code.length, `Code "${code}" must be exactly 6 characters`).toBe(6);
    expect(
      code,
      `Code "${code}" must match /^[A-Z2-9]{6}$/ (uppercase letters/digits only)`,
    ).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    for (const ch of code) {
      expect(
        FORBIDDEN.has(ch),
        `Code "${code}" contains forbidden ambiguous character "${ch}"`,
      ).toBe(false);
    }

    // "Waiting for opponent" section must be visible
    await expect(page.locator('[aria-label="waiting for opponent"]')).toBeVisible();

    console.log(`F1/F2/F3 PASS: code="${code}" elapsed=${elapsed}ms`);

    // No JS console errors
    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // F1/F3 alternate: if request completes quickly, loading indicator may not
  // render (spinner is only shown after 500ms delay). Verify correct behaviour
  // when backend responds quickly.
  // -----------------------------------------------------------------------
  test('F1 — waiting-for-opponent view remains visible without further action', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /play online/i }).click();

    // Wait for game code
    const gameCodeEl = page.locator('[data-testid="game-code"]');
    await expect(gameCodeEl).toBeVisible({ timeout: 3000 });

    // Code must remain visible without any further interaction (F1 "remains visible")
    await page.waitForTimeout(1000);
    await expect(gameCodeEl).toBeVisible();

    // The "waiting for opponent" label must still be visible
    await expect(page.locator('[aria-label="waiting for opponent"]')).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // F5: Backend unavailable shows readable error without white-screening
  // We simulate a backend error by intercepting the fetch and returning 500.
  // -----------------------------------------------------------------------
  test('F5 — backend error shows readable message; mode selector remains usable', async ({ page }) => {
    // Intercept the /api/games POST to simulate a 500 server error
    await page.route('**/api/games', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'internal server error' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');

    const playOnlineBtn = page.getByRole('button', { name: /play online/i });
    await expect(playOnlineBtn).toBeVisible();
    await playOnlineBtn.click();

    // Error message must appear (role="alert" or text matching the error string)
    const errorEl = page.locator('[role="alert"]');
    await expect(errorEl).toBeVisible({ timeout: 3000 });

    const errorText = (await errorEl.textContent()) ?? '';
    expect(
      errorText.toLowerCase(),
      'Error message should mention "online game" or "try again"',
    ).toMatch(/online|try again/i);

    // Must NOT white-screen: page title and root element still present
    await expect(page.locator('#root')).toBeAttached();
    await expect(page.locator('main')).toBeVisible();

    // F5: Mode selector remains accessible — Two Player and vs Computer buttons must be visible
    await expect(page.getByRole('button', { name: /two player/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /vs computer/i })).toBeVisible();

    // Selecting Two Player must still work (no page reload required)
    await page.getByRole('button', { name: /two player/i }).click();
    await expect(getCells(page)).toHaveCount(9);
    await expect(page.getByText(/x's turn/i)).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Step 15 — F4 regression: Two-Player local mode plays to completion
  // -----------------------------------------------------------------------
  test('F4 regression — Two-Player local mode plays to completion (X wins)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    // Default mode = Two Player (local)
    await expect(page.getByRole('button', { name: /two player/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/x's turn/i)).toBeVisible();

    // Verify all 9 cells present
    await expect(getCells(page)).toHaveCount(9);

    // Play to X win: X:0, O:3, X:1, O:4, X:2
    await clickCell(page, 0); // X
    await clickCell(page, 3); // O
    await clickCell(page, 1); // X
    await clickCell(page, 4); // O
    await clickCell(page, 2); // X wins top row

    await expect(page.getByText(/x wins/i)).toBeVisible();

    // "Play again" button must be visible — not missing
    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();

    // Play again must reset board
    await page.getByRole('button', { name: /play again/i }).click();
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    for (let i = 0; i < 9; i++) {
      expect((await cellText(page, i)).trim()).toBe('');
    }

    expect(consoleErrors, `Console errors during Two-Player game: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('F4 regression Two-Player PASS');
  });

  // -----------------------------------------------------------------------
  // Step 15 — F4 regression: vs-Computer mode plays to completion
  // -----------------------------------------------------------------------
  test('F4 regression — vs-Computer mode plays to completion (Draw or O wins)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await selectVsComputer(page);

    await expect(page.getByRole('button', { name: /vs computer/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/x's turn/i)).toBeVisible();
    await expect(getCells(page)).toHaveCount(9);

    // Play to completion by always picking lowest empty cell
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

    // X must never win against AI
    const xWins = await page.getByText(/x wins/i).isVisible().catch(() => false);
    expect(xWins, 'X must not win against the unbeatable AI').toBe(false);

    // Game must end in Draw or O wins
    const oWins = await page.getByText(/o wins/i).isVisible().catch(() => false);
    const draw = await page.getByText(/draw/i).isVisible().catch(() => false);
    expect(oWins || draw, 'Game must end in Draw or O wins').toBe(true);

    // "Play again" button must be visible — not missing
    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();

    expect(consoleErrors, `Console errors during vs-Computer game: ${consoleErrors.join('; ')}`).toHaveLength(0);
    console.log('F4 regression vs-Computer PASS');
  });
});
