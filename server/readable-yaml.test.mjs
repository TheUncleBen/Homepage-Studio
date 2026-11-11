import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { readableYamlText } from './migrations/readable-yaml.mjs';
import { upgradeData, readDataVersion, DATA_MARKER } from './upgrade.mjs';

const quiet = { log() {}, error() {} };
const ONE_LINE = '[ { Services: [ { App: { href: "http://app.example.test", id: studio-1, widget: { type: customapi, key: {{HOMEPAGE_VAR_KEY}}, fields: [a, b], mappings: [ { field: { containers: running }, label: Running } ] } } } ] } ]\n';

test('a one-line YAML file becomes readable block YAML with the same values and references', () => {
  const text = readableYamlText(ONE_LINE);
  assert.equal(text, `- Services:
    - App:
        href: "http://app.example.test"
        id: studio-1
        widget:
          type: customapi
          key: {{HOMEPAGE_VAR_KEY}}
          fields: [ a, b ]
          mappings:
            - field:
                containers: running
              label: Running
`);
  const mask = (value) => value.replaceAll('{{HOMEPAGE_VAR_KEY}}', 'REF');
  assert.deepEqual(YAML.parse(mask(text)), YAML.parse(mask(ONE_LINE)));
  assert.equal(readableYamlText('{ studioTheme: { mode: dark }, theme: dark } # mine\n'), 'studioTheme:\n  mode: dark\ntheme: dark\n# mine\n');
});

test('block files, empty files, broken files and other text are left exactly as they are', () => {
  for (const text of ['title: Home\nlayout: { Media: { style: row } }\n', '[]\n', '{}\n', '', '{ a: [\n', '- a\n- b\n', 'not: [valid\n']) assert.equal(readableYamlText(text), text);
});

test('the upgrade to data version 2 rewrites every dashboard\'s one-line files after a backup', async (t) => {
  const root = await fs.mkdtemp(join(os.tmpdir(), 'studio-readable-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configRoot = join(root, 'config'), stateRoot = join(root, 'state');
  const other = join(configRoot, 'dashboards', '0c7ad1f0-0000-4000-8000-000000000001');
  await fs.mkdir(other, { recursive: true }); await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(join(configRoot, 'services.yaml'), ONE_LINE);
  await fs.writeFile(join(configRoot, 'settings.yaml'), '{ title: Home, theme: dark }\n');
  await fs.writeFile(join(configRoot, 'widgets.yaml'), '- resources:\n    cpu: true\n');
  await fs.writeFile(join(other, 'settings.yaml'), '{ title: Family }\n');
  await fs.writeFile(join(stateRoot, DATA_MARKER), JSON.stringify({ version: 1, build: 'cf02529' }));
  const result = await upgradeData({ configRoot, stateRoot, buildRevision: 'next', log: quiet });
  assert.equal(result.from, 1); assert.equal(result.to, 2); assert.match(result.backup, /before-upgrade/);
  assert.equal(await fs.readFile(join(configRoot, 'settings.yaml'), 'utf8'), 'title: Home\ntheme: dark\n');
  assert.equal(await fs.readFile(join(other, 'settings.yaml'), 'utf8'), 'title: Family\n');
  assert.equal(await fs.readFile(join(configRoot, 'widgets.yaml'), 'utf8'), '- resources:\n    cpu: true\n');
  assert.match(await fs.readFile(join(configRoot, 'services.yaml'), 'utf8'), /^- Services:\n {4}- App:\n/);
  assert.equal((await readDataVersion(stateRoot)).version, 2);
});
