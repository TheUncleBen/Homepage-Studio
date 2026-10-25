import { DASHBOARDS, expect, openSettings, saveFiles, studioApi, test } from '../helpers/dashboard.mjs';

test('restoring changed custom JavaScript applies the restored script when the dashboard next opens', async ({ page, request }) => {
  const restoredScript = "document.documentElement.dataset.studioRestoreFixture = 'restored';\n";
  const currentScript = "document.documentElement.dataset.studioRestoreFixture = 'current';\n";
  const previous = await saveFiles(request, { customJs: restoredScript });
  await saveFiles(request, { customJs: currentScript });
  const backups = await studioApi(request, '/dashboard/studio/api/backups');
  const index = backups.findIndex(backup => backup.revision === previous.revision);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.goto('/dashboard');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.studioRestoreFixture)).toBe('current');
  await (await openSettings(page)).getByRole('button', { name: /Snapshots & restore/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.studio-snapshot')).toHaveCount(backups.length);
  await dialog.locator('.studio-snapshot').nth(index).click();
  await dialog.getByRole('button', { name: 'Restore selected snapshot', exact: true }).click();
  // A restore saves and returns to the Dashboards page.
  await page.waitForURL(`**${DASHBOARDS}`);
  expect((await studioApi(request, '/dashboard/studio/api/state')).customJs).toBe(restoredScript);
  await page.goto('/dashboard');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.studioRestoreFixture)).toBe('restored');
});
