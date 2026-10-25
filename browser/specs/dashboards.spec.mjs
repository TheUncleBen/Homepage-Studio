import { DASHBOARDS, expect, saveFiles, studioApi, test } from '../helpers/dashboard.mjs';
import { archiveFixtures, dashboardPath, dashboardSave, fixtureId, privateUpstreamFixture, registryMutation } from '../helpers/dashboards.mjs';
import { NATIVE_FILES } from '../helpers/engineering.mjs';

function nativeFiles(state) {
  return Object.fromEntries(NATIVE_FILES.map(([file, field]) => {
    expect(typeof state[field], `${file} is present in native state`).toBe('string');
    return [file, state[field]];
  }));
}

const card = (page, name) => page.locator('.dashboard-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

async function moreAction(page, name, action) {
  const entry = card(page, name);
  await entry.locator('summary', { hasText: 'More actions' }).click();
  await entry.getByRole('button', { name: action, exact: true }).click();
}

async function nameAndAddress(page, title, name, slug, submit) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: 'Address', exact: true }).fill(slug);
  await dialog.getByRole('button', { name: submit, exact: true }).click();
  return dialog;
}

test('the Dashboards page creates independent dashboards, duplicates complete configuration and preserves archived addresses', { tag: '@cross-engine' }, async ({ page, request }) => {
  const suffix = fixtureId();
  const guestName = `Guest ${suffix}`;
  const renamedName = `Shared ${suffix}`;
  const copyName = `Admin copy ${suffix}`;
  const ids = [];
  await saveFiles(request, { widgetsYaml: JSON.stringify([{ greeting: { text: `Admin original ${suffix}` } }]), customCss: ':root { --dashboard-fixture: admin; }' });
  const root = await studioApi(request, '/dashboard/studio/api/state');
  try {
    // With sign-in off, the bare address opens the Dashboards page.
    await page.goto('/');
    await page.waitForURL(`**${DASHBOARDS}`);
    await page.getByRole('button', { name: 'New dashboard', exact: true }).click();
    let dialog = await nameAndAddress(page, 'New dashboard', guestName, `guest-${suffix}`, 'Create dashboard');
    await expect(dialog).toHaveCount(0);
    await expect(card(page, guestName)).toBeVisible();
    let registry = await studioApi(request, '/studio/api/dashboards');
    const guest = registry.dashboards.find(entry => entry.name === guestName);
    ids.push(guest.id);
    expect((await studioApi(request, dashboardPath(guest, '/studio/api/state'))).board.panels).toEqual([]);
    await dashboardSave(request, guest, { widgetsYaml: JSON.stringify([{ greeting: { text: `Guest private ${suffix}` } }]), customCss: ':root { --dashboard-fixture: guest; }', settingsYaml: 'studioTheme:\n  mode: light\n  accent: "#215c95"\n' });

    const defaultEntry = registry.dashboards.find(entry => entry.id === 'default');
    await moreAction(page, defaultEntry.name, 'Duplicate');
    dialog = await nameAndAddress(page, `Duplicate ${defaultEntry.name}`, copyName, `copy-${suffix}`, 'Duplicate');
    await expect(dialog).toHaveCount(0);
    await expect(card(page, copyName)).toBeVisible();
    registry = await studioApi(request, '/studio/api/dashboards');
    const copy = registry.dashboards.find(entry => entry.name === copyName);
    ids.push(copy.id);
    const copied = await studioApi(request, dashboardPath(copy, '/studio/api/state'));
    expect(nativeFiles(copied)).toEqual(nativeFiles(root));
    expect(copied.board.panels).toEqual(root.board.panels);
    await dashboardSave(request, copy, { widgetsYaml: JSON.stringify([{ greeting: { text: `Copy only ${suffix}` } }]), customCss: ':root { --dashboard-fixture: copy; }' });
    expect(nativeFiles(await studioApi(request, '/dashboard/studio/api/state'))).toEqual(nativeFiles(root));

    await moreAction(page, guestName, 'Rename or change address');
    dialog = await nameAndAddress(page, `Rename ${guestName}`, renamedName, `shared-${suffix}`, 'Save');
    await expect(dialog).toHaveCount(0);
    await expect(card(page, renamedName)).toBeVisible();
    const renamed = { ...guest, name: renamedName, slug: `shared-${suffix}` };
    expect((await request.get(dashboardPath(guest))).status()).toBe(404);
    await card(page, renamedName).getByRole('link', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(new URL(dashboardPath(renamed), process.env.STUDIO_BROWSER_ORIGIN).href.replace(/\/$/, ''));
    await expect(page.getByText(`Guest private ${suffix}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Admin original ${suffix}`, { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dashboard-fixture').trim())).toBe('guest');
    // The top bar's mark leads back to the Dashboards page from any dashboard.
    await expect(page.locator('.studio-brand')).toHaveAttribute('href', DASHBOARDS);
    await page.reload();
    await expect(page.getByText(`Guest private ${suffix}`, { exact: true })).toBeVisible();

    // The main dashboard keeps its original native configuration.
    await page.goto('/dashboard');
    await expect(page.getByText(`Admin original ${suffix}`, { exact: true })).toBeVisible();
    await page.goto(DASHBOARDS);
    await moreAction(page, renamedName, 'Archive');
    dialog = page.getByRole('dialog', { name: `Archive ${renamedName}?`, exact: true });
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const archivedList = page.locator('details.archived-list');
    await archivedList.locator('summary').click();
    await expect(archivedList.getByRole('heading', { name: renamedName, exact: true })).toBeVisible();
    expect((await request.get(dashboardPath(renamed))).status()).toBe(404);
    registry = await studioApi(request, '/studio/api/dashboards');
    const reserved = await request.post('/studio/api/dashboards', {
      headers: { origin: process.env.STUDIO_BROWSER_ORIGIN, 'x-studio-request': '1' },
      data: { action: 'create', revision: registry.revision, name: 'Reserved fixture', slug: renamed.slug },
    });
    expect(reserved.status()).toBe(409);
    await card(page, renamedName).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(card(page, renamedName).getByRole('link', { name: 'Open', exact: true })).toBeVisible();
    await card(page, renamedName).getByRole('link', { name: 'Open', exact: true }).click();
    await expect(page.getByText(`Guest private ${suffix}`, { exact: true })).toBeVisible();
    expect(nativeFiles(await studioApi(request, '/dashboard/studio/api/state'))).toEqual(nativeFiles(root));
  } finally {
    await page.goto('/dashboard');
    await archiveFixtures(request, ids);
  }
});

test('a rename that meets someone else\'s change keeps the draft, shows what is saved, and applies on a second Save', async ({ page, request }) => {
  const suffix = fixtureId();
  const created = await registryMutation(request, 'create', { name: `Draft ${suffix}`, slug: `draft-${suffix}` });
  const id = created.dashboard.id;
  let release;
  try {
    await page.goto(DASHBOARDS);
    await moreAction(page, `Draft ${suffix}`, 'Rename or change address');
    const dialog = page.getByRole('dialog', { name: `Rename Draft ${suffix}`, exact: true });
    const name = dialog.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill(`Retained ${suffix}`);
    await registryMutation(request, 'update', { id, name: `External ${suffix}`, slug: `draft-${suffix}` });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(`Currently saved: External ${suffix}`);
    await expect(dialog.getByRole('alert')).toContainText('Your draft is still here');
    await expect(name).toHaveValue(`Retained ${suffix}`);
    // The list behind the dialog already shows the other change.
    await expect(card(page, `External ${suffix}`)).toHaveCount(1);
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/studio/api/dashboards', async route => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    const pending = page.waitForRequest(req => req.url().endsWith('/studio/api/dashboards') && req.method() === 'POST');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await pending;
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.open && (element.contains(document.activeElement) || document.activeElement === element))).toBe(true);
    release();
    await expect(dialog).toHaveCount(0);
    await expect(card(page, `Retained ${suffix}`)).toBeVisible();
    expect((await studioApi(request, '/studio/api/dashboards')).dashboards.find(entry => entry.id === id).name).toBe(`Retained ${suffix}`);
  } finally {
    release?.();
    await page.unrouteAll({ behavior: 'wait' });
    await page.goto('/dashboard');
    await archiveFixtures(request, [id]);
  }
});

test('concurrent dashboard tabs isolate identical native proxy locators, private authorization, returned cookies and local state', async ({ page, context, request }) => {
  const suffix = fixtureId();
  const upstream = await privateUpstreamFixture();
  const ids = [];
  const other = await context.newPage();
  const errors = [];
  other.on('pageerror', error => errors.push(error.message));
  try {
    const dashboards = [];
    for (const user of upstream.users) {
      const { dashboard } = await registryMutation(request, 'create', { name: `${user.name} ${suffix}`, slug: `${user.name.toLowerCase()}-${suffix}` });
      dashboards.push(dashboard); ids.push(dashboard.id);
      await dashboardSave(request, dashboard, {
        servicesYaml: JSON.stringify([{ 'Same group': [{ 'Same service': { widget: { type: 'customapi', url: upstream.url, headers: { Authorization: `Bearer ${user.token}` }, refreshInterval: 1000, mappings: [{ field: 'owner', label: 'Private owner' }, { field: 'cookie', label: 'Private cookie' }] } } }] }]),
        widgetsYaml: JSON.stringify([{ search: { provider: 'duckduckgo', showSearchSuggestions: false, focus: false } }]),
        customCss: `:root { --dashboard-fixture: ${user.name.toLowerCase()}; }`,
        settingsYaml: `title: ${user.name} independent\nstudioTheme:\n  mode: ${user.name === 'Alpha' ? 'light' : 'dark'}\n`,
      });
    }
    const tabs = [page, other];
    await Promise.all(tabs.map((tab, index) => tab.goto(dashboardPath(dashboards[index]))));
    const nativePath = '/api/services/proxy?group=Same+group&service=Same+service&index=0';
    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index]; const user = upstream.users[index];
      await expect(tab.getByText(`${user.name} private data`, { exact: true })).toBeVisible();
      await tab.getByRole('combobox').fill(`${user.name} tab keeps its query`);
      await expect.poll(() => tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dashboard-fixture').trim())).toBe(user.name.toLowerCase());
      const markup = await tab.content();
      for (const account of upstream.users) expect(markup).not.toContain(account.token);
    }
    // Explicit browser fetches exercise each worker's already-issued cookie,
    // even when browser visibility pauses a background tab's refresh timer.
    for (let round = 0; round < 3; round += 1) {
      const results = await Promise.all(tabs.map((tab, index) => tab.evaluate(async path => {
        const response = await fetch(path, { cache: 'no-store' });
        return { status: response.status, data: await response.json() };
      }, dashboardPath(dashboards[index], nativePath))));
      results.forEach((result, index) => {
        expect(result.status).toBe(200);
        expect(result.data).toEqual({ owner: `${upstream.users[index].name} private data`, cookie: 'Cookie round trip confirmed' });
      });
    }
    expect(upstream.violations).toEqual([]);
    for (const user of upstream.users) expect(upstream.calls.filter(call => call.user === user.name && call.cookieReturned).length).toBeGreaterThanOrEqual(3);
    expect(upstream.calls.some(call => call.foreignCookie)).toBe(false);
    for (let index = 0; index < tabs.length; index += 1) {
      await expect(tabs[index].getByRole('combobox')).toHaveValue(`${upstream.users[index].name} tab keeps its query`);
      await expect(tabs[index].getByText(`${upstream.users[1 - index].name} private data`, { exact: true })).toHaveCount(0);
    }
    expect((await context.cookies()).some(cookie => /studio.*dashboard|active.*dashboard|studio_fixture_session/i.test(cookie.name))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    await page.goto('/dashboard');
    await archiveFixtures(request, ids);
    await upstream.close();
  }
});
