import { expect, openSettings, saveFiles, studioApi } from './dashboard.mjs';

export const carousel = page => page.locator('[aria-roledescription="carousel"]');
export const activePanel = page => page.locator('[data-stack-id]:not([aria-hidden="true"])');
export const NATIVE_FILES = [
  ['services.yaml', 'servicesYaml'], ['widgets.yaml', 'widgetsYaml'],
  ['bookmarks.yaml', 'bookmarksYaml'], ['settings.yaml', 'settingsYaml'],
  ['docker.yaml', 'dockerYaml'], ['kubernetes.yaml', 'kubernetesYaml'],
  ['proxmox.yaml', 'proxmoxYaml'], ['custom.css', 'customCss'], ['custom.js', 'customJs'],
];

export async function seedNative(request, files, arrange) {
  const state = await saveFiles(request, files);
  if (!arrange) return state;
  const board = structuredClone(state.board);
  arrange(board);
  return studioApi(request, '/home/__studio/api/board', { revision: state.revision, board });
}

export function playback(overrides = {}) {
  return { mode: 'manual', intervalMs: 2000, manualHoldMs: 30000, transition: 'horizontal', transitionDurationMs: 250, loop: true, ...overrides };
}

export async function seedPlayback(request, overrides = {}) {
  return seedNative(request, {
    widgetsYaml: JSON.stringify([{ search: { provider: 'duckduckgo', showSearchSuggestions: false, focus: false } }, { greeting: { text: 'Playback fixture' } }]),
    servicesYaml: JSON.stringify([{ Fixtures: [{ 'Offscreen marker': { href: 'https://example.test/' } }] }]),
  }, board => {
    const search = board.panels.find(panel => panel.nativeLocator.type === 'search');
    const greeting = board.panels.find(panel => panel.nativeLocator.type === 'greeting');
    for (const panel of [search, greeting]) panel.rect = { x: 0, y: 0, w: 4, h: 3 };
    board.panels.find(panel => panel.kind === 'service').rect = { x: 0, y: 20, w: 4, h: 3 };
    board.stacks = [{ id: 'playback-fixture', panelIds: [search.id, greeting.id], rect: { x: 0, y: 0, w: 4, h: 3 }, playback: playback(overrides) }];
  });
}

export async function openFiles(page, base) {
  const settings = await openSettings(page, base);
  await settings.getByRole('button', { name: /Configuration files All nine native files/ }).click();
  return page.getByRole('dialog');
}

export async function fileText(dialog, name) {
  await dialog.getByRole('combobox', { name: 'Configuration file', exact: true }).selectOption(NATIVE_FILES.find(([file]) => file === name)[1]);
  return dialog.getByRole('textbox', { name, exact: true });
}

export async function downloadText(page, action) {
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(await download.failure()).toBeNull();
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}

export async function expectPageFits(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
