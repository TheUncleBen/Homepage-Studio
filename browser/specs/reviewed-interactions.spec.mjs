import { DASHBOARDS, expect, expectSaved, mouseDrag, openEditor, openSettings, panelPixels, rowStep, seedServicePanels, studioApi, test } from '../helpers/dashboard.mjs';
import { activePanel, carousel, playback } from '../helpers/engineering.mjs';

const serviceSlots = () => ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ name, rect: { x: index * 6, y: 0, w: 6, h: 3 } }));

async function seedStack(request, members = 3, transition = 'horizontal', overrides = {}) {
  const saved = await seedServicePanels(request, serviceSlots().slice(0, members));
  saved.board.stacks = [{
    id: 'reviewed-interactions', panelIds: saved.board.panels.map(panel => panel.id),
    rect: { x: 0, y: 0, w: 4, h: 3 }, playback: playback({ transition, transitionDurationMs: 500, ...overrides }),
  }];
  return studioApi(request, '/dashboard/studio/api/board', { revision: saved.revision, board: saved.board });
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

test('a short press on the stack released outside it neither edits nor leaves playback suspended', async ({ page, request }) => {
  await seedStack(request);
  await page.goto('/dashboard');
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

test('Search freezes the remaining playback interval and resumes without a catch-up tick', async ({ page, request }) => {
  await seedStack(request);
  await page.clock.install({ time: new Date('2026-10-22T12:00:00Z') });
  await page.goto('/dashboard');
  const stack = carousel(page);
  await expect(stack).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-22T13:00:00Z'));
  const first = await activePanel(page).getAttribute('data-panel-id');
  const snapshots = await studioApi(request, '/dashboard/studio/api/backups');
  await stack.getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await page.clock.fastForward(500);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Waiting');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', first);
  await page.keyboard.press('Escape');
  await expect(stack.locator('.studio-playback-status')).toHaveText('Playing');
  await page.clock.fastForward(1499);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', first);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', first);
  expect(await studioApi(request, '/dashboard/studio/api/backups')).toEqual(snapshots);
});

test('opening Search during a held stack page dot never starts editing', async ({ page, request }) => {
  await seedStack(request);
  await page.goto('/dashboard');
  const bounds = await carousel(page).getByRole('button', { name: /, 1 of \d+$/ }).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search this dashboard and the web', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.locator('.studio-app')).not.toHaveClass(/studio-edit-mode/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

for (const transition of ['horizontal', 'vertical']) {
  for (const members of [2, 3]) {
    test(`${members}-member ${transition} wrap keeps the requested direction and stable hosts during rapid reversal`, async ({ page, request }) => {
      const saved = await seedStack(request, members, transition);
      const ids = saved.board.stacks[0].panelIds;
      const axis = transition === 'vertical' ? 'Y' : 'X';
      await page.goto('/dashboard');
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
  await page.goto('/dashboard');
  await expect(carousel(page)).toBeVisible();
  await armWrapCapture(page, ids[0]);
  await carousel(page).getByRole('button', { name: 'Play slideshow', exact: true }).click();
  const frames = await page.evaluate(() => window.__reviewedWrap);
  expect(frames.some(sequence => sequence[0].transform === 'translateX(100%)' && sequence.at(-1).transform === 'none')).toBe(true);
  expect(await page.locator(`[data-panel-id="${ids.at(-1)}"] .studio-panel-slide`).evaluate(node => node.style.transform)).toBe('translateX(-100%)');
});

// Wide enough that a phone shows one per row, stacked as on desktop.
const wideSlots = () => ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ name, rect: { x: 0, y: index * 3, w: 12, h: 3 } }));
const desktopRects = { Alpha: { x: 0, y: 0, w: 12, h: 3 }, Beta: { x: 0, y: 3, w: 12, h: 3 }, Gamma: { x: 0, y: 6, w: 12, h: 3 } };

// Each size keeps its own layout (board 22): arranging on a phone or tablet
// changes that size only, and saves as you go.
for (const input of ['pointer', 'keyboard']) {
  test(`a phone row can move upward by ${input} and persist in the phone layout only`, async ({ page, request }) => {
    await seedServicePanels(request, wideSlots());
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    const beta = page.locator('[data-panel-id][aria-label="Beta"]');
    await expect(beta).toBeVisible();
    // Phones show one widget per row: Beta is in the second row.
    const below = (await panelPixels(beta)).top;
    expect(below).toBeGreaterThan((await panelPixels(page.locator('[data-panel-id][aria-label="Alpha"]'))).top);
    await page.evaluate(() => { window.__reviewedHost = document.querySelector('[data-panel-id][aria-label="Beta"]'); });
    const handle = page.getByRole('button', { name: 'Move Beta. Use arrow keys; Shift and arrow keys resize.' });
    if (input === 'pointer') await mouseDrag(page, handle, 0, -below);
    // One row per press.
    else {
      const step = await rowStep(page);
      for (let row = 0; row < Math.round(below / step); row += 1) await handle.press('ArrowUp');
    }
    await expect.poll(async () => (await panelPixels(beta)).top).toBe(0);
    expect(await page.evaluate(() => window.__reviewedHost === document.querySelector('[data-panel-id][aria-label="Beta"]'))).toBe(true);
    await expect.poll(async () => (await studioApi(request, '/dashboard/studio/api/board')).board.layouts?.phone).toBeTruthy();
    await expectSaved(page);
    const saved = (await studioApi(request, '/dashboard/studio/api/board')).board;
    const id = name => saved.panels.find(panel => panel.title === name).id;
    expect(saved.layouts.phone[id('Beta')]).toMatchObject({ y: 0 });
    expect(saved.layouts.phone[id('Alpha')].y).toBeGreaterThanOrEqual(3);
    expect(saved.layouts.tablet).toBeUndefined();
    for (const [name, rect] of Object.entries(desktopRects)) expect(saved.panels.find(panel => panel.title === name).rect).toEqual(rect);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForURL(`**${DASHBOARDS}`);
    // Desktop keeps its own order; the phone keeps the new one.
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto('/dashboard');
    await expect(beta).toBeVisible();
    expect((await panelPixels(page.locator('[data-panel-id][aria-label="Alpha"]'))).top).toBe(0);
    expect((await panelPixels(beta)).top).toBeCloseTo(3 * (await rowStep(page)), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(beta).toBeVisible();
    expect((await panelPixels(beta)).top).toBe(0);
  });
}

test('on a tablet a move changes the tablet layout only and survives reload', async ({ page, request }) => {
  await seedServicePanels(request, serviceSlots());
  await page.setViewportSize({ width: 820, height: 1180 });
  await openEditor(page);
  const panel = name => page.locator(`[data-panel-id][aria-label="${name}"]`);
  await expect(panel('Gamma')).toBeVisible();
  // A tablet shows halves, so a row of three wraps: Gamma goes below Alpha.
  const before = await panelPixels(panel('Gamma'));
  expect(before.top).toBeGreaterThan((await panelPixels(panel('Alpha'))).top);
  const handle = page.getByRole('button', { name: 'Move Gamma. Use arrow keys; Shift and arrow keys resize.' });
  const step = await rowStep(page);
  await handle.press('ArrowDown');
  await expect.poll(async () => (await panelPixels(panel('Gamma'))).top).toBeCloseTo(before.top + step, 1);
  await expect.poll(async () => (await studioApi(request, '/dashboard/studio/api/board')).board.layouts?.tablet).toBeTruthy();
  await expectSaved(page);
  const saved = (await studioApi(request, '/dashboard/studio/api/board')).board;
  const rect = name => saved.panels.find(item => item.title === name).rect;
  expect(rect('Alpha')).toEqual({ x: 0, y: 0, w: 6, h: 3 });
  expect(rect('Beta')).toEqual({ x: 6, y: 0, w: 6, h: 3 });
  expect(rect('Gamma')).toEqual({ x: 12, y: 0, w: 6, h: 3 });
  expect(saved.layouts.phone).toBeUndefined();
  // Undo puts it back, and that saves too.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await panelPixels(panel('Gamma'))).top).toBe(before.top);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await panelPixels(panel('Gamma'))).top).toBeCloseTo(before.top + step, 1);
  await expectSaved(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await expect.poll(async () => (await panelPixels(panel('Gamma'))).top).toBeCloseTo(before.top + step, 1);
});

test.describe('interrupted touch arrangement', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a second finger cancels the first arrangement and restores its original position', async ({ page, request }) => {
    await seedServicePanels(request, wideSlots());
    await openEditor(page);
    const handle = page.getByRole('button', { name: 'Move Beta. Use arrow keys; Shift and arrow keys resize.' });
    // On a touch screen a widget shows its controls once tapped.
    await page.locator('[data-panel-id][aria-label="Beta"]').tap();
    await handle.scrollIntoViewIfNeeded();
    const bounds = await handle.boundingBox();
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const point = (id, px, py) => ({ id, x: px, y: py, radiusX: 5, radiusY: 5, force: 1 });
    const before = (await studioApi(request, '/dashboard/studio/api/board')).revision;
    const top = (await panelPixels(page.locator('[data-panel-id][aria-label="Beta"]'))).top;
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, x, y)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, x, y + 88)] });
      await expect(page.locator('.studio-moving')).toHaveCount(1);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, x, y + 88), point(2, x - 100, y + 88)] });
      await expect(page.locator('.studio-moving')).toHaveCount(0);
      expect((await panelPixels(page.locator('[data-panel-id][aria-label="Beta"]'))).top).toBe(top);
    } finally {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
    // The cancelled move saved nothing and left nothing to undo.
    await page.waitForTimeout(1000);
    expect((await studioApi(request, '/dashboard/studio/api/board')).revision).toBe(before);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect((await panelPixels(page.locator('[data-panel-id][aria-label="Beta"]'))).top).toBe(top);
  });
});

test('a snapshot restore protects browser departure for the entire pending write', async ({ page, request }) => {
  await seedStack(request);
  await (await openSettings(page)).getByRole('button', { name: /Snapshots & restore/ }).click();
  await page.locator('.studio-snapshot').first().click();
  let release;
  let pending = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/studio/api/restore', async route => { pending = true; await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Restore selected snapshot', exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    expect(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
  } finally { release(); }
  await page.waitForURL(`**${DASHBOARDS}`);
});
