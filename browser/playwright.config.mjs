import { defineConfig } from '@playwright/test';

if (!process.env.STUDIO_BROWSER_ORIGIN) throw new Error('Point STUDIO_BROWSER_ORIGIN at a disposable empty Studio test deployment.');
if (process.env.STUDIO_TEST_CONTAINERS !== '1' && process.env.STUDIO_DISPOSABLE_BROWSER_TEST !== '1') throw new Error('Explicitly enable a disposable browser test deployment; this suite edits its dashboard.');

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  globalTimeout: 900000,
  expect: { timeout: 10000 },
  reporter: 'line',
  outputDir: '.results',
  use: {
    baseURL: process.env.STUDIO_BROWSER_ORIGIN,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1080 },
    reducedMotion: 'no-preference',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});
