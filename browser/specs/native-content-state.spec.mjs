import { expect, finishArrangement, mouseDrag, openEditor, setPanelSize, studioApi, test } from '../helpers/dashboard.mjs';
import { activePanel, carousel, expectPageFits } from '../helpers/engineering.mjs';
import { installDenseResponses, installEmbeddedDocument, seedDenseContent, seedEmbeddedContent } from '../helpers/native-fixtures.mjs';

async function expectListHeadingsInsidePanel(list) {
  const host = await list.locator('.studio-native-content').boundingBox();
  for (const name of ['CPU', 'MEM']) {
    const heading = list.getByText(name, { exact: true });
    await expect(heading).toBeVisible();
    const bounds = await heading.boundingBox();
    expect(bounds.y, `${name} heading must not be clipped above the native scroll area`).toBeGreaterThanOrEqual(host.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(host.y + host.height);
    expect(bounds.x).toBeGreaterThanOrEqual(host.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(host.x + host.width);
  }
  const values = await list.evaluate(element => {
    const headings = [...element.querySelectorAll('.w-14.text-right')].slice(0, 2).map(cell => cell.getBoundingClientRect().right);
    const cells = [...element.querySelectorAll('.opacity-25.w-14.text-right')];
    return cells.map((cell, index) => {
      const bounds = cell.getBoundingClientRect();
      const row = cell.parentElement.getBoundingClientRect();
      return { index, left: bounds.left, right: bounds.right, top: row.top, bottom: row.bottom,
        headingRight: headings[index % 2], fits: cell.scrollWidth <= cell.clientWidth + 1, opacity: getComputedStyle(cell).opacity };
    });
  });
  expect(values).toHaveLength(10);
  for (const value of values) {
    expect(value.opacity, 'Live native numeric values must remain readable').toBe('1');
    expect(value.fits, 'Numeric values must fit without clipping').toBe(true);
    expect(Math.abs(value.right - value.headingRight), 'CPU and memory columns align with their headings').toBeLessThanOrEqual(1);
    expect(value.left).toBeGreaterThanOrEqual(host.x);
    expect(value.right).toBeLessThanOrEqual(host.x + host.width);
    if (value.index >= 2) expect(value.top, 'Enlarged list rows must not overlap').toBeGreaterThanOrEqual(values[value.index - 2].bottom - 1);
  }
}

test('native calendar, chart and process list fit their minima at desktop and narrow widths without losing local state', { tag: '@cross-engine' }, async ({ page, request }, testInfo) => {
  const fixture = await installDenseResponses(page);
  const seeded = await seedDenseContent(request);
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.goto('/home');
  const calendarSource = seeded.board.panels.find(panel => panel.nativeLocator.type === 'calendar');
  const chartSource = seeded.board.panels.find(panel => panel.nativeLocator.type === 'glances' && panel.nativeLocator.sourceIndex === 0);
  const listSource = seeded.board.panels.find(panel => panel.nativeLocator.type === 'glances' && panel.nativeLocator.sourceIndex === 1);
  const calendar = page.locator(`[data-panel-id="${calendarSource.id}"]`);
  const chart = page.locator(`[data-panel-id="${chartSource.id}"]`);
  const list = page.locator(`[data-panel-id="${listSource.id}"]`);
  await expect(calendar.getByRole('button', { name: 'October 2026', exact: true })).toBeVisible();
  await expect(calendar.getByText('Calendar fixture event 8', { exact: true })).toHaveCount(1);
  await expect(chart.locator('svg.recharts-surface')).toBeVisible();
  await expect(list).toContainText('native-process-5');
  await expectListHeadingsInsidePanel(list);
  await expect.poll(() => fixture.cpuSamples).toBeGreaterThan(1);
  // Arranging in the editor never remounts native content.
  await openEditor(page);
  await expect(calendar.getByRole('button', { name: 'October 2026', exact: true })).toBeVisible();
  await expect(chart.locator('svg.recharts-surface')).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-20T13:00:00Z'));
  const chartNode = await chart.locator('svg.recharts-surface').elementHandle();
  await calendar.getByRole('button', { name: '>', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'November 2026', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Move ${calendarSource.title}. Use arrow keys; Shift and arrow keys resize.`, exact: true }).press('ArrowDown');
  await page.getByRole('button', { name: `Resize ${chartSource.title}. Use arrow keys.`, exact: true }).first().press('ArrowRight');
  await expect(calendar.getByRole('button', { name: 'November 2026', exact: true })).toBeVisible();
  expect(await chart.locator('svg.recharts-surface').evaluate((node, original) => node === original, chartNode)).toBe(true);
  await finishArrangement(page);
  // A fresh page needs the clock running to render the calendar.
  await page.clock.resume();
  await page.goto('/home');
  await expect(calendar.getByRole('button', { name: 'October 2026', exact: true })).toBeVisible();
  await calendar.getByRole('button', { name: '>', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'November 2026', exact: true })).toBeVisible();
  await expectPageFits(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expectPageFits(page);
    await expect(calendar.getByRole('button', { name: 'November 2026', exact: true })).toBeVisible();
    await calendar.getByRole('button', { name: 'November 2026', exact: true }).click();
    await calendar.getByText('Calendar fixture event 8', { exact: true }).scrollIntoViewIfNeeded();
    await expect(calendar.getByText('Calendar fixture event 8', { exact: true })).toBeInViewport();
    expect(await calendar.locator('.studio-native-content').evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator('svg.recharts-surface')).toBeVisible();
    expect((await chart.locator('svg.recharts-surface').boundingBox()).width).toBeGreaterThan(200);
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByText('native-process-5', { exact: true })).toBeVisible();
    await expectListHeadingsInsidePanel(list);
    await calendar.locator('.studio-native-content').evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`dense-native-${width}.png`), fullPage: true });
    await calendar.getByRole('button', { name: '>', exact: true }).click();
    await expect(calendar.getByRole('button', { name: 'November 2026', exact: true })).toBeVisible();
  }
  const saved = await studioApi(request, '/home/studio/api/board');
  expect(saved.board.panels.map(panel => panel.id).sort()).toEqual(seeded.board.panels.map(panel => panel.id).sort());
  expect(fixture.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ endpoint: 'Fixture calendar' }),
    expect.objectContaining({ endpoint: '4/cpu', index: '0' }),
    expect.objectContaining({ endpoint: '4/processlist', index: '1' }),
  ]));
  await calendar.getByRole('button', { name: 'November 2026', exact: true }).click();
  await calendar.locator('.studio-native-content').evaluate(element => { element.scrollTop = 0; });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('dense-native-desktop.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expectListHeadingsInsidePanel(list);
  await list.getByText('native-process-5', { exact: true }).scrollIntoViewIfNeeded();
  await expect(list.getByText('native-process-5', { exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('dense-native-enlarged-text.png'), fullPage: true });
});

test('an actual native iframe keeps its document and controls through move, resize, stacking and unstacking, then through stack navigation', async ({ page, request }) => {
  const fixture = await installEmbeddedDocument(page);
  const seeded = await seedEmbeddedContent(request);
  const source = seeded.board.panels.find(panel => panel.kind === 'serviceWidget');
  await openEditor(page);
  const panel = page.locator(`[data-panel-id="${source.id}"]`);
  const iframe = panel.locator('iframe');
  const content = iframe.contentFrame();
  await content.getByRole('textbox', { name: 'Embedded note', exact: true }).fill('Embedded document survives');
  await content.getByRole('button', { name: 'Count 0', exact: true }).click();
  const iframeNode = await iframe.elementHandle();
  const frame = await iframeNode.contentFrame();
  const documentId = await frame.evaluate(() => window.fixtureLoadId);
  const preserved = async () => {
    expect(await iframe.evaluate((node, original) => node === original, iframeNode)).toBe(true);
    expect(await frame.evaluate(() => window.fixtureLoadId)).toBe(documentId);
    await expect(content.getByRole('textbox', { name: 'Embedded note', exact: true })).toHaveValue('Embedded document survives');
    await expect(content.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
  };
  await page.getByRole('button', { name: `Move ${source.title}. Use arrow keys; Shift and arrow keys resize.`, exact: true }).press('ArrowDown');
  await page.getByRole('button', { name: `Resize ${source.title}. Use arrow keys.`, exact: true }).press('ArrowRight');
  await setPanelSize(page, source.title, 6, 6);
  await preserved();
  const stackBoth = async () => {
    await page.getByRole('checkbox', { name: `Select ${source.title}`, exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select Stack companion', exact: true }).check();
    await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  };
  await stackBoth();
  await expect(carousel(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unstack all', exact: true }).click();
  await expect(carousel(page)).toHaveCount(0);
  await preserved();
  expect(fixture.loads).toBe(1);

  // On the live dashboard, the embedded document keeps its controls and
  // state through stack navigation.
  await stackBoth();
  await finishArrangement(page);
  await page.goto('/home');
  if (await activePanel(page).getAttribute('data-panel-id') !== source.id) await carousel(page).press('ArrowRight');
  await content.getByRole('textbox', { name: 'Embedded note', exact: true }).fill('Live document survives');
  // The fixture reports iframe-local pixels; its parent must finish the slide
  // transition before a fixed-distance pointer assertion has a stable origin.
  await expect.poll(() => panel.locator('.studio-panel-slide').evaluate(element =>
    element.getAnimations().filter(animation => animation.playState === 'running').length,
  )).toBe(0);
  await mouseDrag(page, content.getByRole('slider', { name: 'Embedded drag', exact: true }), 80, 0);
  await expect(content.getByRole('slider', { name: 'Embedded drag', exact: true })).toHaveAttribute('aria-valuenow', '80');
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', source.id);
  const liveNode = await iframe.elementHandle();
  await carousel(page).press('ArrowRight');
  await expect(panel).toHaveAttribute('inert', '');
  await carousel(page).press('ArrowLeft');
  expect(await iframe.evaluate((node, original) => node === original, liveNode)).toBe(true);
  await expect(content.getByRole('textbox', { name: 'Embedded note', exact: true })).toHaveValue('Live document survives');
  await expect(content.getByRole('slider', { name: 'Embedded drag', exact: true })).toHaveAttribute('aria-valuenow', '80');
});

test('typing in a native embedded page suspends playback until focus returns to the dashboard', async ({ page, request }) => {
  await installEmbeddedDocument(page);
  const seeded = await seedEmbeddedContent(request, true);
  const source = seeded.board.panels.find(panel => panel.kind === 'serviceWidget');
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.goto('/home');
  const content = page.locator(`[data-panel-id="${source.id}"] iframe`).contentFrame();
  await expect(content.getByRole('textbox', { name: 'Embedded note', exact: true })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-20T13:00:00Z'));
  await carousel(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await page.clock.fastForward(1000);
  await content.getByRole('textbox', { name: 'Embedded note', exact: true }).fill('Focused embed retains its slide');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', source.id);
  await expect(carousel(page).locator('.studio-playback-status')).toHaveText('Waiting');
  await carousel(page).focus();
  await expect(carousel(page).locator('.studio-playback-status')).toHaveText('Playing');
  await page.clock.fastForward(999);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', source.id);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', source.id);
});
