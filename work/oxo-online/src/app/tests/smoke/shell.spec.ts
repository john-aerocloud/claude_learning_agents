import { test, expect } from '@playwright/test';

/**
 * Post-deploy smoke suite — runs against the LIVE production URL only.
 *
 * Requires the PROD_URL env var (e.g. https://d3pf3kcvzpau1x.cloudfront.net).
 * Checks map to acceptance criteria observable from a browser:
 *   - build-sha carrier: meta[name="build-sha"] == DEPLOY_SHA (OI-25, principles/01)
 *   - the HTTPS shell loads (AC-1)
 *   - the page title is set (AC-1 — shell content served)
 *   - the game board is visible — 9 cell buttons rendered (AC-1, slice 002)
 *   - turn indicator shows "X's turn" on fresh load (AC-2, slice 002)
 *   - a client-side deep link resolves to the SPA, not a 404 (AC-4, slice 001)
 */
const PROD_URL = process.env.PROD_URL;
// OI-25: DEPLOY_SHA is set by the pipeline to github.sha. When present, the
// sha-gate test below asserts the served bundle matches the deploy before any
// behavioural tests run. This is the §39-correct CDN propagation check.
const DEPLOY_SHA = process.env.DEPLOY_SHA;

test.describe('oxo-online deployable shell', () => {
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — smoke tests run only against a deployed environment.',
  );

  // OI-25 (principles/01): sha-gate — assert the served bundle is the one we
  // just deployed BEFORE any behavioural assertions. Prevents false-positives
  // from stale CDN edge responses. Skipped in local dev (DEPLOY_SHA absent).
  // Tester can also read this value directly:
  //   meta[name="build-sha"] content attribute on the served HTML.
  test('sha-gate: served build-sha matches deployed commit', async ({ page }) => {
    test.skip(!DEPLOY_SHA, 'DEPLOY_SHA not set — sha gate only runs in pipeline');
    await page.goto('/');
    const servedSha = await page
      .locator('meta[name="build-sha"]')
      .getAttribute('content');
    expect(servedSha, `served build-sha (${servedSha}) must equal deployed sha (${DEPLOY_SHA})`).toBe(DEPLOY_SHA);
  });

  test('home page loads with HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response, 'no response from PROD_URL').not.toBeNull();
    expect(response!.status()).toBe(200);
  });

  test('page title is set and game board renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/oxo-online/i);
    // 9 cell buttons must be present. Cells carry aria-label="cell N" so this
    // selector is stable against mode-selector or other button additions.
    const cells = page.locator('[aria-label^="cell "]');
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
    const cells = page.locator('[aria-label^="cell "]');
    await expect(cells).toHaveCount(9);
  });
});
