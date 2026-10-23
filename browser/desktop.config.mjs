import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Reuse the same real pointer and native-state acceptance scenarios in the
// other browser engines. Chromium runs these in the full default suite.
// CDP touch injection remains explicitly confined to Chromium's mobile gate.
// Scenarios opt in with the `@cross-engine` tag, so renaming a test keeps it
// selected; test/cross-engine-selection.test.mjs guards the exact selection.
export default defineConfig({
  ...base,
  testMatch: ['native-controls.spec.mjs', 'appearance-import.spec.mjs', 'startup-readiness.spec.mjs', 'native-content-state.spec.mjs', 'stack-picker.spec.mjs', 'dashboards.spec.mjs'],
  grep: /@cross-engine\b/,
  outputDir: '.desktop-results',
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
