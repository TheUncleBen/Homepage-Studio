import { addInformation, expect, openEditor, test } from '../helpers/dashboard.mjs';
import { seedNative } from '../helpers/engineering.mjs';

// Owner feedback on 65f724c: fillers (U6), Show on per layout (D2), the
// centred search bar (F2) and the docked widget editor (T26).

test('fillers: a heading and a note show on the dashboard, a note stays text, and a spacer is invisible there', async ({ page }) => {
  await openEditor(page);
  await addInformation(page, 'Heading', 'text: Media\n');
  await addInformation(page, 'Note', 'text: "Guest Wi-Fi: Garden\\n<b>not bold</b> https://wiki.example.test/a."\n');
  await addInformation(page, 'Spacer', '{}\n');
  await expect(page.locator('.studio-filler-spacer')).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 2, name: 'Media' })).toBeVisible();
  const note = page.locator('.studio-filler-note');
  await expect(note).toContainText('<b>not bold</b>');
  await expect(note.locator('b')).toHaveCount(0);
  await expect(note.getByRole('link', { name: 'https://wiki.example.test/a' })).toHaveAttribute('rel', 'noopener noreferrer');
  const spacer = page.locator('[data-panel-kind="informationWidget"]').filter({ has: page.locator('.studio-filler-spacer') });
  await expect(spacer).toHaveCSS('box-shadow', 'none');
  await expect(spacer.locator('.studio-filler-spacer > span')).toBeHidden();
});

test('Show on keeps a widget off the layouts it leaves out', async ({ page, request }) => {
  await seedNative(request, {
    widgetsYaml: JSON.stringify([{ greeting: { text: 'Everywhere' } }, { greeting: { text: 'Desktop only' } }]),
  }, board => {
    const only = board.panels.find(panel => panel.nativeLocator?.index === 1);
    only.behaviour = { showOn: 'desktop' };
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Desktop only', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Everywhere', { exact: true })).toBeVisible();
  await expect(page.getByText('Desktop only', { exact: true })).toBeHidden();
});

test('the search bar sits in the top bar on wide screens and the icon replaces it on phones', async ({ page }) => {
  await page.goto('/dashboard');
  const search = page.getByRole('button', { name: 'Search', exact: true });
  await expect(search).toHaveCount(1);
  await expect(search).toHaveClass(/studio-search-bar/);
  await expect(search).toContainText('Start typing');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(search).toHaveCount(1);
  await expect(search).toHaveClass(/studio-search-icon/);
});

test('on a wide screen the widget editor docks beside the board and keeps the desktop layout', async ({ page, request }) => {
  await seedNative(request, { widgetsYaml: JSON.stringify([{ greeting: { text: 'Docked fixture' } }, { greeting: { text: 'Second fixture' } }]) });
  await openEditor(page);
  await page.getByRole('button', { name: 'Edit Greeting', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveClass(/studio-dialog-docked/);
  await expect(page.getByText('Docked fixture', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Layout size' }).getByRole('button', { name: 'Desktop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The board beside it stays usable (UI review H1): not modal, no sideways
  // scroll, another widget's edit switches the panel, Esc closes it.
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Edit Greeting 2', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit Greeting 2' })).toBeVisible();
  await dialog.getByRole('button', { name: /^Settings/ }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Greeting', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('dialog')).not.toHaveClass(/studio-dialog-docked/);
});
