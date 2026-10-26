import { DASHBOARDS, expect, openEditor, test } from '../helpers/dashboard.mjs';

const activePanel = page => page.locator('[data-stack-id]:not([aria-hidden="true"])');
const stack = page => page.locator('[aria-roledescription="carousel"]');

async function choose(page, term) {
  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Find a tile or widget' }).fill(term);
  await expect(dialog.locator('.studio-catalog-item')).toHaveCount(1);
  await dialog.locator('.studio-catalog-item').click();
  return page.getByRole('dialog');
}

async function swipeHeader(page) {
  const header = stack(page).locator('.studio-stack-header');
  await header.scrollIntoViewIfNeeded();
  const bounds = await header.boundingBox();
  expect(bounds).not.toBeNull();
  const session = await page.context().newCDPSession(page);
  const start = bounds.x + bounds.width * 0.68;
  const end = bounds.x + bounds.width * 0.16;
  const y = bounds.y + bounds.height * 0.5;
  const point = x => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(start) });
    for (let i = 1; i <= 6; i += 1) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(start + (end - start) * i / 6) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

test('native dashboard supports direct editing, independent size, mixed stacks and desktop/mobile playback', async ({ page, browser }) => {
  const errors = [];
  const capture = instance => {
    instance.on('pageerror', error => errors.push(error.message));
    instance.on('response', response => {
      if (response.status() >= 500 && response.url().startsWith(process.env.STUDIO_BROWSER_ORIGIN)) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
    });
  };
  capture(page);
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  // The live dashboard has no editing controls; the editor has them all.
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Add your first widget' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Widgets', exact: true })).toHaveCount(0);
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Add your first widget' })).toBeEnabled();
  await expect(page.locator('[data-panel-id]')).toHaveCount(0);

  let dialog = await choose(page, 'Service tile');
  await dialog.getByLabel('Name', { exact: true }).fill('Browser fixture tile');
  await dialog.getByLabel(/^Destination URL/).fill('https://example.test/');
  await dialog.getByLabel(/^Description/).fill('Initial fixture description');
  await dialog.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  const tile = page.locator('[data-panel-kind="service"][aria-label="Browser fixture tile"]');
  await expect(tile).toBeVisible();
  await expect(tile.getByRole('link').first()).toHaveAttribute('href', 'https://example.test/');
  await page.getByRole('button', { name: 'Edit Browser fixture tile', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Description/).fill('Edited through the real dashboard');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(tile).toContainText('Edited through the real dashboard');

  dialog = await choose(page, 'greeting');
  await dialog.getByRole('radio', { name: 'YAML', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Item configuration YAML' }).fill('text: Browser fixture greeting\ntext_size: xl\n');
  await dialog.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  const greeting = page.locator('[data-panel-kind="informationWidget"][aria-label="Greeting"]');
  await expect(greeting).toContainText('Browser fixture greeting');
  await expect(page.locator('[data-panel-id]')).toHaveCount(2);

  const oldWidth = (await tile.boundingBox()).width;
  await page.getByRole('button', { name: 'Resize Browser fixture tile. Use arrow keys.', exact: true }).press('ArrowRight');
  await expect.poll(async () => (await tile.boundingBox()).width).toBeGreaterThan(oldWidth + 20);
  await expect.poll(async () => (await greeting.boundingBox()).width).toBeLessThan(oldWidth + 5);
  await page.getByRole('button', { name: /^Move Browser fixture tile\. Use arrow keys/ }).press('ArrowDown');
  // Make both dimensions explicit before creating a shared-size stack. The
  // independent-resize assertion above remains separate from shared sizing.
  for (const title of ['Browser fixture tile', 'Greeting']) {
    const selected = page.getByRole('checkbox', { name: `Select ${title}`, exact: true });
    await selected.check();
    await page.getByRole('button', { name: 'Position & size', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('5');
    await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
    await selected.uncheck();
  }
  await expect.poll(async () => Math.abs((await tile.boundingBox()).width - (await greeting.boundingBox()).width)).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await tile.boundingBox()).height - (await greeting.boundingBox()).height)).toBeLessThan(1);
  await page.getByRole('checkbox', { name: 'Select Browser fixture tile', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Greeting', exact: true }).check();
  await page.getByRole('button', { name: 'Create stack (2)', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Seconds per widget', { exact: true }).fill('2');
  await dialog.getByLabel('Transition', { exact: true }).selectOption('fade');
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  // Done saves, then returns to the Dashboards page. Reopening the live
  // dashboard exercises saved state rather than a race.
  await page.waitForURL(`**${DASHBOARDS}`);
  await page.goto('/dashboard');
  await expect(stack(page)).toHaveCount(1);
  await expect(page.locator('[data-panel-id]')).toHaveCount(2);
  await stack(page).scrollIntoViewIfNeeded();
  await expect(stack(page).getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();
  await expect(stack(page).getByRole('button')).toHaveCount(2);
  await expect(stack(page).getByRole('button', { name: /^Choose widget in stack:/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /(?:previous|next) (?:widget|slide)/i })).toHaveCount(0);
  await expect(page.locator('[data-stack-id][aria-hidden="true"]')).toHaveAttribute('inert', '');

  const initialId = await activePanel(page).getAttribute('data-panel-id');
  await stack(page).press('ArrowRight');
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', initialId);
  await expect(stack(page).getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();
  const keyboardId = await activePanel(page).getAttribute('data-panel-id');
  const header = stack(page).locator('.studio-stack-header');
  const bounds = await header.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.68, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.16, bounds.y + bounds.height / 2, { steps: 7 });
  await page.mouse.up();
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', keyboardId);
  await page.clock.runFor(500);
  const dragId = await activePanel(page).getAttribute('data-panel-id');
  await header.hover({ position: { x: bounds.width * 0.55, y: bounds.height / 2 } });
  await page.mouse.wheel(90, 0);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', dragId);

  await page.clock.pauseAt(new Date('2026-10-20T13:00:00Z'));
  await stack(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await expect(stack(page).getByRole('button', { name: 'Pause slideshow', exact: true })).toBeVisible();
  const beforeHeldSwitch = await activePanel(page).getAttribute('data-panel-id');
  await stack(page).press('ArrowRight');
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', beforeHeldSwitch);
  const heldId = await activePanel(page).getAttribute('data-panel-id');
  await page.clock.fastForward(29000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', heldId);
  await page.clock.fastForward(1000);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', heldId);
  await page.clock.fastForward(2000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', heldId);
  await stack(page).getByRole('button', { name: 'Pause slideshow', exact: true }).click();
  const beforePausedSwitch = await activePanel(page).getAttribute('data-panel-id');
  await stack(page).press('ArrowRight');
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', beforePausedSwitch);
  const pausedId = await activePanel(page).getAttribute('data-panel-id');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', pausedId);
  await expect(stack(page).getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();
  await page.clock.resume();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
  try {
    const mobile = await mobileContext.newPage();
    capture(mobile);
    await mobile.goto(new URL('/dashboard', process.env.STUDIO_BROWSER_ORIGIN).href);
    await expect(stack(mobile)).toHaveCount(1);
    await stack(mobile).scrollIntoViewIfNeeded();
    await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const beforeSwipe = await activePanel(mobile).getAttribute('data-panel-id');
    await swipeHeader(mobile);
    await expect(activePanel(mobile)).not.toHaveAttribute('data-panel-id', beforeSwipe);
    await expect(stack(mobile).getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();
    await expect(stack(mobile).getByRole('button', { name: 'Play slideshow', exact: true })).toHaveCount(1);
    await expect(stack(mobile).getByRole('button')).toHaveCount(2);
    await expect(stack(mobile).locator('.studio-stack-title')).toHaveAttribute('aria-expanded', 'false');
  } finally { await mobileContext.close(); }

  await openEditor(page);
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Browser fixture tile', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(tile).toHaveCount(0);
  await expect(stack(page)).toHaveCount(0);
  await expect(greeting).toContainText('Browser fixture greeting');
  expect(errors).toEqual([]);
});
