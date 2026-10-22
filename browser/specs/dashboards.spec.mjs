import { expect, saveFiles, studioApi, test } from '../helpers/dashboard.mjs';
import { archiveFixtures, dashboardPath, dashboardSave, fixtureId, openDashboardManager, privateUpstreamFixture, registryMutation } from '../helpers/dashboards.mjs';
import { NATIVE_FILES } from '../helpers/engineering.mjs';

function nativeFiles(state) {
  return Object.fromEntries(NATIVE_FILES.map(([file, field]) => {
    expect(typeof state[field], `${file} is present in native state`).toBe('string');
    return [file, state[field]];
  }));
}

test('dashboard management creates independent pages, duplicates complete configuration and preserves archived addresses', async ({ page, request }) => {
  const suffix = fixtureId();
  const guestName = `Guest ${suffix}`;
  const renamedName = `Shared ${suffix}`;
  const copyName = `Admin copy ${suffix}`;
  const ids = [];
  await saveFiles(request, { widgetsYaml: JSON.stringify([{ greeting: { text: `Admin original ${suffix}` } }]), customCss: ':root { --dashboard-fixture: admin; }' });
  const root = await studioApi(request, '/__studio/api/state');
  try {
    await page.goto('/');
    let dialog = await openDashboardManager(page);
    await dialog.getByRole('button', { name: 'Create dashboard', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Dashboard name', exact: true }).fill(guestName);
    await dialog.getByRole('textbox', { name: 'Address slug', exact: true }).fill(`guest-${suffix}`);
    await dialog.getByRole('button', { name: 'Create dashboard', exact: true }).click();
    await expect(dialog.getByRole('region', { name: `Dashboard ${guestName}`, exact: true })).toBeVisible();
    let registry = await studioApi(request, '/__studio/api/dashboards');
    const guest = registry.dashboards.find(entry => entry.name === guestName);
    ids.push(guest.id);
    expect((await studioApi(request, dashboardPath(guest, '/__studio/api/state'))).board.panels).toEqual([]);
    await dashboardSave(request, guest, { widgetsYaml: JSON.stringify([{ greeting: { text: `Guest private ${suffix}` } }]), customCss: ':root { --dashboard-fixture: guest; }', settingsYaml: 'studioTheme:\n  mode: light\n  accent: "#215c95"\n' });

    const defaultEntry = registry.dashboards.find(entry => entry.id === 'default');
    await dialog.getByRole('button', { name: `Duplicate ${defaultEntry.name}`, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Dashboard name', exact: true }).fill(copyName);
    await dialog.getByRole('textbox', { name: 'Address slug', exact: true }).fill(`copy-${suffix}`);
    await dialog.getByRole('button', { name: 'Create dashboard', exact: true }).click();
    await expect(dialog.getByRole('region', { name: `Dashboard ${copyName}`, exact: true })).toBeVisible();
    registry = await studioApi(request, '/__studio/api/dashboards');
    const copy = registry.dashboards.find(entry => entry.name === copyName);
    ids.push(copy.id);
    const copied = await studioApi(request, dashboardPath(copy, '/__studio/api/state'));
    expect(nativeFiles(copied)).toEqual(nativeFiles(root));
    expect(copied.board.panels).toEqual(root.board.panels);
    await dashboardSave(request, copy, { widgetsYaml: JSON.stringify([{ greeting: { text: `Copy only ${suffix}` } }]), customCss: ':root { --dashboard-fixture: copy; }' });
    expect(nativeFiles(await studioApi(request, '/__studio/api/state'))).toEqual(nativeFiles(root));

    await dialog.getByRole('button', { name: `Edit ${guestName}`, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Dashboard name', exact: true }).fill(renamedName);
    await dialog.getByRole('textbox', { name: 'Address slug', exact: true }).fill(`shared-${suffix}`);
    await dialog.getByRole('button', { name: 'Save dashboard', exact: true }).click();
    await expect(dialog.getByRole('region', { name: `Dashboard ${renamedName}`, exact: true })).toBeVisible();
    const renamed = { ...guest, name: renamedName, slug: `shared-${suffix}` };
    expect((await request.get(dashboardPath(guest))).status()).toBe(404);
    await dialog.getByRole('button', { name: `Open ${renamedName}`, exact: true }).click();
    await expect(page).toHaveURL(new URL(dashboardPath(renamed), process.env.STUDIO_BROWSER_ORIGIN).href.replace(/\/$/, ''));
    await expect(page.getByText(`Guest private ${suffix}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Admin original ${suffix}`, { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dashboard-fixture').trim())).toBe('guest');
    await expect(page.locator('.studio-brand')).toHaveAttribute('href', `/${renamed.slug}`);
    await page.reload();
    await expect(page.getByText(`Guest private ${suffix}`, { exact: true })).toBeVisible();

    // The root remains accessible and owns its original native configuration.
    await page.goto('/');
    await expect(page.getByText(`Admin original ${suffix}`, { exact: true })).toBeVisible();
    dialog = await openDashboardManager(page);
    await dialog.getByRole('button', { name: `Archive ${renamedName}`, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Archive dashboard', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'I want to archive this dashboard', exact: true }).check();
    await dialog.getByRole('button', { name: 'Archive dashboard', exact: true }).click();
    await expect(dialog.getByRole('region', { name: `Archived dashboard ${renamedName}`, exact: true })).toBeVisible();
    expect((await request.get(dashboardPath(renamed))).status()).toBe(404);
    registry = await studioApi(request, '/__studio/api/dashboards');
    const reserved = await request.post('/__studio/api/dashboards', {
      headers: { origin: process.env.STUDIO_BROWSER_ORIGIN, 'x-studio-request': '1' },
      data: { action: 'create', revision: registry.revision, name: 'Reserved fixture', slug: renamed.slug },
    });
    expect(reserved.status()).toBe(409);
    await dialog.getByRole('button', { name: `Restore ${renamedName}`, exact: true }).click();
    await expect(dialog.getByRole('region', { name: `Dashboard ${renamedName}`, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: `Open ${renamedName}`, exact: true }).click();
    await expect(page.getByText(`Guest private ${suffix}`, { exact: true })).toBeVisible();
    expect(nativeFiles(await studioApi(request, '/__studio/api/state'))).toEqual(nativeFiles(root));
  } finally {
    await page.goto('/');
    await archiveFixtures(request, ids);
  }
});

test('dashboard manager retains conflicts and dirty drafts and keeps pending dialog focus contained', async ({ page, request }) => {
  const suffix = fixtureId();
  const created = await registryMutation(request, 'create', { name: `Draft ${suffix}`, slug: `draft-${suffix}` });
  const id = created.dashboard.id;
  let release;
  try {
    await page.goto('/');
    const dialog = await openDashboardManager(page);
    await dialog.getByRole('button', { name: `Edit Draft ${suffix}`, exact: true }).click();
    const name = dialog.getByRole('textbox', { name: 'Dashboard name', exact: true });
    await name.fill(`Retained ${suffix}`);
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(name).toHaveValue(`Retained ${suffix}`);
    await registryMutation(request, 'update', { id, name: `External ${suffix}`, slug: `draft-${suffix}` });
    await dialog.getByRole('button', { name: 'Save dashboard', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Your draft is still here');
    await expect(name).toHaveValue(`Retained ${suffix}`);
    await expect(dialog.getByRole('button', { name: 'Save dashboard', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Review latest dashboard list', exact: true }).click();
    await expect(dialog.getByText(new RegExp(`Currently saved: External ${suffix}`))).toBeVisible();
    await expect(name).toHaveValue(`Retained ${suffix}`);
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/__studio/api/dashboards', async route => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    const pending = page.waitForRequest(req => req.url().endsWith('/__studio/api/dashboards') && req.method() === 'POST');
    await dialog.getByRole('button', { name: 'Save dashboard', exact: true }).click();
    await pending;
    await expect(name).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.open && (element.contains(document.activeElement) || document.activeElement === element))).toBe(true);
    release();
    await expect(dialog.getByRole('region', { name: `Dashboard Retained ${suffix}`, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeEnabled();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: 'wait' });
    await page.goto('/');
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
    await page.goto('/');
    await archiveFixtures(request, ids);
    await upstream.close();
  }
});
