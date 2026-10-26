import { expect, test } from '@playwright/test';

const PASSWORD = 'a long and unusual passphrase';

// A Chromium virtual authenticator stands in for a platform passkey with
// user verification (fingerprint, face or PIN).
async function virtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test('first administrator sets up with a passkey, signs out and signs back in with it', async ({ page }) => {
  const policyErrors = [];
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) policyErrors.push(message.text()); });
  await virtualAuthenticator(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/studio\/auth\/setup$/);
  await expect(page.getByRole('heading', { name: 'Create the administrator' })).toBeVisible();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Display name').fill('Studio Admin');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill('not the same');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Protect the administrator account' })).toBeVisible();
  const finish = page.getByRole('button', { name: 'Finish' });
  await expect(finish).toBeDisabled();
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added.')).toBeVisible();
  await expect(finish).toBeEnabled();
  await finish.click();

  await expect(page.getByRole('heading', { name: 'Save your backup codes' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')).toHaveCount(10);
  const open = page.getByRole('button', { name: 'Open Studio' });
  await expect(open).toBeDisabled();
  await page.getByLabel('I have saved these codes').check();
  await open.click();
  // On a fresh deployment Studio first asks for the main dashboard's address.
  await expect(page).toHaveURL(/\/studio\/(?:admin|dashboards)$/);
  if (page.url().endsWith('/studio/dashboards')) {
    const ask = page.getByRole('dialog', { name: 'Choose the main dashboard’s address' });
    await expect(ask.getByRole('textbox', { name: 'Address' })).toHaveValue('dashboard');
    await ask.getByRole('button', { name: 'Save address' }).click();
    await expect(ask).toHaveCount(0);
    await page.goto('/studio/admin');
  }
  await expect(page).toHaveURL(/\/studio\/admin$/);
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Administration sections' });
  await expect(sections.getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav-row', { hasText: 'Studio Admin' })).toBeVisible();

  // On a phone, Administration opens on its list of sections, like iOS
  // Settings: a section opens on its own, and Back returns to the list.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(sections.getByRole('button', { name: 'Groups' })).toBeVisible();
  await expect(page.locator('.nav-row', { hasText: 'Studio Admin' })).toBeHidden();
  await sections.getByRole('button', { name: 'People' }).click();
  await expect(page).toHaveURL(/#people$/);
  await expect(page.locator('.nav-row', { hasText: 'Studio Admin' })).toBeVisible();
  await expect(sections).toBeHidden();
  await page.getByRole('button', { name: 'Administration', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/admin$/);
  await expect(sections.getByRole('button', { name: 'Groups' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });

  // An administrator without a default dashboard lands on the Dashboards
  // page. The live dashboard shows the account menu and no editing controls;
  // its editor has them. (STUDIO_BROWSER_NO_NATIVE=1 runs against a
  // controller without the native dashboard, for local checks of the sign-in
  // pages alone.)
  await page.goto('/');
  await expect(page).toHaveURL(/\/studio\/dashboards$/);
  await expect(page.getByRole('button', { name: 'Account: Studio Admin' })).toBeVisible();
  const native = process.env.STUDIO_BROWSER_NO_NATIVE !== '1';
  if (native) {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Account: Studio Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Widgets', exact: true })).toHaveCount(0);
    await page.goto('/dashboard/studio/edit');
    await expect(page.getByRole('button', { name: 'Widgets', exact: true })).toBeVisible();
  }

  await page.goto('/studio/account');
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  // Sign out lives in the account menu of the top bar.
  await page.getByRole('button', { name: 'Account: Studio Admin' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/auth\/sign-in\?signedOut=1$/);
  await expect(page.getByText('You are signed out.')).toBeVisible();

  // Signed out, the dashboard sends people to sign-in.
  await page.goto('/');
  await expect(page).toHaveURL(/\/studio\/auth\/sign-in\?next=%2F$/);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/studio\/dashboards$/);
  await expect(page.getByRole('button', { name: 'Account: Studio Admin' })).toBeVisible();

  // Groups reorder by dragging a row by its handle, and the order is saved.
  await page.goto('/studio/admin');
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('button', { name: 'Groups' }).click();
  const rows = page.locator('ul.reorder-list > li.draggable');
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await page.getByRole('button', { name: 'New group' }).click();
    const dialog = page.getByRole('dialog', { name: 'New group' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create group' }).click();
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
  }
  const order = () => rows.evaluateAll(items => items.map(item => item.querySelector('.nav-title > span').textContent.trim()));
  await expect.poll(order).toEqual(['Alpha', 'Beta', 'Gamma']);
  const handle = rows.nth(2).locator('.drag-handle');
  const from = await handle.boundingBox();
  const to = await rows.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 4 });
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText('Group order saved.')).toBeVisible();
  await expect.poll(order).toEqual(['Gamma', 'Alpha', 'Beta']);
  await expect(page.locator('li.dragging')).toHaveCount(0);
  await page.reload();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('button', { name: 'Groups' }).click();
  await expect.poll(order).toEqual(['Gamma', 'Alpha', 'Beta']);

  expect(policyErrors).toEqual([]);
});
