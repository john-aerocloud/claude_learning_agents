import { defineConfig, devices } from '@playwright/test';

// Playwright config for Observatory browser specs (CHK-2: chromium only).
// Specs live under e2e/. baseURL is the Vite dev server. The render UCs
// (UC3+) add the actual specs and the webServer wiring that also boots the
// :3001 read layer; UC1 establishes the config + project so the harness exists.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer is added by the render UCs (UC3+) once there is a browser surface
  // to drive end-to-end (boots `npm run dev` on :5173 and the :3001 read layer).
});
