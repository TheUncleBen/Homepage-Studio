import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Reuse the same real pointer and native-state acceptance scenarios in the
// other browser engines. Chromium runs these in the full default suite.
// CDP touch injection remains explicitly confined to Chromium's mobile gate.
export default defineConfig({
  ...base,
  testMatch: ['native-controls.spec.mjs', 'appearance-import.spec.mjs', 'startup-readiness.spec.mjs', 'native-content-state.spec.mjs', 'stack-picker.spec.mjs', 'dashboards.spec.mjs'],
  grep: /(pointer placement and resize persist independently|native search state survives arrangement|appearance persists, follows device changes|a downloaded dashboard imports only after confirmation|startup controls wait for the first board response|native calendar, chart and process list fit their minima|intentional stack title picker|dashboard management creates independent pages)/,
  outputDir: '.desktop-results',
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
