import { test, expect, type Page } from '@playwright/test';

/**
 * s007 SHARED §11a PROBE — two-browser disconnect skeleton (UC1 + UC3). ONE real
 * disconnect through the FULL deployed path in TWO REAL BROWSERS (Playwright,
 * NOT a node ws probe — a node probe runs below CSP/transport and gives a FALSE
 * GREEN). Drives the deployed SPA (create → pair → close one tab) so it exercises
 * the real $disconnect lifecycle event, the real Connections GetItem (UC2 grant),
 * the real conditional abandon write, and the real @connections survivor notify
 * end-to-end.
 *
 * SKELETON-GATED (same posture as move-skeleton): runs ONLY against a deployed
 * PROD_URL. Green-in-prod requires E4 (UC1 handler deployed) + E5 (UC3 SPA
 * deployed). Run post-deploy by UC4/orchestrator (`make disconnect-skeleton`),
 * NOT in the build-phase suite.
 *
 * Assertions (the UC1+UC3 in-slice end-to-end proof, AC4.1/AC4.2):
 *   1. SURVIVOR NOTIFIED: host closes its context; the guest (survivor) shows the
 *      EXACT pinned "Your opponent disconnected." text within 10s (T2) and is
 *      returned to the mode selector WITHOUT a reload (AC3.1/AC3.2).
 *   2. (UC4 augments with DDB Games=abandoned via aws CLI + no-stale-connection
 *      checks — tester-owned; this spec proves the user-visible symptom.)
 *
 * Stable selectors only (process v22/v23): game code [data-testid="game-code"],
 * role [data-testid="online-role"], survivor message [data-testid=
 * "opponent-disconnected"], mode-selector group role "game mode".
 */

const PROD_URL = process.env.PROD_URL;

function cell(page: Page, index: number) {
  return page.locator(`[aria-label="cell ${index}"]`);
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

test.describe('s007 disconnect skeleton — survivor notify through the deployed path', () => {
  test.skip(!PROD_URL, 'PROD_URL is not set — the skeleton runs only against a deployed environment.');

  test('host closes during an active game; survivor sees the message and returns to the mode selector', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    const errors: string[] = [];
    for (const [who, page] of [['host', host], ['guest', guest]] as const) {
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${who} PAGE_ERROR: ${e.message}`));
    }

    try {
      // Pair the two real browsers through the real authorizer + WS relay.
      const code = await startHostGame(host);
      await guestJoin(guest, code);
      await expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', { timeout: 8000 });
      await expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', { timeout: 8000 });

      // Make the game unambiguously ACTIVE: host (X) plays one move that relays
      // to both boards (so the disconnect hits the active-abandon path, not waiting).
      await cell(host, 4).click();
      await expect(cell(guest, 4), 'guest sees host move relayed').toHaveText('X', { timeout: 5000 });

      // The host's context/tab CLOSES — the platform fires $disconnect on the host
      // connection; the deployed handler abandons the game and posts ONE
      // opponent-disconnected frame to the guest survivor.
      await hostCtx.close();

      // 1. SURVIVOR NOTIFIED (AC4.1 / T2): the guest sees the EXACT pinned message
      //    within the 10s smoke window and returns to the mode selector — NO reload.
      await expect(guest.locator('[data-testid="opponent-disconnected"]')).toHaveText(
        'Your opponent disconnected.',
        { timeout: 10000 },
      );
      await expect(guest.getByRole('group', { name: /game mode/i })).toBeVisible({ timeout: 5000 });
      // The board no longer shows the survivor as an active online player.
      await expect(guest.locator('[data-testid="online-role"]')).toHaveCount(0);

      // No WS/CSP console errors on the survivor's browser (transport gate).
      const transportErrors = errors.filter((e) =>
        /websocket|csp|content.security|connect.src|wss:|failed.to.construct/i.test(e),
      );
      expect(transportErrors, `WS/CSP console errors: ${errors.join('; ')}`).toHaveLength(0);
    } finally {
      await hostCtx.close().catch(() => {});
      await guestCtx.close();
    }
  });
});
