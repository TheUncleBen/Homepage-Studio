import { expect, HOME, saveFiles, seedServicePanels, test } from '../helpers/dashboard.mjs';

test('startup controls wait for the first board response and the settings page opens its editor once ready', { tag: '@cross-engine' }, async ({ page, request }) => {
  await seedServicePanels(request, [{ name: 'Persisted startup fixture', rect: { x: 0, y: 0, w: 4, h: 3 } }]);
  await saveFiles(request, { settingsYaml: 'quicklaunch:\n  mobileButtonPosition: bottom-right\n' });
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseBoard;
  const boardGate = new Promise(resolve => { releaseBoard = resolve; });
  const boardRequested = page.waitForRequest(req => new URL(req.url()).pathname === '/home/studio/api/board' && req.method() === 'GET');
  await page.route('**/studio/api/board', async route => {
    if (route.request().method() === 'GET') await boardGate;
    await route.continue();
  });
  try {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await boardRequested;
    const search = page.getByRole('button', { name: 'Quick Launch', exact: true });
    await expect(search).toBeDisabled();
    // The live dashboard has no editing or settings controls at all.
    for (const name of ['Dashboard settings', 'Edit dashboard', 'Widgets'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    const quickLaunch = page.locator('.studio-quicklaunch');
    await expect(quickLaunch).toHaveAttribute('inert', '');
    await expect(quickLaunch.locator(':scope > button')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(quickLaunch.locator('[role="dialog"]')).not.toBeVisible();
    releaseBoard();
    await expect(search).toBeEnabled();
    await expect(quickLaunch).not.toHaveAttribute('inert', '');
    await expect(page.locator('[data-panel-kind="service"][aria-label="Persisted startup fixture"]')).toBeVisible();

    // The settings page holds its dialog until the board has answered.
    let releaseAgain;
    const gateAgain = new Promise(resolve => { releaseAgain = resolve; });
    const requestedAgain = page.waitForRequest(req => new URL(req.url()).pathname === `${HOME}/studio/api/board` && req.method() === 'GET');
    await page.unroute('**/studio/api/board');
    await page.route('**/studio/api/board', async route => {
      if (route.request().method() === 'GET') await gateAgain;
      await route.continue();
    });
    await page.goto(`${HOME}/studio/settings`, { waitUntil: 'domcontentloaded' });
    await requestedAgain;
    const dialog = page.getByRole('dialog', { name: 'Dashboard settings', exact: true });
    await expect(dialog).toHaveCount(0);
    releaseAgain();
    await expect(dialog.getByRole('button', { name: 'Advanced YAML', exact: true })).toBeVisible();
  } finally {
    releaseBoard();
    await page.unroute('**/studio/api/board');
  }
});
