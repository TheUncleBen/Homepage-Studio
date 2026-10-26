import { DASHBOARDS, expect, finishArrangement, openEditor, openSettings, saveFiles, seedServicePanels, studioApi, test } from '../helpers/dashboard.mjs';
import { downloadText, fileText, NATIVE_FILES, openFiles, playback, seedNative } from '../helpers/engineering.mjs';

test('guided settings and nine-file import/export preserve drafts, literal options and one validated transaction', async ({ page, request }) => {
  let dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'YAML', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Item configuration YAML' }).fill([
    'title: Original settings title',
    'target: _self',
    'quicklaunch:',
    '  searchDescriptions: true',
    'x-browser-fixture:',
    '  enabled: false',
    '  labels: [one, two]',
    '  literal: "{{HOMEPAGE_VAR_BROWSER_FIXTURE}}"',
    '',
  ].join('\n'));
  await dialog.getByRole('radio', { name: 'Options', exact: true }).click();
  await dialog.getByLabel(/^Dashboard title/).fill('Configured through settings');
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  // Saved settings return to the Dashboards page.
  await page.waitForURL(`**${DASHBOARDS}`);
  const settingsState = await studioApi(request, '/dashboard/studio/api/state');
  expect(settingsState.settingsConfig).toMatchObject({ title: 'Configured through settings', target: '_self', quicklaunch: { searchDescriptions: true }, 'x-browser-fixture': { enabled: false, labels: ['one', 'two'], literal: '{{HOMEPAGE_VAR_BROWSER_FIXTURE}}' } });

  dialog = await openFiles(page);
  const widgets = '- greeting:\n    text: Imported native greeting\n';
  await fileText(dialog, 'widgets.yaml');
  const fileChooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Replace from a file', exact: true }).focus();
  await page.keyboard.press('Enter');
  await (await fileChooser).setFiles({ name: 'widgets.yaml', mimeType: 'application/yaml', buffer: Buffer.from(widgets) });
  await expect(dialog.getByRole('textbox', { name: 'widgets.yaml', exact: true })).toHaveValue(widgets);
  expect((await studioApi(request, '/dashboard/studio/api/state')).widgetsYaml).toBe(settingsState.widgetsYaml);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'widgets.yaml', exact: true })).toHaveValue(widgets);
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.waitForURL(`**${DASHBOARDS}`);
  expect((await studioApi(request, '/dashboard/studio/api/state')).revision).toBe(settingsState.revision);

  const drafts = {
    servicesYaml: '# Native file editor fixture\n- Fixtures:\n    - Saved service:\n        href: https://example.test/saved\n',
    widgetsYaml: widgets,
    bookmarksYaml: '- References:\n    - Saved bookmark:\n        - href: https://example.test/bookmark\n          abbr: SB\n',
    settingsYaml: `${settingsState.settingsYaml}\n# Native settings retained\n`,
    dockerYaml: '# No Docker connection is configured by this fixture\n{}\n',
    kubernetesYaml: '# No Kubernetes connection is configured by this fixture\n{}\n',
    proxmoxYaml: '# No Proxmox connection is configured by this fixture\n{}\n',
    customCss: ':root { --studio-browser-file-fixture: 42; }\n',
    customJs: "document.documentElement.dataset.studioFileFixture = 'saved';\n",
  };
  dialog = await openFiles(page);
  for (const [name, key] of NATIVE_FILES) await (await fileText(dialog, name)).fill(drafts[key]);
  await expect(dialog.getByText('9 modified files', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Export dashboard', exact: true })).toBeDisabled();
  await fileText(dialog, 'services.yaml');
  const draftExport = await downloadText(page, () => dialog.getByRole('button', { name: 'Download file', exact: true }).click());
  expect(draftExport).toEqual({ name: 'services.yaml', text: drafts.servicesYaml });

  const historyBefore = await studioApi(request, '/dashboard/studio/api/backups');
  await (await fileText(dialog, 'services.yaml')).fill('Fixtures: [\n');
  await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('This change could not be saved');
  expect((await studioApi(request, '/dashboard/studio/api/state')).revision).toBe(settingsState.revision);
  expect(await studioApi(request, '/dashboard/studio/api/backups')).toEqual(historyBefore);
  await expect(await fileText(dialog, 'widgets.yaml')).toHaveValue(drafts.widgetsYaml);
  await (await fileText(dialog, 'services.yaml')).fill(drafts.servicesYaml);
  await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await page.waitForURL(`**${DASHBOARDS}`);
  const saved = await studioApi(request, '/dashboard/studio/api/state');
  for (const [, key] of NATIVE_FILES) expect(saved[key]).toBe(drafts[key]);
  const historyAfter = await studioApi(request, '/dashboard/studio/api/backups');
  const newSnapshots = historyAfter.filter(item => !historyBefore.some(previous => previous.id === item.id));
  expect(newSnapshots).toHaveLength(1);
  expect([...newSnapshots[0].changedFiles].sort()).toEqual([...NATIVE_FILES.map(([name]) => name), 'state.json'].sort());
  // The live dashboard opens with the saved custom CSS and JavaScript.
  await page.goto('/dashboard');
  await expect(page).toHaveTitle('Configured through settings');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--studio-browser-file-fixture').trim())).toBe('42');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.studioFileFixture)).toBe('saved');
  await expect(page.locator('[data-panel-kind="informationWidget"]')).toContainText('Imported native greeting');

  dialog = await openFiles(page);
  const exported = await downloadText(page, () => dialog.getByRole('button', { name: 'Export dashboard', exact: true }).click());
  expect(exported.name).toBe('homepage-studio-configuration.json');
  const payload = JSON.parse(exported.text);
  expect(Object.keys(payload.files).sort()).toEqual([...NATIVE_FILES.map(([name]) => name), 'state.json'].sort());
  for (const [name, key] of NATIVE_FILES) expect(payload.files[name]).toBe(saved[key]);
  expect(JSON.parse(payload.files['state.json']).board).toEqual(saved.board);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('concurrent file and arrangement saves retain the local draft until explicit reload', async ({ page, request }) => {
  await seedServicePanels(request, [{ name: 'Conflict fixture', rect: { x: 0, y: 0, w: 4, h: 3 } }]);
  let dialog = await openFiles(page);
  const draft = `${await (await fileText(dialog, 'services.yaml')).inputValue()}\n# Unsaved local draft\n`;
  await (await fileText(dialog, 'services.yaml')).fill(draft);
  const external = await saveFiles(request, { settingsYaml: 'title: Concurrent native change\n' });
  const history = await studioApi(request, '/dashboard/studio/api/backups');
  await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Another change was saved');
  await expect(dialog.getByRole('textbox', { name: 'services.yaml', exact: true })).toHaveValue(draft);
  expect((await studioApi(request, '/dashboard/studio/api/state')).revision).toBe(external.revision);
  expect(await studioApi(request, '/dashboard/studio/api/backups')).toEqual(history);
  await dialog.getByRole('button', { name: 'Reload current configuration', exact: true }).click();
  await expect(await fileText(dialog, 'settings.yaml')).toHaveValue(external.settingsYaml);
  await expect(dialog.getByRole('button', { name: 'Save configuration', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForURL(`**${DASHBOARDS}`);

  await openEditor(page);
  await page.getByRole('button', { name: /^Move Conflict fixture\. Use arrow keys/ }).press('ArrowDown');
  const tile = page.locator('[data-panel-kind="service"][aria-label="Conflict fixture"]');
  await expect.poll(() => tile.evaluate(element => parseFloat(element.style.top))).toBe(88);
  const externalAgain = await saveFiles(request, { settingsYaml: 'title: A second concurrent change\n' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.studio-error[role="alert"]')).toContainText('Another change was saved');
  await expect.poll(() => tile.evaluate(element => parseFloat(element.style.top))).toBe(88);
  expect((await studioApi(request, '/dashboard/studio/api/board')).revision).toBe(externalAgain.revision);
  await page.getByRole('button', { name: 'Reload current configuration', exact: true }).click();
  await expect.poll(() => tile.evaluate(element => parseFloat(element.style.top))).toBe(0);
  await finishArrangement(page);
});

test('snapshot download and restore recover exact native source identities, stack order and saved geometry', async ({ page, request }) => {
  const previous = await seedNative(request, {
    servicesYaml: '- Fixtures:\n    - Restore service:\n        href: https://example.test/restore\n',
    widgetsYaml: '- greeting:\n    text: First duplicate\n- greeting:\n    text: Second duplicate\n',
    bookmarksYaml: '- References:\n    - Restore bookmark:\n        - href: https://example.test/reference\n',
  }, board => {
    const members = board.panels.filter(panel => panel.kind === 'informationWidget');
    members.forEach((panel, index) => { panel.rect = { x: index * 4, y: 2, w: 4, h: 3 }; });
    board.panels.filter(panel => panel.kind !== 'informationWidget').forEach((panel, index) => { panel.rect = { x: 8, y: index * 3, w: 4, h: 3 }; });
    board.stacks = [{ id: 'restore-stack', panelIds: members.map(panel => panel.id).reverse(), rect: { x: 1, y: 5, w: 5, h: 4 }, playback: playback({ transition: 'fade' }) }];
  });
  await saveFiles(request, { widgetsYaml: '- greeting:\n    text: Changed configuration\n' });
  const backups = await studioApi(request, '/dashboard/studio/api/backups');
  const index = backups.findIndex(backup => backup.revision === previous.revision);
  expect(index).toBeGreaterThanOrEqual(0);
  await (await openSettings(page)).getByRole('button', { name: /Snapshots & restore/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.studio-snapshot').nth(index).click();
  const downloaded = await downloadText(page, () => dialog.getByRole('button', { name: 'Download snapshot', exact: true }).click());
  const snapshot = JSON.parse(downloaded.text);
  expect(snapshot.revision).toBe(previous.revision);
  expect(snapshot.before['widgets.yaml']).toContain('Second duplicate');
  expect(JSON.parse(snapshot.before['state.json']).board).toEqual(previous.board);
  await dialog.getByRole('button', { name: 'Restore selected snapshot', exact: true }).click();
  await page.waitForURL(`**${DASHBOARDS}`);
  expect((await studioApi(request, '/dashboard/studio/api/board')).board).toEqual(previous.board);
  await page.goto('/dashboard');
  await expect(page.locator('[data-panel-id]')).toHaveCount(previous.board.panels.length);
  await expect(page.locator('[aria-roledescription="carousel"]')).toContainText('Greeting');
  await expect(page.locator('[data-stack-id]:not([aria-hidden="true"])')).toContainText('Second duplicate');
  await page.reload();
  expect((await studioApi(request, '/dashboard/studio/api/board')).board).toEqual(previous.board);
  await expect(page.locator('[data-stack-id]:not([aria-hidden="true"])')).toContainText('Second duplicate');
});
