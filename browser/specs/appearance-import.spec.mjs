import { expect, saveFiles, studioApi, test } from '../helpers/dashboard.mjs';
import { downloadText, fileText, NATIVE_FILES, openFiles, playback, seedNative } from '../helpers/engineering.mjs';

const token = (page, name) => page.evaluate(key => getComputedStyle(document.documentElement).getPropertyValue(key).trim(), name);
async function settingsDialog(page) {
  await page.getByRole('button', { name: 'Dashboard settings', exact: true }).click();
  return page.getByRole('dialog');
}

test('appearance persists, follows device changes and preserves native state and explicit custom CSS overrides', async ({ page, request }) => {
  await seedNative(request, {
    widgetsYaml: '- search:\n    provider: duckduckgo\n    showSearchSuggestions: false\n    focus: false\n',
    settingsYaml: 'title: Appearance fixture\nx-retained: null\n',
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const search = page.locator('[data-panel-kind="informationWidget"]').getByRole('combobox');
  await search.fill('A native query that survives theme changes');
  const originalInput = await search.elementHandle();
  let dialog = await settingsDialog(page);
  await dialog.getByLabel('Display mode', { exact: true }).selectOption('system');
  await dialog.getByRole('button', { name: 'Ocean', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect.poll(() => token(page, '--studio-bg')).toBe('#f4f3f6');
  const saved = await studioApi(request, '/__studio/api/state');
  expect(saved.settingsConfig).toMatchObject({ title: 'Appearance fixture', 'x-retained': null, studioTheme: { mode: 'system', accent: '#81a8c8' } });
  await expect(search).toHaveValue('A native query that survives theme changes');
  expect(await search.evaluate((node, before) => node === before, originalInput)).toBe(true);
  const history = await studioApi(request, '/__studio/api/backups');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect.poll(() => token(page, '--studio-bg')).toBe('#111115');
  expect(await studioApi(request, '/__studio/api/backups')).toEqual(history);

  dialog = await openFiles(page);
  await (await fileText(dialog, 'custom.css')).fill(':root { --studio-accent: #c1b6cc; }\n');
  await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => token(page, '--studio-accent')).toBe('#c1b6cc');
  dialog = await settingsDialog(page);
  await dialog.getByRole('button', { name: 'Sage', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // Next replaces its generated head style during this save. The user's CSS
  // must still win regardless of the resulting order of the head elements.
  await expect.poll(() => token(page, '--studio-accent')).toBe('#c1b6cc');
  await expect(search).toHaveValue('A native query that survives theme changes');
  expect(await search.evaluate((node, before) => node === before, originalInput)).toBe(true);
  await page.reload();
  await expect.poll(() => token(page, '--studio-accent')).toBe('#c1b6cc');
  expect((await studioApi(request, '/__studio/api/state')).settingsConfig.studioTheme).toEqual({ mode: 'system', accent: '#91b09e' });
});

test('a downloaded dashboard imports only after confirmation and restores exact native files, identities and stacks', async ({ page, request }) => {
  const original = await seedNative(request, {
    servicesYaml: '# Preserved native comment\n- Links:\n    - Reference:\n        href: https://example.test/reference\n        x-retained: null\n',
    widgetsYaml: '- greeting:\n    text: Imported first greeting\n- greeting:\n    text: Imported second greeting\n',
    bookmarksYaml: '- Bookmarks:\n    - Documentation:\n        - href: https://example.test/docs\n',
    settingsYaml: 'title: Portable dashboard\nstudioTheme:\n  mode: light\n  accent: "#91b09e"\n',
    customCss: ':root { --studio-import-fixture: 17; }\n',
  }, board => {
    const greetings = board.panels.filter(panel => panel.kind === 'informationWidget');
    greetings.forEach(panel => { panel.rect = { x: 0, y: 0, w: 4, h: 3 }; });
    board.panels.filter(panel => panel.kind !== 'informationWidget').forEach((panel, index) => { panel.rect = { x: 6, y: index * 3, w: 4, h: 3 }; });
    board.stacks = [{ id: 'portable-stack', panelIds: greetings.map(panel => panel.id).reverse(), rect: { x: 0, y: 0, w: 4, h: 3 }, playback: playback() }];
  });
  await page.goto('/');
  let dialog = await openFiles(page);
  const exported = await downloadText(page, () => dialog.getByRole('button', { name: 'Export saved dashboard', exact: true }).click());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const replacement = await saveFiles(request, {
    servicesYaml: '[]\n', widgetsYaml: '[]\n', bookmarksYaml: '[]\n', settingsYaml: 'title: Before import\n', customCss: '',
  });
  const before = await studioApi(request, '/__studio/api/backups');
  await page.reload();
  dialog = await settingsDialog(page);
  await dialog.getByRole('button', { name: /Snapshots & restore/ }).click();
  dialog = page.getByRole('dialog');
  const picker = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Choose dashboard backup', exact: true }).press('Enter');
  await (await picker).setFiles({ name: exported.name, mimeType: 'application/json', buffer: Buffer.from(exported.text) });
  await expect(dialog.getByRole('status')).toContainText(`Replace this dashboard with ${exported.name}?`);
  expect((await studioApi(request, '/__studio/api/state')).revision).toBe(replacement.revision);
  expect(await studioApi(request, '/__studio/api/backups')).toEqual(before);
  await dialog.getByRole('button', { name: 'Import dashboard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const imported = await studioApi(request, '/__studio/api/state');
  const archive = JSON.parse(exported.text);
  for (const [name, key] of NATIVE_FILES) expect(imported[key]).toBe(archive.files[name]);
  expect(imported.board).toEqual(original.board);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Portable dashboard');
  await expect(page.locator('[data-stack-id]:not([aria-hidden="true"])')).toContainText('Imported second greeting');
  await expect.poll(() => token(page, '--studio-import-fixture')).toBe('17');
  const added = (await studioApi(request, '/__studio/api/backups')).filter(item => !before.some(previous => previous.id === item.id));
  expect(added).toHaveLength(1);
  expect(added[0].revision).toBe(replacement.revision);
  await page.reload();
  expect((await studioApi(request, '/__studio/api/board')).board).toEqual(original.board);
  await expect(page.locator('[data-stack-id]:not([aria-hidden="true"])')).toContainText('Imported second greeting');
});
