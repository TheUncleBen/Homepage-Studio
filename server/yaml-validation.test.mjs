// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore } from './config.mjs';

const yamlFiles = [
  ['servicesYaml', 'services.yaml', '- Apps:\n    - Example:\n        href: https://example.test\n', '        '],
  ['widgetsYaml', 'widgets.yaml', '- greeting:\n    text: Example\n', '    '],
  ['bookmarksYaml', 'bookmarks.yaml', '- Links:\n    - Example:\n        - href: https://example.test\n', '          '],
  ['settingsYaml', 'settings.yaml', 'title: Example\n', ''],
  ['dockerYaml', 'docker.yaml', '', ''],
  ['kubernetesYaml', 'kubernetes.yaml', '', ''],
  ['proxmoxYaml', 'proxmox.yaml', '', ''],
];
const nativeFiles = [...yamlFiles.map(([, filename]) => filename), 'custom.css', 'custom.js'];
const nonfinite = ['.inf', '-.inf', '.nan', '1e999'];
const sourceWith = ([, , prefix, indent], text) => prefix + text.trimEnd().split('\n').map(line => indent + line).join('\n') + '\n';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-yaml-validation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { configDir: path.join(root, 'config'), stateDir: path.join(root, 'state') };
  const store = createConfigStore(options);
  const empty = await store.initialize();
  const before = await store.save({ revision: empty.revision, ...Object.fromEntries(yamlFiles.map(entry => [entry[0], sourceWith(entry, 'x-unknown: retained\n')])) });
  const archive = await store.exportCurrent();
  const backups = await store.listBackups();
  const bytes = await managedBytes(options);
  return { store, options, before, archive, backups, bytes };
}

async function managedBytes({ configDir, stateDir }) {
  return Object.fromEntries(await Promise.all([
    ...nativeFiles.map(async filename => [filename, await fs.readFile(path.join(configDir, filename), 'utf8')]),
    fs.readFile(path.join(stateDir, 'state.json'), 'utf8').then(text => ['state.json', text]),
  ]));
}

async function change(operation, setup, changes) {
  if (operation === 'save') return setup.store.save({ revision: setup.before.revision, ...changes });
  const archive = structuredClone(setup.archive);
  for (const [field, text] of Object.entries(changes)) archive.files[yamlFiles.find(entry => entry[0] === field)[1]] = text;
  return setup.store.importArchive({ revision: setup.before.revision, archive });
}

async function unchanged(setup) {
  const current = await setup.store.load();
  assert.equal(current.revision, setup.before.revision);
  assert.equal(current.configurationRevision, setup.before.configurationRevision);
  assert.deepEqual(await managedBytes(setup.options), setup.bytes);
  assert.deepEqual(await setup.store.listBackups(), setup.backups);
  await assert.rejects(fs.access(path.join(setup.options.stateDir, 'transaction.json')), { code: 'ENOENT' });
  assert.doesNotThrow(() => JSON.stringify(current));
}

for (const operation of ['save', 'import']) {
  test(`${operation} rejects non-finite YAML scalars before changing bytes, revisions or snapshots`, async t => {
    const setup = await fixture(t);
    for (const entry of yamlFiles) for (const scalar of nonfinite) {
      const text = sourceWith(entry, `x-unknown:\n  nested: [0, ${scalar}]\n  secret: synthetic-private-marker\n`);
      await assert.rejects(change(operation, setup, { [entry[0]]: text }), error => {
        assert.equal(error.code, 'INVALID_YAML');
        assert.equal(error.status, 422);
        assert.match(error.message, /finite number/i);
        assert.ok(!error.message.includes('synthetic-private-marker'));
        return true;
      }, `${entry[1]}: ${scalar}`);
      await unchanged(setup);
    }
  });

  test(`${operation} rejects cyclic YAML aliases before changing bytes, revisions or snapshots`, async t => {
    const setup = await fixture(t);
    for (const entry of yamlFiles) {
      await assert.rejects(change(operation, setup, { [entry[0]]: sourceWith(entry, 'x-unknown: &cycle\n  self: *cycle\n') }), { code: 'INVALID_YAML', status: 422 });
      await unchanged(setup);
    }
  });

  test(`${operation} preserves finite scalars, quoted text, nulls, unknown fields, aliases and literal references`, async t => {
    const setup = await fixture(t);
    const text = '# Preserve this native comment\nx-shared: &shared\n  values: [0, -2, 1.25, 1e308, null, true, ".inf", "-.inf", ".nan", "1e999"]\n  reference: {{HOMEPAGE_VAR_SYNTHETIC}}\nx-unknown:\n  <<: *shared\n  retained: yes\n';
    const changes = Object.fromEntries(yamlFiles.map(entry => [entry[0], sourceWith(entry, text)]));
    const saved = await change(operation, setup, changes);
    for (const [field, content] of Object.entries(changes)) assert.equal(saved[field], content);
    assert.notEqual(saved.revision, setup.before.revision);
    assert.equal((await setup.store.listBackups()).length, setup.backups.length + 1);
    const transported = JSON.parse(JSON.stringify(saved));
    const expected = { values: [0, -2, 1.25, 1e308, null, true, '.inf', '-.inf', '.nan', '1e999'], reference: '{{HOMEPAGE_VAR_SYNTHETIC}}', retained: 'yes' };
    for (const config of [transported.settingsConfig, transported.services[0].config, transported.infoWidgets[0].config, transported.bookmarks[0].config]) assert.deepEqual(config['x-unknown'], expected);
    assert.deepEqual((await createConfigStore(setup.options).load()).board, saved.board);
    const bytes = await managedBytes(setup.options), exported = (await setup.store.exportCurrent()).files;
    for (const filename of nativeFiles) assert.equal(bytes[filename], exported[filename]);
    assert.deepEqual(JSON.parse(bytes['state.json']), JSON.parse(exported['state.json']));
  });
}

test('validation of pre-existing non-finite YAML leaves the existing files and recovery material untouched', async t => {
  const setup = await fixture(t);
  for (const scalar of nonfinite) {
    const invalid = `title: Existing\nx-unknown: ${scalar}\n`;
    await fs.writeFile(path.join(setup.options.configDir, 'settings.yaml'), invalid);
    const before = await managedBytes(setup.options);
    const restarted = createConfigStore(setup.options);
    await assert.rejects(restarted.load(), { code: 'INVALID_YAML', status: 422 });
    await assert.rejects(restarted.initialize(), { code: 'INVALID_YAML', status: 422 });
    assert.deepEqual(await managedBytes(setup.options), before);
    assert.deepEqual(await restarted.listBackups(), setup.backups);
    await assert.rejects(fs.access(path.join(setup.options.stateDir, 'transaction.json')), { code: 'ENOENT' });
  }
});
