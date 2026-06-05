import { test, expect } from '@playwright/test';

/**
 * Post-deploy smoke suite — runs against the LIVE production URL only.
 *
 * Requires the PROD_URL env var (e.g. https://d3pf3kcvzpau1x.cloudfront.net).
 * Checks map to acceptance criteria observable from a browser:
 *   - the HTTPS shell loads (AC-1)
 *   - the page title is set (AC-1 — shell content served)
 *   - the game board is visible — 9 cell buttons rendered (AC-1, slice 002)
 *   - turn indicator shows "X's turn" on fresh load (AC-2, slice 002)
 *   - a client-side deep link resolves to the SPA, not a 404 (AC-4, slice 001)
 */
const PROD_URL = process.env.PROD_URL;

test.describe('oxo-online deployable shell', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — smoke tests run only against a deployed environment.',
  );

  test('home page loads with HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response, 'no response from PROD_URL').not.toBeNull();
    expect(response!.status()).toBe(200);
  });

  test('page title is set and game board renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/oxo-online/i);
    // Slice 002: root renders the game — 9 cell buttons must be present.
    const cells = page.getByRole('button').filter({ hasNotText: /play again/i });
    await expect(cells).toHaveCount(9);
  });

  test('turn indicator shows "X\'s turn" on fresh load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/x's turn/i)).toBeVisible();
  });

  test('deep-link /game/test loads the SPA, not a 404', async ({ page }) => {
    const response = await page.goto('/game/test');
    // CloudFront rewrites unknown paths to index.html with HTTP 200; the SPA
    // router then resolves the route client-side. Must NOT see a hard 404.
    expect(response, 'no response from deep link').not.toBeNull();
    expect(response!.status()).toBe(200);
    await expect(page.locator('#root')).toBeAttached();
    // Unknown routes fall back to the game at / — board must be present.
    const cells = page.getByRole('button').filter({ hasNotText: /play again/i });
    await expect(cells).toHaveCount(9);
  });
});
