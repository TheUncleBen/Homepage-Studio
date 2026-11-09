import { expect, test, touchSession } from '../helpers/dashboard.mjs';
import { activePanel, carousel, seedPlayback } from '../helpers/engineering.mjs';

// A stack has no header bar (board 4): page dots and a small Play/Pause sit
// on its bottom strip, and each dot jumps straight to its widget.
const dot = (page, name, index) => carousel(page).getByRole('button', { name: `Show ${name}, ${index} of 2`, exact: true });
const strip = page => carousel(page).locator('.studio-stack-footer');
// Drags along the strip from beside the dots, which are centred on it.
async function dragStrip(page, dx) {
  const box = await strip(page).boundingBox();
  const x = box.x + box.width * 0.7;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('stack page dots jump to a widget, keep native state, focus and the manual hold, and never hijack gestures', { tag: '@cross-engine' }, async ({ page, request }) => {
  const seeded = await seedPlayback(request);
  const searchId = seeded.board.panels.find(panel => panel.nativeLocator.type === 'search').id;
  const greetingId = seeded.board.panels.find(panel => panel.nativeLocator.type === 'greeting').id;
  await page.clock.install({ time: new Date('2026-10-21T12:00:00Z') });
  await page.goto('/dashboard');
  const input = page.locator(`[data-panel-id="${searchId}"]`).getByRole('combobox', { includeHidden: true });
  await input.fill('Dots keep this native input');
  const original = await input.elementHandle();
  await page.clock.pauseAt(new Date('2026-10-21T13:00:00Z'));
  await expect(dot(page, 'Search', 1)).toHaveAttribute('aria-current', 'true');
  await dot(page, 'Greeting', 2).focus();
  await page.keyboard.press('Enter');
  await expect(dot(page, 'Greeting', 2)).toBeFocused();
  await expect(dot(page, 'Greeting', 2)).toHaveAttribute('aria-current', 'true');
  await expect(dot(page, 'Search', 1)).not.toHaveAttribute('aria-current', 'true');
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await expect(carousel(page).getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();

  await dot(page, 'Search', 1).click();
  await expect(input).toHaveValue('Dots keep this native input');
  expect(await input.evaluate((node, before) => node === before, original)).toBe(true);
  // A dot chosen while playing holds that widget for the manual delay (30 s).
  await carousel(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await dot(page, 'Greeting', 2).click();
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(29999);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', searchId);
  await carousel(page).getByRole('button', { name: 'Pause slideshow', exact: true }).click();

  // A horizontal drag along the strip switches; a short one does nothing.
  await dragStrip(page, -70);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(500);
  await dragStrip(page, -10);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  // The live dashboard has no editing: a right-click or a hold on a dot
  // neither starts editing nor opens a menu.
  await dot(page, 'Search', 1).click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  const bounds = await dot(page, 'Greeting', 2).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.clock.fastForward(420);
  await page.mouse.up();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  expect(await input.evaluate((node, before) => node === before, original)).toBe(true);
});

test.describe('mobile page dots', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('a dot tap jumps, a swipe on the strip still navigates, and a held or two-finger touch does nothing', async ({ page, request }) => {
    const seeded = await seedPlayback(request);
    const greetingId = seeded.board.panels.find(panel => panel.nativeLocator.type === 'greeting').id;
    await page.goto('/dashboard');
    await dot(page, 'Greeting', 2).tap();
    await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
    const touch = await touchSession(page);
    try {
      let bounds = await strip(page).boundingBox();
      let point = { x: bounds.x + bounds.width * 0.7, y: bounds.y + bounds.height / 2 };
      await touch.start(point.x, point.y);
      await touch.move(point, { x: point.x - 70, y: point.y });
      await touch.end();
      await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', greetingId);
      const before = await activePanel(page).getAttribute('data-panel-id');
      const multi = await page.context().newCDPSession(page);
      try {
        bounds = await strip(page).boundingBox();
        const first = { x: bounds.x + bounds.width * 0.7, y: bounds.y + bounds.height / 2, id: 1 };
        await multi.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
        await multi.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, { x: 8, y: 8, id: 2 }] });
        await multi.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await multi.detach(); }
      await expect(activePanel(page)).toHaveAttribute('data-panel-id', before);
      bounds = await dot(page, 'Search', 1).boundingBox();
      point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await touch.start(point.x, point.y);
      // Well past the old 420ms hold deadline.
      await page.waitForTimeout(900);
      await touch.end();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
    } finally { await touch.detach(); }
  });
});
