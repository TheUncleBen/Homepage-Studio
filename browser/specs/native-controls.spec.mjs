import {
  addBookmark, addInformation, chooseContent, expect, finishArrangement,
  mouseDrag, origin, panelPixels, seedServicePanels, setPanelSize,
  studioApi, test, touchSession,
} from '../helpers/dashboard.mjs';

const carousel = page => page.locator('[aria-roledescription="carousel"]');
const activePanel = page => page.locator('[data-stack-id]:not([aria-hidden="true"])');
const servicePanel = (page, title) => page.locator(`[data-panel-kind="service"][aria-label="${title}"]`);

test('pointer placement and resize persist independently; Escape cancels an active drag', async ({ page, request }) => {
  await seedServicePanels(request, [
    { name: 'Pointer tile', rect: { x: 0, y: 0, w: 4, h: 3 } },
    { name: 'Unchanged tile', rect: { x: 8, y: 4, w: 4, h: 3 } },
  ]);
  await page.goto('/');
  const tile = servicePanel(page, 'Pointer tile');
  const other = servicePanel(page, 'Unchanged tile');
  await expect(tile).toBeVisible();
  const otherBefore = await panelPixels(other);
  const column = await page.locator('.studio-canvas').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--studio-grid-column')));
  const row = await page.locator('.studio-canvas').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--studio-grid-row')));
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await mouseDrag(page, page.getByRole('button', { name: /^Move Pointer tile\. Use arrow keys/ }), column * 2, row);
  await expect.poll(async () => (await panelPixels(tile)).top).toBeGreaterThan(row * 0.9);
  const moved = await panelPixels(tile);
  await mouseDrag(page, page.getByRole('button', { name: 'Resize Pointer tile. Use arrow keys.', exact: true }), column * 2, row);
  await expect.poll(async () => (await panelPixels(tile)).width).toBeGreaterThan(moved.width + column * 1.5);
  const resized = await panelPixels(tile);
  await mouseDrag(page, page.getByRole('button', { name: /^Move Pointer tile\. Use arrow keys/ }), -column, row, async () => {
    await expect.poll(async () => (await panelPixels(tile)).top).toBeGreaterThan(resized.top + row * 0.9);
    await page.keyboard.press('Escape');
  });
  await expect.poll(() => panelPixels(tile)).toEqual(resized);
  expect(await panelPixels(other)).toEqual(otherBefore);
  await finishArrangement(page);
  const saved = await studioApi(request, '/__studio/api/board');
  expect(saved.board.panels.find(panel => panel.title === 'Pointer tile').rect).toEqual({ x: 2, y: 1, w: 6, h: 4 });
  expect(saved.board.panels.find(panel => panel.title === 'Unchanged tile').rect).toEqual({ x: 8, y: 4, w: 4, h: 3 });
  await page.reload();
  await expect.poll(() => panelPixels(tile)).toEqual(resized);
});

test.describe('touch direct manipulation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('vertical scrolling remains available, then the same held finger moves and deliberately stacks a panel', async ({ page, request }) => {
    await seedServicePanels(request, [
      { name: 'Touch source', rect: { x: 0, y: 0, w: 4, h: 3 } },
      { name: 'Touch target', rect: { x: 0, y: 3, w: 4, h: 3 } },
      { name: 'Scroll fixture', rect: { x: 0, y: 8, w: 4, h: 3 } },
    ]);
    await page.goto('/');
    const source = servicePanel(page, 'Touch source');
    const target = servicePanel(page, 'Touch target');
    await expect(source).toBeVisible();
    const touch = await touchSession(page);
    const headerPoint = async () => {
      await source.locator('.studio-panel-header').scrollIntoViewIfNeeded();
      const bounds = await source.locator('.studio-panel-header').boundingBox();
      return { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
    };
    try {
      let point = await headerPoint();
      const scrollBefore = await page.evaluate(() => scrollY);
      await touch.start(point.x, point.y);
      await touch.move(point, { x: point.x, y: point.y - 100 });
      await touch.end();
      await expect(page.getByRole('button', { name: 'Edit dashboard', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore + 20);

      point = await headerPoint();
      const before = await panelPixels(source);
      await touch.start(point.x, point.y);
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
      await touch.move(point, { x: point.x, y: point.y + 100 });
      await touch.end();
      await expect.poll(async () => (await panelPixels(source)).top).toBeGreaterThan(before.top + 50);
      // Cancel the whole arrangement before the independent direct-stack gesture.
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect.poll(() => panelPixels(source)).toEqual(before);

      point = await headerPoint();
      await touch.start(point.x, point.y);
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
      const targetBounds = await target.boundingBox();
      await touch.move(point, { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + 70 });
      await expect(page.getByText('Release to stack', { exact: true })).toBeVisible();
      await touch.end();
      await expect(carousel(page)).toHaveCount(1);
      await finishArrangement(page);
      const saved = await studioApi(request, '/__studio/api/board');
      expect(saved.board.stacks).toHaveLength(1);
      expect(saved.board.stacks[0].panelIds).toHaveLength(2);
      expect(saved.board.panels).toHaveLength(3);
    } finally { await touch.detach(); }
  });
});

test('native search state survives arrangement and moving out; bookmark and layout survive reload', async ({ page, request }) => {
  await page.goto('/');
  const bookmark = await addBookmark(page);
  await expect(bookmark.getByRole('link').first()).toHaveAttribute('href', 'https://example.test/reference');
  await addInformation(page, 'Search', 'provider: duckduckgo\nshowSearchSuggestions: false\nfocus: false\n');
  const search = page.locator('[data-panel-kind="informationWidget"][aria-label="search"]');
  const input = search.getByRole('combobox', { includeHidden: true });
  await input.fill('Native search state retained');
  const originalInput = await input.elementHandle();
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await setPanelSize(page, 'search', 5, 3);
  await setPanelSize(page, 'Browser bookmark', 5, 3);
  await page.getByRole('checkbox', { name: 'Select search', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Browser bookmark', exact: true }).check();
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  await finishArrangement(page);
  const searchId = await search.getAttribute('data-panel-id');
  if (await activePanel(page).getAttribute('data-panel-id') !== searchId)
    await carousel(page).press('ArrowRight');
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', searchId);
  await expect(input).toHaveValue('Native search state retained');
  expect(await input.evaluate((node, original) => node === original, originalInput)).toBe(true);
  await carousel(page).press('ArrowRight');
  await expect(search).toHaveAttribute('inert', '');
  await carousel(page).press('ArrowLeft');
  await expect(input).toHaveValue('Native search state retained');
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.studio-stack-member').filter({ hasText: 'Browser bookmark' }).getByRole('button', { name: 'Move out', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await expect(carousel(page)).toHaveCount(0);
  await expect(input).toHaveValue('Native search state retained');
  expect(await input.evaluate((node, original) => node === original, originalInput)).toBe(true);
  await finishArrangement(page);
  const beforeReload = await studioApi(request, '/__studio/api/board');
  await page.reload();
  await expect(search.getByRole('combobox')).toBeVisible();
  await expect(bookmark.getByRole('link').first()).toHaveAttribute('href', 'https://example.test/reference');
  expect((await studioApi(request, '/__studio/api/board')).board).toEqual(beforeReload.board);
  // The native search query is transient; only config/layout must survive reload.
});

test('an edited manual navigation delay survives save/reload and sets the next automatic advance', async ({ page, request }) => {
  const seeded = await seedServicePanels(request, [
    { name: 'Delay one', rect: { x: 0, y: 0, w: 4, h: 3 } },
    { name: 'Delay two', rect: { x: 4, y: 0, w: 4, h: 3 } },
  ]);
  seeded.board.stacks = [{ id: 'delay-fixture', panelIds: seeded.board.panels.map(panel => panel.id), rect: { x: 0, y: 0, w: 4, h: 3 } }];
  await studioApi(request, '/__studio/api/board', seeded);
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Seconds per widget', { exact: true }).fill('2');
  await dialog.getByLabel('Manual navigation delay (seconds)', { exact: true }).fill('45');
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await finishArrangement(page);
  await page.reload();
  const saved = await studioApi(request, '/__studio/api/board');
  expect(saved.board.stacks[0].playback).toMatchObject({ intervalMs: 2000, manualHoldMs: 45000 });
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Manual navigation delay (seconds)', { exact: true })).toHaveValue('45');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await finishArrangement(page);
  const historyBefore = await studioApi(request, '/__studio/api/backups');
  await carousel(page).scrollIntoViewIfNeeded();
  await page.clock.pauseAt(new Date('2026-10-20T13:00:00Z'));
  await carousel(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await carousel(page).press('ArrowRight');
  const held = await activePanel(page).getAttribute('data-panel-id');
  await page.clock.fastForward(44999);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', held);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', held);
  await page.clock.fastForward(2000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', held);
  expect(await studioApi(request, '/__studio/api/backups')).toEqual(historyBefore);
});

test('the native Custom API widget renders an actual private proxy response', async ({ page, request, browser }, testInfo) => {
  await page.goto('/');
  const dialog = await chooseContent(page, 'Custom API', 'Integrations');
  await dialog.getByLabel('Name', { exact: true }).fill('Native API fixture');
  await dialog.getByLabel('Group', { exact: true }).fill('Fixtures');
  await dialog.getByRole('button', { name: 'Advanced YAML', exact: true }).click();
  const fixtureUrl = process.env.STUDIO_BROWSER_WIDGET_FIXTURE_URL || 'http://studio:3000/__studio/config-ready';
  await dialog.getByRole('textbox', { name: 'Item configuration YAML' }).fill([
    `url: ${JSON.stringify(fixtureUrl)}`,
    'headers:',
    `  Host: ${JSON.stringify(new URL(origin).host)}`,
    'refreshInterval: 60000',
    'mappings:',
    '  - field: status',
    '    label: Configuration',
    '    format: text',
    '',
  ].join('\n'));
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/services/proxy');
  await dialog.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ready' });
  const widget = page.locator('[data-panel-kind="serviceWidget"]');
  await expect(widget).toHaveCount(1);
  await expect(widget).toContainText('Configuration');
  await expect(widget).toContainText('ready');
  expect(JSON.stringify(await studioApi(request, '/__studio/api/board'))).not.toContain(fixtureUrl);

  // Populate the same synthetic dashboard for actual desktop/mobile visual review.
  await addBookmark(page);
  await addInformation(page, 'Search', 'provider: duckduckgo\nshowSearchSuggestions: false\nfocus: false\n');
  await addInformation(page, 'Greeting', 'text: Your own space\ntext_size: xl\n');
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await setPanelSize(page, 'greeting', 5, 3);
  await setPanelSize(page, 'Browser bookmark', 5, 3);
  await page.getByRole('checkbox', { name: 'Select greeting', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Browser bookmark', exact: true }).check();
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  await finishArrangement(page);
  await expect(widget).toContainText('ready');
  await page.screenshot({ path: testInfo.outputPath('native-populated-desktop.png'), fullPage: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
  try {
    const mobile = await context.newPage();
    await mobile.goto(origin);
    await expect(mobile.locator('[data-panel-kind="serviceWidget"]')).toContainText('ready');
    await expect(carousel(mobile)).toHaveCount(1);
    await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await mobile.screenshot({ path: testInfo.outputPath('native-populated-mobile.png'), fullPage: true });
  } finally { await context.close(); }
});
