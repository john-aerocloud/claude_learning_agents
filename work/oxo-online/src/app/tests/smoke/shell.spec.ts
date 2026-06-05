import { test, expect } from '@playwright/test';

/**
 * Post-deploy smoke suite — runs against the LIVE production URL only.
 *
 * Requires the PROD_URL env var (e.g. https://oxo.example.com). These checks map
 * to the slice-001 acceptance criteria that are observable from a browser:
 *   - the HTTPS shell loads (AC-1)
 *   - the title is "oxo-online" (AC-1 — shell content served)
 *   - the "Play Online" button is visible (shell rendered, router mounted)
 *   - a client-side deep link resolves to the SPA, not a 404 (AC-4)
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

  test('page title contains "oxo-online"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/oxo-online/i);
    await expect(
      page.getByRole('heading', { name: /oxo-online/i, level: 1 }),
    ).toBeVisible();
  });

  test('"Play Online" button is visible', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: /play online/i }),
    ).toBeVisible();
  });

  test('deep-link /game/test loads the SPA, not a 404', async ({ page }) => {
    const response = await page.goto('/game/test');
    // CloudFront rewrites unknown paths to index.html with HTTP 200; the SPA
    // router then resolves the route. We must NOT see a hard 404.
    expect(response, 'no response from deep link').not.toBeNull();
    expect(response!.status()).toBe(200);
    await expect(page.locator('#root')).toBeAttached();
    // The shell falls back to the title screen for unknown client routes.
    await expect(
      page.getByRole('heading', { name: /oxo-online/i, level: 1 }),
    ).toBeVisible();
  });
});
