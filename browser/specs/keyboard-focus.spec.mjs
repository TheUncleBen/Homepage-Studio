import { expect, test } from '../helpers/dashboard.mjs';
import { playback, seedNative } from '../helpers/engineering.mjs';

// Board order (and so native host DOM order) deliberately differs from the
// layout: the standalone Lower panel comes first in services.yaml, while the
// stack sits at the top left.
async function seedFocusBoard(request) {
  return seedNative(request, {
    widgetsYaml: JSON.stringify([{ search: { provider: 'duckduckgo', showSearchSuggestions: false, focus: false } }]),
    servicesYaml: JSON.stringify([{ Fixtures: [
      { 'Lower panel': { href: 'https://example.test/lower' } },
      { 'Right panel': { href: 'https://example.test/right' } },
      { 'Stacked first': { href: 'https://example.test/first' } },
      { 'Stacked second': { href: 'https://example.test/second' } },
    ] }]),
  }, board => {
    const byTitle = title => board.panels.find(panel => panel.title === title);
    const search = board.panels.find(panel => panel.nativeLocator?.type === 'search');
    byTitle('Lower panel').rect = { x: 0, y: 6, w: 4, h: 3 };
    byTitle('Right panel').rect = { x: 4, y: 0, w: 4, h: 3 };
    search.rect = { x: 8, y: 0, w: 4, h: 3 };
    const members = [byTitle('Stacked first'), byTitle('Stacked second')];
    for (const member of members) member.rect = { x: 0, y: 0, w: 4, h: 4 };
    board.stacks = [{ id: 'focus-stack', panelIds: members.map(member => member.id), rect: { x: 0, y: 0, w: 4, h: 4 }, playback: playback() }];
  });
}

// Which board unit holds focus: the stack for its shell or active member, the
// panel's title otherwise, and null outside the board.
const focusedUnit = page => page.evaluate(() => {
  const element = document.activeElement;
  if (!element || !document.querySelector('.studio-canvas').contains(element)) return null;
  if (element.closest('[data-stack-shell-id]')) return 'stack';
  const panel = element.closest('[data-panel-id]');
  return panel.dataset.stackId ? 'stack' : panel.getAttribute('aria-label');
});

test('Tab follows the visual reading order of panels and stacks without moving native hosts', async ({ page, request }) => {
  const seeded = await seedFocusBoard(request);
  const searchTitle = seeded.board.panels.find(panel => panel.nativeLocator?.type === 'search').title;
  await page.goto('/');
  const search = page.getByRole('combobox').first();
  await expect(search).toBeVisible();
  await search.fill('kept native state');
  const hosts = await page.evaluate(() => [...document.querySelectorAll('[data-panel-id]')].map(host => {
    host.studioFocusMarker = host.dataset.panelId;
    return host.dataset.panelId;
  }));
  expect(hosts.indexOf(seeded.board.panels.find(panel => panel.title === 'Lower panel').id)).toBeLessThan(
    hosts.indexOf(seeded.board.stacks[0].panelIds[0]),
  );

  // Start on the last toolbar control, immediately before the board.
  await page.evaluate(() => [...document.querySelectorAll('.studio-board-toolbar button:not(:disabled)')].at(-1).focus());
  const visited = [];
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab');
    const unit = await focusedUnit(page);
    if (unit === null) {
      if (visited.length) break;
      continue;
    }
    if (visited.at(-1) !== unit) visited.push(unit);
  }
  // Each unit once, row by row: the top-left stack before the standalone
  // panel below it, which DOM order alone would reach first.
  expect(visited).toEqual(['stack', 'Right panel', searchTitle, 'Lower panel']);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => focusedUnit(page)).toBe('Lower panel');

  // Shift+Tab from the stack shell leaves the board backwards.
  await page.locator('[data-stack-shell-id="focus-stack"]').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await focusedUnit(page)).toBeNull();
  expect(await page.evaluate(() => Boolean(document.activeElement.closest('.studio-board-toolbar')))).toBe(true);

  // The same host elements, in the same DOM order, keep their native state.
  expect(await page.evaluate(() => [...document.querySelectorAll('[data-panel-id]')].map(host => host.studioFocusMarker))).toEqual(hosts);
  await expect(search).toHaveValue('kept native state');
});

test('in edit mode Tab reaches a stack\'s Select checkbox first among its controls, as for a panel', async ({ page, request }) => {
  await seedFocusBoard(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  const shell = page.locator('[data-stack-shell-id="focus-stack"]');
  const checkbox = shell.getByRole('checkbox', { name: 'Select stack Stacked first', exact: true });
  await expect(checkbox).toBeVisible();
  // Start on the last toolbar control, immediately before the board.
  await page.evaluate(() => [...document.querySelectorAll('.studio-board-toolbar button:not(:disabled)')].at(-1).focus());
  await page.keyboard.press('Tab');
  await expect(shell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(shell).toHaveClass(/\bstudio-selected\b/);
  await page.keyboard.press('Tab');
  await expect(shell.getByRole('button', { name: /^Move stack\./ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await expect(shell).not.toHaveClass(/\bstudio-selected\b/);
  // A panel's own order is the same: its checkbox, then its move handle.
  const right = page.getByRole('checkbox', { name: 'Select Right panel', exact: true });
  await right.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Move Right panel\./ })).toBeFocused();
});

test('Studio controls use one focus style while native widgets keep their own', async ({ page, request }) => {
  await seedFocusBoard(request);
  await page.goto('/');
  const focusStyle = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, offset: style.outlineOffset, shadow: style.boxShadow };
  });
  const studioFocus = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--studio-focus)';
    document.querySelector('.studio-app').append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const expected = { outline: `solid 2px ${studioFocus}`, offset: '4px', shadow: 'none' };

  // Keyboard modality, so programmatic focus matches :focus-visible.
  await page.keyboard.press('Tab');
  const brand = page.locator('a.studio-brand');
  await brand.focus();
  expect(await focusStyle(brand)).toEqual(expected);

  // Native Homepage input on the board keeps Homepage's ring.
  const search = page.getByRole('combobox').first();
  await search.click();
  const native = await focusStyle(search);
  expect(native.shadow).not.toBe('none');
  expect(native.offset).not.toBe('4px');

  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Select Right panel', exact: true });
  await page.keyboard.press('Shift');
  await checkbox.focus();
  expect(await focusStyle(checkbox)).toEqual(expected);
  const stackCheckbox = page.getByRole('checkbox', { name: 'Select stack Stacked first', exact: true });
  await stackCheckbox.focus();
  expect(await focusStyle(stackCheckbox)).toEqual(expected);

  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  const find = page.getByRole('dialog').getByRole('textbox', { name: 'Find a tile or widget', exact: true });
  await find.click();
  expect(await focusStyle(find)).toEqual(expected);
});
