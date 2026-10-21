import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Reuse the same real pointer and native-state acceptance scenarios in the
// other browser engines. Chromium runs these in the full default suite.
// CDP touch injection remains explicitly confined to Chromium's mobile gate.
export default defineConfig({
  ...base,
  testMatch: 'native-controls.spec.mjs',
  grep: /(pointer placement and resize persist independently|native search state survives arrangement)/,
  outputDir: '.desktop-results',
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
