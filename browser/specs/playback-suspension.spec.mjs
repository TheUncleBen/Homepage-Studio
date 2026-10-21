import { expect, studioApi, test } from '../helpers/dashboard.mjs';
import { activePanel, carousel, seedPlayback } from '../helpers/engineering.mjs';

test('native content focus, offscreen position and an editor suspend the remaining visible playback time', async ({ page, request }) => {
  await seedPlayback(request);
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.goto('/');
  const stack = carousel(page);
  const input = page.locator('[data-panel-kind="informationWidget"][aria-label="search"]').getByRole('combobox');
  await expect(input).toBeVisible();
  await stack.scrollIntoViewIfNeeded();
  const before = await studioApi(request, '/__studio/api/backups');
  await page.clock.pauseAt(new Date('2026-10-20T13:00:00Z'));
  const firstId = await activePanel(page).getAttribute('data-panel-id');
  await stack.getByRole('button', { name: 'Play slideshow', exact: true }).click();
  await page.clock.fastForward(1000);
  await input.fill('Focused native content must keep its time');
  await expect(stack.locator('.studio-playback-status')).toHaveText('Waiting');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', firstId);
  await expect(input).toHaveValue('Focused native content must keep its time');
  await stack.focus();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Playing');
  await page.clock.fastForward(999);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', firstId);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', firstId);

  const secondId = await activePanel(page).getAttribute('data-panel-id');
  await page.clock.fastForward(500);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(stack).not.toBeInViewport();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Waiting');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', secondId);
  await stack.scrollIntoViewIfNeeded();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Playing');
  await page.clock.fastForward(1499);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', secondId);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', firstId);

  await page.clock.fastForward(500);
  await page.getByRole('button', { name: 'Dashboard settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Waiting');
  await page.clock.fastForward(60000);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', firstId);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await stack.scrollIntoViewIfNeeded();
  await expect(stack.locator('.studio-playback-status')).toHaveText('Playing');
  await page.clock.fastForward(1499);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', firstId);
  await page.clock.fastForward(1);
  await expect(activePanel(page)).toHaveAttribute('data-panel-id', secondId);
  expect(await studioApi(request, '/__studio/api/backups')).toEqual(before);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('automatic start is suppressed, explicit Play advances without animation, and non-looping stops at the end', async ({ page, request }) => {
    await seedPlayback(request, { mode: 'automatic', loop: false });
    await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
    await page.goto('/');
    const stack = carousel(page);
    await expect(stack.getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();
    await page.clock.pauseAt(new Date('2026-10-20T13:00:00Z'));
    const firstId = await activePanel(page).getAttribute('data-panel-id');
    await page.clock.fastForward(60000);
    await expect(activePanel(page)).toHaveAttribute('data-panel-id', firstId);
    for (const panel of await page.locator('[data-stack-id]').all()) {
      expect(await panel.evaluate(element => getComputedStyle(element).getPropertyValue('--studio-slide-duration'))).toBe('0ms');
    }
    await stack.getByRole('button', { name: 'Play slideshow', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(activePanel(page)).not.toHaveAttribute('data-panel-id', firstId);
    const finalId = await activePanel(page).getAttribute('data-panel-id');
    await page.clock.fastForward(2000);
    await expect(stack.getByRole('button', { name: 'Play slideshow', exact: true })).toBeVisible();
    await page.clock.fastForward(60000);
    await expect(activePanel(page)).toHaveAttribute('data-panel-id', finalId);
  });
});
