import { expect, saveFiles, seedServicePanels, test } from '../helpers/dashboard.mjs';

test('startup controls wait for the first board response and the first enabled settings click opens its editor', async ({ page, request }) => {
  await seedServicePanels(request, [{ name: 'Persisted startup fixture', rect: { x: 0, y: 0, w: 4, h: 3 } }]);
  await saveFiles(request, { settingsYaml: 'quicklaunch:\n  mobileButtonPosition: bottom-right\n' });
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseBoard;
  const boardGate = new Promise(resolve => { releaseBoard = resolve; });
  const boardRequested = page.waitForRequest(req => new URL(req.url()).pathname === '/__studio/api/board' && req.method() === 'GET');
  await page.route('**/__studio/api/board', async route => {
    if (route.request().method() === 'GET') await boardGate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await boardRequested;
    const settings = page.getByRole('button', { name: 'Dashboard settings', exact: true });
    await expect(settings).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Quick Launch', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Edit dashboard', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add widget', exact: true })).toBeDisabled();
    const quickLaunch = page.locator('.studio-quicklaunch');
    await expect(quickLaunch).toHaveAttribute('inert', '');
    await expect(quickLaunch.locator(':scope > button')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(quickLaunch.locator('[role="dialog"]')).not.toBeVisible();
    releaseBoard();
    await expect(settings).toBeEnabled();
    await expect(quickLaunch).not.toHaveAttribute('inert', '');
    await settings.click();
    const dialog = page.getByRole('dialog', { name: 'Dashboard settings', exact: true });
    await expect(dialog.getByRole('button', { name: 'Advanced YAML', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('[data-panel-kind="service"][aria-label="Persisted startup fixture"]')).toBeVisible();
  } finally {
    releaseBoard();
    await page.unroute('**/__studio/api/board');
  }
});
