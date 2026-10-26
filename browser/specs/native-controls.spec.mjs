import {
  addBookmark, addInformation, chooseContent, DASHBOARDS, expect, finishArrangement,
  mouseDrag, openEditor, origin, panelPixels, seedServicePanels, setPanelSize,
  studioApi, test, touchSession,
} from '../helpers/dashboard.mjs';
import { playback, seedNative, seedPlayback } from '../helpers/engineering.mjs';

const carousel = page => page.locator('[aria-roledescription="carousel"]');
const activePanel = page => page.locator('[data-stack-id]:not([aria-hidden="true"])');
const servicePanel = (page, title) => page.locator(`[data-panel-kind="service"][aria-label="${title}"]`);

test('pointer placement and resize persist independently; Escape cancels an active drag', { tag: '@cross-engine' }, async ({ page, request }) => {
  await seedServicePanels(request, [
    { name: 'Pointer tile', rect: { x: 0, y: 0, w: 4, h: 3 } },
    { name: 'Unchanged tile', rect: { x: 8, y: 4, w: 4, h: 3 } },
  ]);
  await page.goto('/dashboard');
  const tile = servicePanel(page, 'Pointer tile');
  const other = servicePanel(page, 'Unchanged tile');
  await expect(tile).toBeVisible();
  const otherBefore = await panelPixels(other);
  const column = await page.locator('.studio-canvas').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--studio-grid-column')));
  const row = await page.locator('.studio-canvas').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--studio-grid-row')));
  await openEditor(page);
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
  const saved = await studioApi(request, '/dashboard/studio/api/board');
  expect(saved.board.panels.find(panel => panel.title === 'Pointer tile').rect).toEqual({ x: 2, y: 1, w: 6, h: 4 });
  expect(saved.board.panels.find(panel => panel.title === 'Unchanged tile').rect).toEqual({ x: 8, y: 4, w: 4, h: 3 });
  await page.goto('/dashboard');
  await expect.poll(() => panelPixels(tile)).toEqual(resized);
});

test.describe('touch direct manipulation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('vertical scrolling on the live dashboard never arranges; in the editor a finger on the move handle moves and deliberately stacks a panel', async ({ page, request }) => {
    await seedServicePanels(request, [
      { name: 'Touch source', rect: { x: 0, y: 0, w: 4, h: 3 } },
      { name: 'Touch target', rect: { x: 0, y: 3, w: 4, h: 3 } },
      { name: 'Scroll fixture', rect: { x: 0, y: 8, w: 4, h: 3 } },
    ]);
    await page.goto('/dashboard');
    const source = servicePanel(page, 'Touch source');
    const target = servicePanel(page, 'Touch target');
    await expect(source).toBeVisible();
    const touch = await touchSession(page);
    const center = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const bounds = await locator.boundingBox();
      return { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
    };
    const handle = page.getByRole('button', { name: /^Move Touch source\. Use arrow keys/ });
    try {
      let point = await center(source.locator('.studio-panel-header'));
      const scrollBefore = await page.evaluate(() => scrollY);
      await touch.start(point.x, point.y);
      await touch.move(point, { x: point.x, y: point.y - 100 });
      await touch.end();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore + 20);
      // A held finger on the live dashboard does nothing either.
      point = await center(source.locator('.studio-panel-header'));
      await touch.start(point.x, point.y);
      await page.waitForTimeout(900);
      await touch.end();
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
      await expect(handle).toHaveCount(0);

      await openEditor(page);
      const before = await panelPixels(source);
      point = await center(handle);
      await touch.start(point.x, point.y);
      await touch.move(point, { x: point.x, y: point.y + 100 });
      await touch.end();
      await expect.poll(async () => (await panelPixels(source)).top).toBeGreaterThan(before.top + 50);
      // A dirty arrangement asks before Cancel discards it, then returns to
      // the Dashboards page with nothing saved.
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
      await page.getByRole('dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
      await page.waitForURL(`**${DASHBOARDS}`);
      expect((await studioApi(request, '/dashboard/studio/api/board')).board.stacks).toHaveLength(0);

      await openEditor(page);
      await expect.poll(() => panelPixels(source)).toEqual(before);
      point = await center(handle);
      const targetBounds = await target.boundingBox();
      await touch.start(point.x, point.y);
      await touch.move(point, { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + 70 });
      await expect(page.getByText('Release to stack', { exact: true })).toBeVisible();
      await touch.end();
      await expect(carousel(page)).toHaveCount(1);
      await finishArrangement(page);
      const saved = await studioApi(request, '/dashboard/studio/api/board');
      expect(saved.board.stacks).toHaveLength(1);
      expect(saved.board.stacks[0].panelIds).toHaveLength(2);
      expect(saved.board.panels).toHaveLength(3);
    } finally { await touch.detach(); }
  });
});

test.describe('touch on panel bodies', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('body swipe navigates a stack and a body hold does nothing on the live dashboard, while native controls, links and vertical scroll keep their touch', async ({ page, request }) => {
    await seedNative(request, {
      widgetsYaml: JSON.stringify([
        { greeting: { text: 'Swipe body fixture' } },
        { search: { provider: 'duckduckgo', showSearchSuggestions: false, focus: false } },
        { greeting: { text: 'Hold body fixture' } },
      ]),
      servicesYaml: JSON.stringify([{ Fixtures: [
        { 'Link fixture': { href: `${origin}/#studio-link-fixture`, description: 'Native link body' } },
        { 'Tall page marker': { href: `${origin}/#studio-tall-marker` } },
      ] }]),
    }, board => {
      const byType = type => board.panels.filter(panel => panel.nativeLocator?.type === type);
      const [swipe, hold] = byType('greeting');
      const [search] = byType('search');
      swipe.rect = { x: 0, y: 0, w: 4, h: 3 };
      search.rect = { x: 0, y: 0, w: 4, h: 3 };
      hold.rect = { x: 0, y: 4, w: 4, h: 3 };
      board.panels.find(panel => panel.title === 'Link fixture').rect = { x: 0, y: 8, w: 4, h: 3 };
      board.panels.find(panel => panel.title === 'Tall page marker').rect = { x: 0, y: 30, w: 4, h: 3 };
      board.stacks = [{ id: 'body-stack', panelIds: [swipe.id, search.id], rect: { x: 0, y: 0, w: 4, h: 4 }, playback: playback() }];
    });
    await page.goto('/dashboard');
    const done = page.getByRole('button', { name: 'Done', exact: true });
    const picker = page.getByRole('menu');
    await expect(activePanel(page)).toContainText('Swipe body fixture');
    const touch = await touchSession(page);
    const center = async (locator) => {
      await locator.scrollIntoViewIfNeeded();
      const bounds = await locator.boundingBox();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };
    try {
      // A short tap on the body neither opens the title picker nor edits.
      let point = await center(activePanel(page).locator('.studio-native-content'));
      await touch.start(point.x, point.y);
      await touch.end();
      await expect(picker).toHaveCount(0);
      await expect(done).toHaveCount(0);

      // Horizontal swipe across the stacked widget's body changes the slide.
      await touch.start(point.x + 60, point.y);
      await touch.move({ x: point.x + 60, y: point.y }, { x: point.x - 100, y: point.y + 4 });
      await touch.end();
      await expect(activePanel(page).getByRole('combobox')).toBeVisible();
      await expect(picker).toHaveCount(0);
      await expect(done).toHaveCount(0);

      // A swipe or hold that starts on the native search input stays with it.
      const input = activePanel(page).getByRole('combobox');
      point = await center(input);
      await touch.start(point.x + 40, point.y);
      await touch.move({ x: point.x + 40, y: point.y }, { x: point.x - 100, y: point.y });
      await touch.end();
      await expect(activePanel(page).getByRole('combobox')).toBeVisible();
      await touch.start(point.x, point.y);
      await page.waitForTimeout(800);
      await touch.end();
      await expect(done).toHaveCount(0);

      // A hold that starts on a native link neither selects nor navigates.
      const link = page.locator('[data-panel-kind="service"][aria-label="Link fixture"] a[href]').first();
      const url = page.url();
      point = await center(link);
      await touch.start(point.x, point.y);
      await page.waitForTimeout(800);
      await touch.end();
      await expect(done).toHaveCount(0);
      expect(page.url()).toBe(url);

      // Vertical page scroll still starts from a body before any hold.
      const holdBody = page.locator('[data-panel-kind="informationWidget"][aria-label="Greeting 2"] .studio-native-content');
      point = await center(holdBody);
      const scrollBefore = await page.evaluate(() => scrollY);
      await touch.start(point.x, point.y);
      await touch.move(point, { x: point.x, y: point.y - 120 });
      await touch.end();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore + 20);
      await expect(done).toHaveCount(0);

      // Holding the body neither edits nor selects: arranging happens only
      // in the editor.
      point = await center(holdBody);
      await touch.start(point.x, point.y);
      await page.waitForTimeout(900);
      await touch.end();
      await expect(done).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: 'Select Greeting 2', exact: true })).toHaveCount(0);
      await expect(picker).toHaveCount(0);
    } finally { await touch.detach(); }
  });
});

test.describe('phone delete confirmation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Delete brings its confirmation into view with focus on Keep it, which returns focus to Delete', async ({ page, request }) => {
    await seedServicePanels(request, [{ name: 'Delete fixture', rect: { x: 0, y: 0, w: 4, h: 3 } }]);
    await openEditor(page);
    await page.getByRole('button', { name: 'Edit Delete fixture', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const remove = dialog.getByRole('button', { name: 'Delete', exact: true });
    await remove.click();
    const keep = dialog.getByRole('button', { name: 'Keep it', exact: true });
    await expect(keep).toBeFocused();
    await expect(keep).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Delete permanently', exact: true })).toBeInViewport();
    // In view is not enough: the sticky dialog footer must not cover the question.
    const uncovered = locator => locator.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && element.contains(hit));
    });
    await expect.poll(() => uncovered(keep)).toBe(true);
    expect(await uncovered(dialog.getByRole('button', { name: 'Delete permanently', exact: true }))).toBe(true);
    const confirm = await dialog.locator('.studio-delete-confirm').boundingBox();
    expect(confirm.y + confirm.height).toBeLessThanOrEqual((await dialog.locator('.studio-dialog-footer').boundingBox()).y);
    await keep.click();
    await expect(dialog.getByText('Delete Delete fixture?')).toHaveCount(0);
    await expect(remove).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await studioApi(request, '/dashboard/studio/api/board')).board.panels).toHaveLength(1);
  });
});

test.describe('selection checkbox target size', () => {
  for (const [label, use, minimum] of [
    ['fine pointer', { viewport: { width: 1440, height: 1080 } }, 24],
    ['coarse pointer', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 44],
  ]) {
    test.describe(label, () => {
      test.use(use);
      test(`the editor's selection target is at least ${minimum} px and toggles from its edge`, async ({ page, request }) => {
        await seedServicePanels(request, [{ name: 'Target tile', rect: { x: 0, y: 0, w: 4, h: 3 } }]);
        await openEditor(page);
        const checkbox = page.getByRole('checkbox', { name: 'Select Target tile', exact: true });
        const target = page.locator('.studio-select-target').filter({ has: checkbox });
        const bounds = await target.boundingBox();
        expect(bounds.width).toBeGreaterThanOrEqual(minimum);
        expect(bounds.height).toBeGreaterThanOrEqual(minimum);
        // A press near the target's corner, outside the drawn checkbox, still selects.
        const box = await checkbox.boundingBox();
        const x = bounds.x + 2;
        const y = bounds.y + 2;
        expect(x < box.x || y < box.y).toBe(true);
        if (use.hasTouch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await expect(checkbox).toBeChecked();
        // The larger target does not change the header's height.
        const header = servicePanel(page, 'Target tile').locator('.studio-panel-header');
        const height = (await header.boundingBox()).height;
        await page.addStyleTag({ content: '.studio-select-target { display: none !important; }' });
        expect((await header.boundingBox()).height).toBe(height);
      });
      test(`a stack's Select checkbox target is at least ${minimum} px and toggles the stack's selection`, async ({ page, request }) => {
        await seedPlayback(request);
        await openEditor(page);
        const shell = page.locator('[data-stack-shell-id="playback-fixture"]');
        const checkbox = shell.getByRole('checkbox', { name: /^Select stack \S/ });
        await expect(checkbox).not.toBeChecked();
        const target = shell.locator('.studio-select-target');
        await expect(target.getByRole('checkbox')).toHaveCount(1);
        const bounds = await target.boundingBox();
        expect(bounds.width).toBeGreaterThanOrEqual(minimum);
        expect(bounds.height).toBeGreaterThanOrEqual(minimum);
        const box = await checkbox.boundingBox();
        const x = bounds.x + 2;
        const y = bounds.y + 2;
        expect(x < box.x || y < box.y).toBe(true);
        if (use.hasTouch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await expect(checkbox).toBeChecked();
        await expect(shell).toHaveClass(/\bstudio-selected\b/);
        // Toggling again removes the stack from the selection, as for a panel.
        if (use.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        else await checkbox.click();
        await expect(checkbox).not.toBeChecked();
        await expect(shell).not.toHaveClass(/\bstudio-selected\b/);
        // Selection never rearranged anything.
        await expect(page.getByText('Unsaved arrangement', { exact: true })).toHaveCount(0);
        // The target does not change the stack header's height.
        const header = shell.locator('.studio-stack-header');
        const height = (await header.boundingBox()).height;
        await page.addStyleTag({ content: '.studio-select-target { display: none !important; }' });
        expect((await header.boundingBox()).height).toBe(height);
      });
    });
  }
});

test('native search state survives stacking and moving out in the editor; bookmark and layout survive reload', { tag: '@cross-engine' }, async ({ page, request }) => {
  await openEditor(page);
  const bookmark = await addBookmark(page);
  await expect(bookmark.getByRole('link').first()).toHaveAttribute('href', 'https://example.test/reference');
  await addInformation(page, 'Search', 'provider: duckduckgo\nshowSearchSuggestions: false\nfocus: false\n');
  const search = page.locator('[data-panel-kind="informationWidget"][aria-label="Search"]');
  const input = search.getByRole('combobox', { includeHidden: true });
  await input.fill('Native search state retained');
  const originalInput = await input.elementHandle();
  await setPanelSize(page, 'Search', 5, 3);
  await setPanelSize(page, 'Browser bookmark', 5, 3);
  await page.getByRole('checkbox', { name: 'Select Search', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Browser bookmark', exact: true }).check();
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  await expect(carousel(page)).toHaveCount(1);
  await expect(input).toHaveValue('Native search state retained');
  expect(await input.evaluate((node, original) => node === original, originalInput)).toBe(true);
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.studio-stack-member').filter({ hasText: 'Browser bookmark' }).getByRole('button', { name: 'Move out Browser bookmark from stack', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await expect(carousel(page)).toHaveCount(0);
  await expect(input).toHaveValue('Native search state retained');
  expect(await input.evaluate((node, original) => node === original, originalInput)).toBe(true);
  await finishArrangement(page);
  const beforeReload = await studioApi(request, '/dashboard/studio/api/board');
  await page.goto('/dashboard');
  await expect(search.getByRole('combobox')).toBeVisible();
  await expect(bookmark.getByRole('link').first()).toHaveAttribute('href', 'https://example.test/reference');
  expect((await studioApi(request, '/dashboard/studio/api/board')).board).toEqual(beforeReload.board);
  // The native search query is transient; only config/layout must survive reload.
});

test('an edited manual navigation delay survives save/reload and sets the next automatic advance', async ({ page, request }) => {
  const seeded = await seedServicePanels(request, [
    { name: 'Delay one', rect: { x: 0, y: 0, w: 4, h: 3 } },
    { name: 'Delay two', rect: { x: 4, y: 0, w: 4, h: 3 } },
  ]);
  seeded.board.stacks = [{ id: 'delay-fixture', panelIds: seeded.board.panels.map(panel => panel.id), rect: { x: 0, y: 0, w: 4, h: 3 } }];
  await studioApi(request, '/dashboard/studio/api/board', seeded);
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await openEditor(page);
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Seconds per widget', { exact: true }).fill('2');
  await dialog.getByLabel('Manual navigation delay (seconds)', { exact: true }).fill('45');
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await finishArrangement(page);
  const saved = await studioApi(request, '/dashboard/studio/api/board');
  expect(saved.board.stacks[0].playback).toMatchObject({ intervalMs: 2000, manualHoldMs: 45000 });
  await openEditor(page);
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Manual navigation delay (seconds)', { exact: true })).toHaveValue('45');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await finishArrangement(page);
  await page.goto('/dashboard');
  const historyBefore = await studioApi(request, '/dashboard/studio/api/backups');
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
  expect(await studioApi(request, '/dashboard/studio/api/backups')).toEqual(historyBefore);
});

test('the native Custom API widget renders an actual private proxy response', async ({ page, request, browser }, testInfo) => {
  await openEditor(page);
  const dialog = await chooseContent(page, 'Custom API', 'Integrations');
  await dialog.getByLabel('Name', { exact: true }).fill('Native API fixture');
  await dialog.getByLabel('Group', { exact: true }).fill('Fixtures');
  await dialog.getByRole('radio', { name: 'YAML', exact: true }).click();
  const fixtureUrl = process.env.STUDIO_BROWSER_WIDGET_FIXTURE_URL || 'http://studio:3000/studio/config-ready';
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
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/dashboard/api/services/proxy');
  await dialog.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ready' });
  const widget = page.locator('[data-panel-kind="serviceWidget"]');
  await expect(widget).toHaveCount(1);
  await expect(widget).toContainText('Configuration');
  await expect(widget).toContainText('ready');
  expect(JSON.stringify(await studioApi(request, '/dashboard/studio/api/board'))).not.toContain(fixtureUrl);

  // Populate the same synthetic dashboard for actual desktop/mobile visual review.
  await addBookmark(page);
  await addInformation(page, 'Search', 'provider: duckduckgo\nshowSearchSuggestions: false\nfocus: false\n');
  await addInformation(page, 'Greeting', 'text: Your own space\ntext_size: xl\n');
  await setPanelSize(page, 'Greeting', 5, 3);
  await setPanelSize(page, 'Browser bookmark', 5, 3);
  await page.getByRole('checkbox', { name: 'Select Greeting', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Browser bookmark', exact: true }).check();
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  await finishArrangement(page);
  await page.goto('/dashboard');
  await expect(widget).toContainText('ready');
  await page.screenshot({ path: testInfo.outputPath('native-populated-desktop.png'), fullPage: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
  try {
    const mobile = await context.newPage();
    await mobile.goto(new URL('/dashboard', origin).href);
    await expect(mobile.locator('[data-panel-kind="serviceWidget"]')).toContainText('ready');
    await expect(carousel(mobile)).toHaveCount(1);
    await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await mobile.screenshot({ path: testInfo.outputPath('native-populated-mobile.png'), fullPage: true });
  } finally { await context.close(); }
});
