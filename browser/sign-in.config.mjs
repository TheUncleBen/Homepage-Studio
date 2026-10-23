import { defineConfig } from '@playwright/test';

// Studio sign-in qualification. It needs a fresh deployment with sign-in on
// and no accounts yet, because it creates the first administrator.
if (!process.env.STUDIO_BROWSER_ORIGIN) throw new Error('Point STUDIO_BROWSER_ORIGIN at a disposable Studio deployment with sign-in on and no accounts.');
if (process.env.STUDIO_TEST_CONTAINERS !== '1' && process.env.STUDIO_DISPOSABLE_BROWSER_TEST !== '1') throw new Error('Explicitly enable a disposable browser test deployment; this suite creates accounts.');

export default defineConfig({
  testDir: './sign-in',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: 'line',
  outputDir: '.results-sign-in',
  use: {
    baseURL: process.env.STUDIO_BROWSER_ORIGIN,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    trace: 'off',
    ...(process.env.STUDIO_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.STUDIO_CHROMIUM_PATH } } : {}),
  },
});
