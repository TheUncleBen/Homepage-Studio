import { expect, finishArrangement, openEditor, seedServicePanels, studioApi, test, touchSession } from '../helpers/dashboard.mjs';
import { carousel } from '../helpers/engineering.mjs';

test.describe('empty board touch entry', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('holding unused space on the live dashboard never starts editing; the editor has the widget controls', async ({ page }) => {
    await page.goto('/home');
    const blank = page.locator('.studio-empty');
    await expect(blank).toBeVisible();
    const bounds = await blank.boundingBox();
    const touch = await touchSession(page);
    try {
      await touch.start(bounds.x + 24, bounds.y + 24);
      // Well past the old 420ms hold deadline.
      await page.waitForTimeout(900);
      await touch.end();
    } finally { await touch.detach(); }
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Widgets', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(process.env.STUDIO_BROWSER_ORIGIN + '/home');
    await openEditor(page);
    await page.getByRole('button', { name: 'Widgets', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Find a tile or widget', exact: true })).toBeVisible();
  });
});

test('different-size fit preview cancels safely, then add/reorder/unstack preserves source IDs and standalone dimensions', async ({ page, request }) => {
  const seeded = await seedServicePanels(request, [
    { name: 'First member', rect: { x: 0, y: 0, w: 4, h: 3 } },
    { name: 'Second member', rect: { x: 4, y: 0, w: 5, h: 4 } },
    { name: 'Third member', rect: { x: 0, y: 5, w: 6, h: 5 } },
  ]);
  const sourceBefore = await studioApi(request, '/home/studio/api/state');
  await openEditor(page);
  await page.getByRole('checkbox', { name: 'Select First member', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Second member', exact: true }).check();
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('These panels have different sizes');
  await expect(dialog.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('5');
  await expect(dialog.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('4');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(carousel(page)).toHaveCount(0);
  expect((await studioApi(request, '/home/studio/api/board')).board).toEqual(seeded.board);
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add existing panel', exact: true }).click();
  await dialog.locator('.studio-stack-candidates button').filter({ hasText: 'Third member' }).click();
  await dialog.getByRole('button', { name: 'Move Third member earlier in stack', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move Third member earlier in stack', exact: true }).click();
  await dialog.getByLabel('Start behavior', { exact: true }).selectOption('automatic');
  await dialog.getByLabel('Transition', { exact: true }).selectOption('vertical');
  await dialog.getByLabel('Animation duration (ms)', { exact: true }).fill('400');
  await dialog.getByLabel('Loop after the last widget', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await finishArrangement(page);
  const idByName = Object.fromEntries(seeded.board.panels.map(panel => [panel.title, panel.id]));
  const saved = await studioApi(request, '/home/studio/api/board');
  expect(saved.board.stacks[0].panelIds).toEqual(['Third member', 'First member', 'Second member'].map(name => idByName[name]));
  expect(saved.board.stacks[0].playback).toMatchObject({ mode: 'automatic', transition: 'vertical', transitionDurationMs: 400, loop: false });
  expect((await studioApi(request, '/home/studio/api/state')).servicesYaml).toBe(sourceBefore.servicesYaml);
  await page.goto('/home');
  await expect(carousel(page).getByRole('button', { name: 'Pause slideshow', exact: true })).toBeVisible();
  await carousel(page).getByRole('button', { name: 'Pause slideshow', exact: true }).click();
  await openEditor(page);
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('.studio-member-title strong')).toHaveText(['Third member', 'First member', 'Second member']);
  await dialog.getByRole('button', { name: 'Unstack all', exact: true }).click();
  await finishArrangement(page);
  const unstacked = await studioApi(request, '/home/studio/api/state');
  expect(unstacked.board.stacks).toEqual([]);
  expect(unstacked.servicesYaml).toBe(sourceBefore.servicesYaml);
  for (const panel of seeded.board.panels) expect(unstacked.board.panels.find(item => item.id === panel.id).rect).toMatchObject({ w: panel.rect.w, h: panel.rect.h });
  await page.goto('/home');
  await expect(carousel(page)).toHaveCount(0);
  await expect(page.locator('[data-panel-kind="service"]')).toHaveCount(3);
  for (const title of ['First member', 'Second member', 'Third member']) await expect(page.locator(`[aria-label="${title}"]`).getByRole('link').first()).toHaveAttribute('href', 'https://example.test/');
});
