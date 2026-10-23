import { expect, mouseDrag, panelPixels, seedServicePanels, studioApi, test } from '../helpers/dashboard.mjs';
import { activePanel, carousel, playback } from '../helpers/engineering.mjs';

const serviceSlots = () => ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ name, rect: { x: index * 4, y: 0, w: 4, h: 3 } }));

async function seedStack(request, members = 3, transition = 'horizontal', overrides = {}) {
  const saved = await seedServicePanels(request, serviceSlots().slice(0, members));
  saved.board.stacks = [{
    id: 'reviewed-interactions', panelIds: saved.board.panels.map(panel => panel.id),
    rect: { x: 0, y: 0, w: 4, h: 3 }, playback: playback({ transition, transitionDurationMs: 500, ...overrides }),
  }];
  return studioApi(request, '/__studio/api/board', { revision: saved.revision, board: saved.board });
}

async function armWrapCapture(page, firstId) {
  await page.evaluate((id) => {
    window.__reviewedWrap = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const first = document.querySelector(`[data-panel-id="${id}"]`);
        if (first.getAttribute('aria-hidden') === 'true') return;
        observer.disconnect();
        requestAnimationFrame(() => resolve(first.querySelector('.studio-panel-slide').getAnimations().map(animation => animation.effect.getKeyframes())));
      });
      observer.observe(document.querySelector('.studio-panel-layer'), { attributes: true, subtree: true, attributeFilter: ['aria-hidden'] });
    });
  }, firstId);
}

test('a short header press released outside the stack neither edits nor leaves playback suspended', async ({ page, request }) => {
  await seedStack(request);
  await page.goto('/');
  const stack = carousel(page);
  await stack.getByRole('button', { name: 'Play slideshow', exact: true }).click();
  const bounds = await stack.boundingBox();
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 4, bounds.y + 40);
  await page.mouse.up();
  // Cross the 420ms hold deadline after the release, not merely the next frame.
  await page.waitForTimeout(600);
  await expect(page.locator('.studio-app')).not.toHaveClass(/studio-edit-mode/);
  await expect(stack.locator('.studio-playback-status')).toHaveText('Playing');
});

test('Quick Launch freezes the remaining playback interval and resumes without a catch-up tick', async ({ page, request }) => {
  await seedStack(request);
  await page.clock.install({ time: new Date('2026-10-22T12:00:00Z') });
  await page.goto('/');
  const stack = carousel(page);
  await expect(stack).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-22T13:00:00Z'));
  const first = await activePanel(page).getAttribute('data-panel-id');
  const snapshots = await studioApi(request, '/__studio/api/backups');
  await stack.getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await page.clock.fastForward(500);
  await page.getByRole('button', { name: 'Quick Launch', exact: true }).click();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Waiting');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', first);
  await page.keyboard.press('Escape');
  await expect(stack.locator('.studio-playback-status')).toHaveText('Playing');
  await page.clock.fastForward(1499);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', first);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', first);
  expect(await studioApi(request, '/__studio/api/backups')).toEqual(snapshots);
});

test('opening Quick Launch during a held stack title cancels the pending edit gesture', async ({ page, request }) => {
  await seedStack(request);
  await page.goto('/');
  const bounds = await carousel(page).getByRole('button', { name: /^Choose widget in stack:/ }).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.keyboard.press('Control+k');
  await expect(page.locator('.studio-quicklaunch input')).toBeVisible();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.locator('.studio-app')).not.toHaveClass(/studio-edit-mode/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Choose widget in this stack' })).toHaveCount(0);
});

for (const transition of ['horizontal', 'vertical']) {
  for (const members of [2, 3]) {
    test(`${members}-member ${transition} wrap keeps the requested direction and stable hosts during rapid reversal`, async ({ page, request }) => {
      const saved = await seedStack(request, members, transition);
      const ids = saved.board.stacks[0].panelIds;
      const axis = transition === 'vertical' ? 'Y' : 'X';
      await page.goto('/');
      const stack = carousel(page);
      await expect(stack).toBeVisible();
      await page.evaluate(() => { window.__reviewedHosts = [...document.querySelectorAll('[data-panel-id]')]; });
      await stack.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(activePanel(page)).toHaveAttribute('data-panel-id', ids.at(-1));
      expect(await page.locator(`[data-panel-id="${ids[0]}"] .studio-panel-slide`).evaluate(node => node.style.transform)).toBe(`translate${axis}(100%)`);
      await page.waitForTimeout(550);
      // Capture the first committed forward-wrap frame in the browser, avoiding
      // a transport delay that could let the transition finish before inspection.
      await armWrapCapture(page, ids[0]);
      await page.keyboard.press('ArrowRight');
      const frames = await page.evaluate(() => window.__reviewedWrap);
      expect(frames.some(sequence => sequence[0].transform === `translate${axis}(100%)` && sequence.at(-1).transform === 'none')).toBe(true);
      expect(await page.locator(`[data-panel-id="${ids.at(-1)}"] .studio-panel-slide`).evaluate(node => node.style.transform)).toBe(`translate${axis}(-100%)`);
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(key);
      await expect(activePanel(page)).toHaveCount(1);
      await expect(activePanel(page)).toHaveAttribute('data-panel-id', ids[0]);
      expect(await page.evaluate(() => window.__reviewedHosts.every((host, index) => document.querySelectorAll('[data-panel-id]')[index] === host))).toBe(true);
    });
  }
}

test('automatic wrap uses the forward transition after a complete playback cycle', async ({ page, request }) => {
  const saved = await seedStack(request, 3, 'horizontal', { intervalMs: 1000 });
  const ids = saved.board.stacks[0].panelIds;
  await page.goto('/');
  await expect(carousel(page)).toBeVisible();
  await armWrapCapture(page, ids[0]);
  await carousel(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  const frames = await page.evaluate(() => window.__reviewedWrap);
  expect(frames.some(sequence => sequence[0].transform === 'translateX(100%)' && sequence.at(-1).transform === 'none')).toBe(true);
  expect(await page.locator(`[data-panel-id="${ids.at(-1)}"] .studio-panel-slide`).evaluate(node => node.style.transform)).toBe('translateX(-100%)');
});

for (const input of ['pointer', 'keyboard']) {
  test(`a projected mobile row can move upward by ${input} and persist the shared desktop layout`, async ({ page, request }) => {
    await seedServicePanels(request, serviceSlots());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const beta = page.locator('[data-panel-id][aria-label="Beta"]');
    await expect(beta).toBeVisible();
    expect((await panelPixels(beta)).top).toBe(264);
    await page.evaluate(() => { window.__reviewedHost = document.querySelector('[data-panel-id][aria-label="Beta"]'); });
    await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
    const handle = page.getByRole('button', { name: 'Move Beta. Use arrow keys; Shift and arrow keys resize.' });
    if (input === 'pointer') await mouseDrag(page, handle, 0, -264);
    else await handle.press('ArrowUp');
    expect((await panelPixels(beta)).top).toBe(0);
    expect(await page.evaluate(() => window.__reviewedHost === document.querySelector('[data-panel-id][aria-label="Beta"]'))).toBe(true);
    await page.getByRole('button', { name: 'Save arrangement', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save arrangement', exact: true })).toHaveCount(0);
    const saved = await studioApi(request, '/__studio/api/board');
    expect(saved.board.panels.find(panel => panel.title === 'Beta').rect).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(saved.board.panels.find(panel => panel.title === 'Alpha').rect).toEqual({ x: 4, y: 0, w: 4, h: 3 });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.reload();
    await expect(beta).toBeVisible();
    expect((await panelPixels(beta)).left).toBe(0);
    expect((await panelPixels(page.locator('[data-panel-id][aria-label="Alpha"]'))).left).toBeGreaterThan(0);
  });
}

test('at 8 columns Left and Right move a wrapped panel one reading position and persist the desktop order', async ({ page, request }) => {
  await seedServicePanels(request, serviceSlots());
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  const panel = name => page.locator(`[data-panel-id][aria-label="${name}"]`);
  await expect(panel('Gamma')).toBeVisible();
  // Three 4-wide tiles do not fit 8 columns: Gamma wraps below Alpha.
  expect((await panelPixels(panel('Gamma'))).top).toBeGreaterThan((await panelPixels(panel('Alpha'))).top);
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Move Gamma. Use arrow keys; Shift and arrow keys resize.' });
  await handle.press('ArrowLeft');
  const [alpha, beta, gamma] = await Promise.all(['Alpha', 'Beta', 'Gamma'].map(name => panelPixels(panel(name))));
  expect(gamma.top).toBe(alpha.top);
  expect(gamma.left).toBeGreaterThan(alpha.left);
  expect(beta.top).toBeGreaterThan(alpha.top);
  expect(beta.left).toBe(alpha.left);
  await page.getByRole('button', { name: 'Save arrangement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save arrangement', exact: true })).toHaveCount(0);
  const saved = await studioApi(request, '/__studio/api/board');
  const rect = name => saved.board.panels.find(item => item.title === name).rect;
  expect(rect('Alpha')).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  expect(rect('Gamma')).toEqual({ x: 4, y: 0, w: 4, h: 3 });
  expect(rect('Beta')).toEqual({ x: 8, y: 0, w: 4, h: 3 });
  await handle.press('ArrowRight');
  expect((await panelPixels(panel('Beta'))).top).toBe((await panelPixels(panel('Alpha'))).top);
  expect((await panelPixels(panel('Gamma'))).top).toBeGreaterThan((await panelPixels(panel('Alpha'))).top);
});

test.describe('interrupted touch arrangement', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a second finger cancels the first arrangement and restores its original position', async ({ page, request }) => {
    await seedServicePanels(request, serviceSlots());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
    const handle = page.getByRole('button', { name: 'Move Beta. Use arrow keys; Shift and arrow keys resize.' });
    await handle.scrollIntoViewIfNeeded();
    const bounds = await handle.boundingBox();
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const point = (id, px, py) => ({ id, x: px, y: py, radiusX: 5, radiusY: 5, force: 1 });
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, x, y)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, x, y + 88)] });
      await expect(page.locator('.studio-moving')).toHaveCount(1);
      // The narrow toolbar hides its secondary status text; the dirty state
      // still exists and its Save action must be available before cancellation.
      await expect(page.getByText('Unsaved arrangement', { exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Save arrangement', exact: true })).toBeEnabled();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, x, y + 88), point(2, x - 100, y + 88)] });
      await expect(page.locator('.studio-moving')).toHaveCount(0);
      await expect(page.getByText('Unsaved arrangement', { exact: true })).toHaveCount(0);
      expect((await panelPixels(page.locator('[data-panel-id][aria-label="Beta"]'))).top).toBe(264);
    } finally {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
  });
});

test('a snapshot restore protects browser departure for the entire pending write', async ({ page, request }) => {
  await seedStack(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dashboard settings', exact: true }).click();
  await page.getByRole('button', { name: /Snapshots & restore/ }).click();
  await page.locator('.studio-snapshot').first().click();
  let release;
  let pending = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/__studio/api/restore', async route => { pending = true; await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Restore selected snapshot', exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    expect(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
  } finally { release(); }
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
