import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTrustedCertificates, parsePem, TRUSTED_BUNDLE } from './trusted-certificates.mjs';

const CA = readFileSync(fileURLToPath(new URL('./fixtures/example-ca.pem', import.meta.url)), 'utf8');

async function temp() {
  return fs.mkdtemp(join(tmpdir(), 'studio-trust-'));
}

test('reads a CA certificate and refuses private keys and junk', () => {
  const [entry] = parsePem(CA);
  assert.equal(entry.name, 'Example Test CA');
  assert.equal(entry.authority, true);
  assert.match(entry.fingerprint, /^[0-9A-F:]{95}$/);
  assert.throws(() => parsePem(`${CA}\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n`), { code: 'PRIVATE_KEY_REFUSED' });
  assert.throws(() => parsePem('hello'), { code: 'INVALID_CERTIFICATE' });
  assert.throws(() => parsePem('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'), { code: 'INVALID_CERTIFICATE' });
});

test('adds, lists without the PEM, bundles for workers, and removes', async () => {
  const stateRoot = await temp();
  let changes = 0;
  const trusted = createTrustedCertificates({ stateRoot, deploymentFile: '', onChange: () => { changes += 1; } });
  assert.equal(await trusted.prepare(), false);
  const listed = await trusted.add(CA, 'admin');
  assert.equal(changes, 1);
  assert.equal(listed.certificates.length, 1);
  assert.equal(listed.certificates[0].source, 'added');
  assert.equal(listed.certificates[0].addedBy, 'admin');
  assert.equal(JSON.stringify(listed).includes('BEGIN CERTIFICATE'), false);
  assert.equal(await fs.readFile(join(stateRoot, TRUSTED_BUNDLE), 'utf8'), parsePem(CA)[0].pem);
  assert.equal((await fs.stat(join(stateRoot, TRUSTED_BUNDLE))).mode & 0o777, 0o600);
  await assert.rejects(trusted.add(CA), { code: 'CERTIFICATE_EXISTS' });
  const { ca } = await trusted.caOptions();
  assert.ok(ca.length > 100 && ca.at(-1).includes('BEGIN CERTIFICATE'));
  const after = await trusted.remove(listed.certificates[0].id);
  assert.equal(after.certificates.length, 0);
  await assert.rejects(fs.stat(join(stateRoot, TRUSTED_BUNDLE)), { code: 'ENOENT' });
});

test('a deployment file (Docker secret) is trusted and shown read-only', async () => {
  const stateRoot = await temp();
  const secret = join(stateRoot, 'secret.pem');
  await fs.writeFile(secret, CA);
  const trusted = createTrustedCertificates({ stateRoot, deploymentFile: secret });
  assert.equal(await trusted.prepare(), true);
  const listed = await trusted.list();
  assert.equal(listed.certificates[0].source, 'deployment');
  assert.equal(listed.deploymentFile, true);
  const broken = createTrustedCertificates({ stateRoot: await temp(), deploymentFile: join(stateRoot, 'missing.pem') });
  assert.match((await broken.list()).deploymentError, /could not be read/);
});
