import { expect, saveFiles, studioApi, test } from '../helpers/dashboard.mjs';

test('restoring changed custom JavaScript offers reload and applies the restored script only after reload', async ({ page, request }) => {
  const restoredScript = "document.documentElement.dataset.studioRestoreFixture = 'restored';\n";
  const currentScript = "document.documentElement.dataset.studioRestoreFixture = 'current';\n";
  const previous = await saveFiles(request, { customJs: restoredScript });
  await saveFiles(request, { customJs: currentScript });
  const backups = await studioApi(request, '/__studio/api/backups');
  const index = backups.findIndex(backup => backup.revision === previous.revision);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.studioRestoreFixture)).toBe('current');
  await page.getByRole('button', { name: 'Dashboard settings', exact: true }).click();
  await page.getByRole('button', { name: /Snapshots & restore/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.studio-snapshot')).toHaveCount(backups.length);
  await dialog.locator('.studio-snapshot').nth(index).click();
  await dialog.getByRole('button', { name: 'Restore selected snapshot', exact: true }).click();
  await expect(page.locator('.studio-status-message')).toContainText('Changes saved. Reload once to apply custom JavaScript.');
  expect((await studioApi(request, '/__studio/api/state')).customJs).toBe(restoredScript);
  expect(await page.evaluate(() => document.documentElement.dataset.studioRestoreFixture)).toBe('current');
  await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.studioRestoreFixture)).toBe('restored');
});
