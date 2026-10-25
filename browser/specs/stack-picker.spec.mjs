import { expect, mouseDrag, test, touchSession } from '../helpers/dashboard.mjs';
import { activePanel, carousel, seedPlayback } from '../helpers/engineering.mjs';

const title = page => carousel(page).getByRole('button', { name: /^Choose widget in stack:/ });
const menu = page => page.getByRole('menu', { name: 'Choose widget in this stack', exact: true });

test('intentional stack title picker preserves native state, keyboard focus and manual hold without hijacking gestures', { tag: '@cross-engine' }, async ({ page, request }) => {
  const seeded = await seedPlayback(request);
  const searchId = seeded.board.panels.find(panel => panel.nativeLocator.type === 'search').id;
  const greetingId = seeded.board.panels.find(panel => panel.nativeLocator.type === 'greeting').id;
  await page.clock.install({ time: new Date('2026-10-21T12:00:00Z') });
  await page.goto('/dashboard');
  const input = page.locator(`[data-panel-id="${searchId}"]`).getByRole('combobox', { includeHidden: true });
  await input.fill('Picker keeps this native input');
  const original = await input.elementHandle();
  await page.clock.pauseAt(new Date('2026-10-21T13:00:00Z'));
  await title(page).press('Enter');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('menuitemradio', { name: 'Search 1 of 2', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu(page).getByRole('menuitemradio', { name: 'Greeting 2 of 2', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  await expect(title(page)).toBeFocused();
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await expect(carousel(page).getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();

  await title(page).click();
  await menu(page).getByRole('menuitemradio', { name: 'Search 1 of 2', exact: true }).click();
  await expect(input).toHaveValue('Picker keeps this native input');
  expect(await input.evaluate((node, before) => node === before, original)).toBe(true);
  await carousel(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await title(page).press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(29999);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', searchId);
  await carousel(page).getByRole('button', { name: 'Pause slideshow', exact: true }).click();

  await mouseDrag(page, title(page), -70, 0);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', greetingId);
  await expect(menu(page)).toHaveCount(0);
  await page.clock.fastForward(500);
  await mouseDrag(page, title(page), -10, 0);
  await expect(menu(page)).toHaveCount(0);
  // The live dashboard has no editing: a right-click or a hold on the title
  // neither starts editing nor opens the picker.
  await title(page).click({ button: 'right' });
  await expect(menu(page)).toHaveCount(0);
  await expect(title(page)).toHaveAttribute('aria-expanded', 'false');
  const bounds = await title(page).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.clock.fastForward(420);
  await page.mouse.up();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(title(page)).toHaveAttribute('aria-expanded', 'false');
  await title(page).press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(title(page)).toBeFocused();
  expect(await input.evaluate((node, before) => node === before, original)).toBe(true);
});

test.describe('mobile title picker', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('short title taps open intentionally, touch swipes still navigate, and a held touch does nothing', async ({ page, request }) => {
    await seedPlayback(request);
    await page.goto('/dashboard');
    await title(page).tap();
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole('menuitemradio', { name: 'Greeting 2 of 2', exact: true }).tap();
    await expect(menu(page)).toHaveCount(0);
    const before = await activePanel(page).getAttribute('data-panel-id');
    const touch = await touchSession(page);
    try {
      let bounds = await title(page).boundingBox();
      let point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await touch.start(point.x, point.y);
      await touch.move(point, { x: point.x - 70, y: point.y });
      await touch.end();
      await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', before);
      await expect(menu(page)).toHaveCount(0);
      // The second finger lands outside the title, exercising document-wide
      // cancellation rather than only the title's own pointer handlers.
      const multi = await page.context().newCDPSession(page);
      try {
        bounds = await title(page).boundingBox();
        const first = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 };
        await multi.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
        await multi.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, { x: 8, y: 8, id: 2 }] });
        await multi.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(menu(page)).toHaveCount(0);
      } finally { await multi.detach(); }
      bounds = await title(page).boundingBox();
      point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await touch.start(point.x, point.y);
      // Well past the old 420ms hold deadline.
      await page.waitForTimeout(900);
      await touch.end();
      await expect(menu(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
      await expect(title(page)).toHaveAttribute('aria-expanded', 'false');
    } finally { await touch.detach(); }
  });
});
