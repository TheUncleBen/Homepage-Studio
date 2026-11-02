import { DASHBOARDS, expect, openSettings, saveFiles, test } from '../helpers/dashboard.mjs';
import { seedNative } from '../helpers/engineering.mjs';

const textSelectors = [
  '[aria-label="Up link"] .studio-card-name strong',
  '[aria-label="Up link"] .studio-card-name small',
  '[aria-label="Down link"] .studio-card-note',
  '.service-block-value',
  '.service-block-label',
  '.information-widget-greeting span',
  '[aria-label="Theme reference"] .studio-card-name strong',
  '[aria-label="Theme reference"] .studio-card-name small',
];

async function settledNative(page) {
  await expect.poll(() => page.locator('.studio-card').evaluateAll(nodes =>
    nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length,
  )).toBe(0);
}

// Use actual rendered background pixels beside each text run. Computed
// backgroundColor alone misses the translucent cards over Studio's gradient.
async function textContrast(page, testInfo, name) {
  await settledNative(page);
  const image = await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  return page.evaluate(async ({ png, selectors }) => {
    const screenshot = new Image();
    screenshot.src = `data:image/png;base64,${png}`;
    await screenshot.decode();
    const canvas = document.createElement('canvas');
    canvas.width = screenshot.width;
    canvas.height = screenshot.height;
    const pixels = canvas.getContext('2d');
    pixels.drawImage(screenshot, 0, 0);
    const swatch = document.createElement('canvas').getContext('2d');
    const luminance = rgb => {
      const channels = rgb.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const scale = screenshot.width / innerWidth;
    return selectors.map(selector => {
      const node = document.querySelector(selector);
      const text = [...node.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(text);
      const bounds = range.getBoundingClientRect();
      const background = [...pixels.getImageData(Math.floor((bounds.left - 3 + scrollX) * scale), Math.floor((bounds.top + bounds.height / 2 + scrollY) * scale), 1, 1).data];
      swatch.clearRect(0, 0, 1, 1);
      swatch.fillStyle = getComputedStyle(node).color;
      swatch.fillRect(0, 0, 1, 1);
      const foreground = [...swatch.getImageData(0, 0, 1, 1).data];
      const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      return { selector, foreground, background, contrast: (high + 0.05) / (low + 0.05) };
    });
  }, { png: image.toString('base64'), selectors: textSelectors });
}

async function setMode(page, mode) {
  const dialog = await openSettings(page);
  await dialog.getByRole('radiogroup', { name: 'Display mode', exact: true }).getByRole('radio', { name: { dark: 'Dark', light: 'Light', system: 'Follow device' }[mode], exact: true }).click();
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.waitForURL(`**${DASHBOARDS}`);
  await page.goto('/dashboard');
  const expected = mode === 'system' ? await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
  await expect(page.locator('html')).toHaveClass(new RegExp(expected));
  await settledNative(page);
}

test('card text stays readable in light, dark and Follow device modes while status colours and explicit CSS keep control', async ({ page, request }, testInfo) => {
  await page.route('**/api/services/proxy?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"value":41}' }));
  // Studio cards check each service once, by its site monitor (Web address).
  await page.route('**/api/siteMonitor?**', route => {
    const up = new URL(route.request().url()).searchParams.get('serviceName') === 'Up link';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(up ? { status: 200, latency: 12 } : { status: 503, latency: 12 }) });
  });
  await seedNative(request, {
    servicesYaml: JSON.stringify([{ Review: [
      { 'Up link': { href: 'https://example.test/', description: 'Native service description', siteMonitor: 'https://up.example.test/' } },
      { 'Down link': { href: 'https://example.test/down', siteMonitor: 'https://down.example.test/' } },
      { 'Theme metrics': { widget: { type: 'customapi', url: 'https://metrics.example.test/', mappings: [{ field: 'value', label: 'Reviewed value', format: 'number' }] } } },
    ] }]),
    widgetsYaml: JSON.stringify([{ greeting: { text: 'Native information text' } }]),
    bookmarksYaml: JSON.stringify([{ Links: [{ 'Theme reference': [{ href: 'https://example.test/reference', abbr: 'TR', description: 'Bookmark description' }] }] }]),
    settingsYaml: JSON.stringify({ title: 'Native palette fixture', studioTheme: { mode: 'light' } }),
  }, board => board.panels.forEach((panel, index) => { panel.rect = { x: (index % 2) * 8, y: Math.floor(index / 2) * 5, w: 8, h: panel.kind === 'serviceWidget' ? 5 : 3 }; }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('.service-block-value')).toHaveText('41');
  await expect(page.locator('[aria-label="Up link"] .studio-status-up')).toBeVisible();
  await expect(page.locator('[aria-label="Down link"] .studio-status-down')).toBeVisible();
  expect(await page.locator('[data-panel-kind]').evaluateAll(nodes => nodes.map(node => node.dataset.panelKind).sort())).toEqual(['bookmark', 'informationWidget', 'service', 'service', 'serviceWidget']);
  const statuses = () => page.locator('.studio-status-dot').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  const originalStatuses = await statuses();
  expect(originalStatuses).toHaveLength(2);
  expect(originalStatuses[0]).not.toBe(originalStatuses[1]);
  const inspect = async name => {
    const measured = await textContrast(page, testInfo, name);
    await testInfo.attach(`${name}-contrast`, { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
    for (const sample of measured) {
      expect(sample.foreground[3], `${name} ${sample.selector} opaque text`).toBe(255);
      expect.soft(sample.contrast, `${name} ${sample.selector}: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(await statuses()).toEqual(originalStatuses);
  };
  await inspect('light-normal');
  await page.locator('[aria-label="Up link"] .studio-card-identity').hover();
  await inspect('light-service-hover');
  await page.locator('[aria-label="Theme reference"] .studio-card-identity').hover();
  await inspect('light-bookmark-hover');
  await page.mouse.move(1, 1);
  await setMode(page, 'dark');
  await inspect('dark');
  await setMode(page, 'system');
  await inspect('system-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await inspect('system-dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.service-block-value')).toHaveText('41');
  await inspect('system-dark-reload');

  // Studio picks Homepage's palette from the dashboard's Base, so a native
  // color in settings.yaml no longer changes it.
  await saveFiles(request, { settingsYaml: JSON.stringify({ color: 'green', studioTheme: { mode: 'light' } }) });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/theme-zinc/);
  await expect(page.locator('html')).not.toHaveClass(/theme-green/);

  // custom.css overrides card text with one more class than Studio's own rule
  // (docs/APPEARANCE.md), in either mode and after a save replaces the
  // generated theme style in the document head.
  await saveFiles(request, { customCss: '.studio-panel .studio-card-name small { color: #224466; }\n.studio-panel .studio-card-name strong { color: #334455; }\n' });
  await page.reload();
  const description = page.locator('[aria-label="Up link"] .studio-card-name small');
  await expect(description).toHaveCSS('color', 'rgb(34, 68, 102)');
  await setMode(page, 'dark');
  await expect(description).toHaveCSS('color', 'rgb(34, 68, 102)');
  await expect(page.locator('[aria-label="Theme reference"] .studio-card-name strong')).toHaveCSS('color', 'rgb(51, 68, 85)');
  expect(await statuses()).toEqual(originalStatuses);
});
