import { test, expect, type Page } from '@playwright/test';

/**
 * s009 UC4 — manual-entry join regression (DEFECT-S008-002 / AC4.5 / D5).
 *
 * @covers spa-copy-controls (class-deps)
 *
 * Driven against the LOCAL stand-up (real browser) with the s009 flags ON via
 * the local /config.js. The two copy controls' CONTENT (code vs /join/:code URL)
 * + "Copied!" feedback are pinned exhaustively by the GameRoot vitest component
 * tests with a stubbed clipboard. The local browser server READIES the host
 * immediately on register (host=X, no wait for a guest — see local/server.ts),
 * so the waiting screen is transient there; the durable browser-meaningful UC4
 * assertion is that the guest's manual type-the-code join path still completes
 * end-to-end after the waiting-screen surface change (the regression the defect
 * fix must not break).
 */

const STABLE = {
  playOnline: /play online/i,
  joinGame: /join a game/i,
};

/** Reach the HOST board (first connection — readies immediately) and game code. */
async function openHost(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: STABLE.playOnline }).click();
  await expect(page.getByTestId('online-role')).toHaveText('You are X', {
    timeout: 10_000,
  });
}

test.describe('UC4 local stand-up — manual-entry join regression (real browser)', () => {
  // D5 / AC4.5 — the manual type-the-code join path still completes end-to-end
  // after splitting the single copy-link into copy-code + copy-link.
  test('D5 — manual-entry join still completes (regression)', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await openHost(host);
      // Guest opens the app and TYPES the code into the join field (the path the
      // "Copy code" control serves). The local server binds by connection order,
      // so the entered code value is irrelevant locally — the TYPE FLOW is what
      // this regression exercises.
      await guest.goto('/');
      await guest.getByRole('button', { name: STABLE.joinGame }).click();
      await guest.locator('#join-code').fill('LOCAL1');
      await guest.locator('button.join-submit').click();
      await expect(guest.getByTestId('online-role')).toHaveText('You are O', {
        timeout: 10_000,
      });
      await expect(host.getByTestId('online-role')).toHaveText('You are X', {
        timeout: 10_000,
      });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
