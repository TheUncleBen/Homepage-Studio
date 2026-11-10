import { expect, test as base } from '@playwright/test';

export { expect };
export const origin = process.env.STUDIO_BROWSER_ORIGIN;
// The main dashboard's address. Its live page has no editing controls; the
// editor and the settings dialog have addresses of their own.
export const HOME = '/dashboard';
export const DASHBOARDS = '/studio/dashboards';

export async function openEditor(page, base = HOME) {
  await page.goto(`${base}/studio/edit`);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
}

export async function openSettings(page, base = HOME) {
  await page.goto(`${base}/studio/settings`);
  const dialog = page.getByRole('dialog', { name: 'Dashboard settings', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function studioApi(request, route, body) {
  const response = await request.fetch(new URL(route, origin).href, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'x-studio-request': '1' },
    ...(body === undefined ? {} : { data: body }),
  });
  expect(response.status(), `${route}: ${await response.text()}`).toBe(200);
  return response.json();
}

export async function saveFiles(request, changes) {
  const current = await studioApi(request, '/dashboard/studio/api/state');
  const saved = await studioApi(request, '/dashboard/studio/api/save', {
    revision: current.revision,
    ...changes,
  });
  await studioApi(request, '/dashboard/api/revalidate');
  return saved;
}

export async function resetDashboard(request) {
  const saved = await saveFiles(request, {
    servicesYaml: '[]\n',
    widgetsYaml: '[]\n',
    bookmarksYaml: '[]\n',
    settingsYaml: '{}\n',
    dockerYaml: '{}\n',
    kubernetesYaml: '{}\n',
    proxmoxYaml: '{}\n',
    customCss: '',
    customJs: '',
  });
  expect(saved.board.panels).toEqual([]);
  expect(saved.board.stacks).toEqual([]);
}

// Every scenario owns fresh configuration. The existing config requires an
// explicitly disposable deployment, and workers remain serialized.
export const test = base.extend({
  emptyDashboard: [async ({ request }, use) => {
    await resetDashboard(request);
    await use();
  }, { auto: true }],
  browserErrors: [async ({ page }, use) => {
    const failures = [];
    // Leaving the editor or settings page navigates while requests may still
    // be in flight. WebKit reports each request the departing page cancels as
    // an error ("... due to access control checks."); only those, and only
    // while a main-frame navigation is under way, are not failures.
    let departing = false;
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) departing = true; });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) departing = false; });
    page.on('pageerror', error => {
      if (departing && / due to access control checks\.$/.test(error.message)) return;
      failures.push(error.message);
    });
    page.on('response', response => {
      if (response.status() >= 500 && new URL(response.url()).origin === new URL(origin).origin)
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await use();
    expect(failures, 'No uncaught browser errors or local server failures').toEqual([]);
  }, { auto: true }],
});

export async function chooseContent(page, name, category) {
  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (category) await dialog.getByRole('button', { name: category, exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Find a tile or widget' }).fill(name);
  const card = dialog.locator('.studio-catalog-item').filter({
    has: page.locator('strong').filter({ hasText: new RegExp(`^${name}$`, 'i') }),
  });
  await expect(card).toHaveCount(1);
  await card.click();
  return page.getByRole('dialog');
}

export async function addInformation(page, name, yaml) {
  const dialog = await chooseContent(page, name, 'Information');
  await dialog.getByRole('radio', { name: 'YAML', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Item configuration YAML' }).fill(yaml);
  await dialog.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function addBookmark(page, name = 'Browser bookmark') {
  const dialog = await chooseContent(page, 'Bookmark', 'Links');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel(/^Destination URL/).fill('https://example.test/reference');
  await dialog.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return page.locator('[data-panel-kind="bookmark"]').filter({ hasText: name });
}

// The editing bar's save note. Narrow bars hide it from view, so it is read
// by its text, not as a visible status.
export async function expectSaved(page) {
  await expect(page.locator('.studio-edit-bar-note')).toHaveText('Saved');
}

export async function finishArrangement(page) {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForURL(`**${DASHBOARDS}`);
}

export async function setPanelSize(page, title, width, height) {
  for (const checkbox of await page.getByRole('checkbox', { name: /^Select / }).all()) await checkbox.uncheck();
  const selected = page.getByRole('checkbox', { name: `Select ${title}`, exact: true });
  await selected.check();
  await page.getByRole('button', { name: 'Size', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill(String(width));
  await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill(String(height));
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await selected.uncheck();
}

// A stack adds room for its own controls, so stacking widgets resizes them
// and the stack's settings open first to show the new size.
export async function stackSelected(page) {
  await page.getByRole('button', { name: 'Stack', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit widget stack', exact: true });
  await expect(dialog.getByRole('status')).toContainText(/will (all )?be \d+ × \d+/);
  await dialog.getByRole('button', { name: 'Apply to arrangement', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function seedServicePanels(request, items) {
  const state = await saveFiles(request, {
    servicesYaml: JSON.stringify([{ Fixtures: items.map(({ name }) => ({ [name]: { href: 'https://example.test/' } })) }]),
  });
  const board = state.board;
  for (const item of items) board.panels.find(panel => panel.title === item.name).rect = item.rect;
  return studioApi(request, '/dashboard/studio/api/board', { revision: state.revision, board });
}

// One row of the board as drawn now: rows scale with the columns' width
// (mock-ups v4, board 5), so a row is 48 px (36 + the 12 px gap) only at the
// reference width of each layout.
export async function rowStep(page) {
  return page.locator('.studio-canvas').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--studio-grid-row')));
}

export async function panelPixels(panel) {
  return panel.evaluate(element => Object.fromEntries(['left', 'top', 'width', 'height'].map(key => [key, parseFloat(element.style[key])])));
}

export async function mouseDrag(page, handle, dx, dy, beforeRelease) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  if (beforeRelease) await beforeRelease();
  await page.mouse.up();
}

export async function touchSession(page) {
  const session = await page.context().newCDPSession(page);
  const points = (x, y) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
  return {
    start: (x, y) => session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(x, y) }),
    async move(from, to, steps = 8) {
      for (let i = 1; i <= steps; i += 1) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps) });
      }
    },
    end: () => session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    detach: () => session.detach(),
  };
}
