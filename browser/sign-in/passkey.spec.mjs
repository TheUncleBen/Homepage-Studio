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
    await expect(ask.getByLabel('Address')).toHaveValue('dashboard');
    await ask.getByRole('button', { name: 'Save address' }).click();
    await expect(ask).toHaveCount(0);
    await page.goto('/studio/admin');
  }
  await expect(page).toHaveURL(/\/studio\/admin$/);
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('cell', { name: /Studio Admin/ })).toBeVisible();

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
    await expect(page.getByRole('button', { name: 'Widgets' })).toHaveCount(0);
    await page.goto('/dashboard/studio/edit');
    await expect(page.getByRole('button', { name: 'Widgets' })).toBeVisible();
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

  expect(policyErrors).toEqual([]);
});
