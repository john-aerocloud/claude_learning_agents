import { test, expect, type Page } from '@playwright/test';

/**
 * s008 §11a PROBE — deep-link boots the SPA on the DEPLOYED origin (UC2, T1/SM-2).
 * Drives a REAL BROWSER (Playwright, NOT a node fetch/ws probe — a node probe runs
 * below CloudFront/CSP/transport and gives a FALSE GREEN) through the full deployed
 * path:
 *   1. Browser A creates a real online game ("Play Online") to MINT a real 6-char
 *      code from the deployed POST /api/games (so the probe uses a genuine code,
 *      not a fabricated one).
 *   2. Browser B navigates to https://<domain>/join/<that-code> — exactly what a
 *      share link does. CloudFront's existing 403/404→200+index.html SPA-fallback
 *      must serve the unknown /join/<code> path as index.html so React Router
 *      resolves it CLIENT-SIDE.
 *   3. Assert the SPA BOOTS (the join screen renders, NOT a CloudFront/S3 edge
 *      error page) with the code PRE-FILLED in the input and the Join button
 *      ENABLED — one click away from joining. No WS/CSP/transport console errors.
 *
 * This is the in-slice end-to-end proof that the deep-link route works against the
 * deployed CloudFront distribution (the one cloud-only fact the local stand-up
 * cannot prove — delta 008 local/prod gap). It does NOT itself complete a join or
 * play a game — that is the tester's UC3 two-browser C4 done-condition smoke (T6).
 *
 * SKELETON-GATED (same posture as move-skeleton/disconnect-skeleton): runs ONLY
 * against a deployed PROD_URL; green-in-prod requires the UC1+UC2 SPA deployed.
 * Run post-deploy by the orchestrator/tester (`make join-skeleton`), NOT in the
 * build-phase suite.
 *
 * Stable selectors only (process v22/v23): game code [data-testid="game-code"],
 * join input #join-code, Join button button.join-submit, mode selector group
 * role "game mode".
 */

const PROD_URL = process.env.PROD_URL;

async function startHostGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /play online/i, exact: false }).click();
  const codeEl = page.locator('[data-testid="game-code"]');
  await expect(codeEl).toBeVisible({ timeout: 5000 });
  const code = (await codeEl.textContent()) ?? '';
  expect(code.length, 'host game code must be 6 chars').toBe(6);
  return code;
}

test.describe('s008 join skeleton — deep-link boots the SPA pre-filled (deployed CloudFront)', () => {
  test.skip(!PROD_URL, 'PROD_URL is not set — the skeleton runs only against a deployed environment.');

  test('T1/SM-2 — fresh-tab /join/<real-code> boots the SPA with the code pre-filled + Join enabled', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    const errors: string[] = [];
    guest.on('console', (m) => { if (m.type() === 'error') errors.push(`guest: ${m.text()}`); });
    guest.on('pageerror', (e) => errors.push(`guest PAGE_ERROR: ${e.message}`));

    try {
      // Mint a REAL code from the deployed create endpoint.
      const code = await startHostGame(host);

      // Fresh tab navigates to the share link — CloudFront SPA-fallback must serve
      // index.html for the unknown /join/<code> path so React Router routes it.
      const resp = await guest.goto(`/join/${code}`);
      // The deep-link must boot the SPA (HTTP 200), NOT a CloudFront/S3 4xx/5xx.
      expect(resp?.status(), 'deep-link must return 200 (SPA fallback), not an edge error').toBe(200);

      // The join screen renders (the SPA booted and React Router resolved /join/:code).
      await expect(guest.locator('section[aria-label="join a game"]')).toBeVisible({ timeout: 8000 });
      // Code pre-filled from the URL, Join enabled — one click away from joining.
      await expect(guest.locator('#join-code')).toHaveValue(code, { timeout: 5000 });
      await expect(guest.locator('button.join-submit')).toBeEnabled();
      // The base mode selector is also present (the game mounted normally).
      await expect(guest.getByRole('group', { name: /game mode/i })).toBeVisible();

      // No WS/CSP/transport console errors booting the deep-linked SPA.
      const transportErrors = errors.filter((e) =>
        /websocket|csp|content.security|connect.src|wss:|failed.to.construct|refused/i.test(e),
      );
      expect(transportErrors, `WS/CSP console errors on deep-link boot: ${errors.join('; ')}`).toHaveLength(0);

      console.log(`s008 join-skeleton PASS: /join/${code} booted the SPA pre-filled (deployed CloudFront fallback).`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
