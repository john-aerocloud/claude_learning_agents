import { test, expect, type Page } from '@playwright/test';

/**
 * s007 SHARED §11a PROBE — two-browser disconnect skeleton (UC1 + UC3). TWO
 * real disconnect directions through the FULL deployed path in TWO REAL BROWSERS
 * (Playwright, NOT a node ws probe — a node probe runs below CSP/transport and
 * gives a FALSE GREEN). Drives the deployed SPA (create → pair → close one tab)
 * so it exercises the real $disconnect lifecycle event, the real Connections
 * GetItem (UC2 grant), the real conditional abandon write, and the real
 * @connections survivor notify end-to-end.
 *
 * SKELETON-GATED (same posture as move-skeleton): runs ONLY against a deployed
 * PROD_URL. Green-in-prod requires E4 (UC1 handler deployed) + E5 (UC3 SPA
 * deployed). Run post-deploy by UC4/orchestrator (`make disconnect-skeleton`),
 * NOT in the build-phase suite.
 *
 * Assertions (the UC1+UC3 in-slice end-to-end proof, AC4.1/AC4.1B):
 *   1. HOST-CLOSES direction (AC4.1): host closes its context; the GUEST
 *      (survivor) shows the EXACT pinned "Your opponent disconnected." text
 *      within 10s (T2) and is returned to the mode selector WITHOUT a reload.
 *   2. GUEST-CLOSES direction (AC4.1B): guest closes its context; the HOST
 *      (survivor) shows the exact same message within 10s and returns to the
 *      mode selector. This direction exercises the S007-RENDER-FIX spaJoinScreen
 *      forward edge (class-deps.mmd) — a spec that FAILS if JoinScreen does not
 *      forward opponent-disconnected frames to GameRoot.
 *   3. (UC4 augments with DDB Games=abandoned via aws CLI + no-stale-connection
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

test.describe('s007 disconnect skeleton — survivor notify through the deployed path (BOTH directions)', () => {
  test.skip(!PROD_URL, 'PROD_URL is not set — the skeleton runs only against a deployed environment.');

  // AC4.1 — HOST-closes direction: guest is the survivor.
  // This is the primary skeleton test. Exercises: UC1 handler (GetItem Connections,
  // conditional abandon, relay post), UC3 SPA (opponent-disconnected handler in
  // GameRoot — guest's socket is owned by JoinScreen, S007-RENDER-FIX path).
  test('AC4.1 — host closes during active game; GUEST (survivor) sees message + mode selector [HOST-closes]', async ({
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

  // AC4.1B — GUEST-closes direction: HOST is the survivor.
  // Specifically validates the S007-RENDER-FIX: the spaJoinScreen forward edge
  // that routes opponent-disconnected from JoinScreen's socket to GameRoot's handler.
  // If this FAILS with a 10s timeout on the survivor message, it means the
  // JoinScreen is NOT forwarding the frame (the original defect before 1501ac9).
  // The host's socket is owned directly by GameRoot, so the HOST-closes direction
  // does NOT exercise this forward edge — only this test does.
  test('AC4.1B — guest closes during active game; HOST (survivor) sees message + mode selector [GUEST-closes, S007-RENDER-FIX]', async ({
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
      // Pair the two real browsers.
      const code = await startHostGame(host);
      await guestJoin(guest, code);
      await expect(guest.locator('[data-testid="online-role"]')).toHaveText('You are O', { timeout: 8000 });
      await expect(host.locator('[data-testid="online-role"]')).toHaveText('You are X', { timeout: 8000 });

      // One move to make the game unambiguously ACTIVE.
      await cell(host, 5).click();
      await expect(cell(guest, 5), 'guest sees host move relayed').toHaveText('X', { timeout: 5000 });

      // The GUEST's context/tab closes — platform fires $disconnect on the GUEST's
      // connection. The handler abandons the game and posts ONE opponent-disconnected
      // frame to the HOST (the survivor).
      await guestCtx.close();

      // HOST (survivor) must see the EXACT pinned message within 10s and return to
      // mode selector WITHOUT a reload. The host's socket is managed by GameRoot
      // directly — no forwarding edge needed on the host side.
      await expect(host.locator('[data-testid="opponent-disconnected"]')).toHaveText(
        'Your opponent disconnected.',
        { timeout: 10000 },
      );
      await expect(host.getByRole('group', { name: /game mode/i })).toBeVisible({ timeout: 5000 });
      await expect(host.locator('[data-testid="online-role"]')).toHaveCount(0);

      // No WS/CSP console errors on the survivor's browser.
      const transportErrors = errors.filter((e) =>
        /websocket|csp|content.security|connect.src|wss:|failed.to.construct/i.test(e),
      );
      expect(transportErrors, `WS/CSP console errors (guest-closes): ${errors.join('; ')}`).toHaveLength(0);

      console.log('AC4.1B PASS: guest-closes direction (S007-RENDER-FIX validated) — host survivor sees message');
    } finally {
      await hostCtx.close();
      await guestCtx.close().catch(() => {});
    }
  });
});
