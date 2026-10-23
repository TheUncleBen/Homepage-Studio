// Guards the Firefox/WebKit desktop acceptance selection. The desktop config
// selects scenarios by the `@cross-engine` Playwright tag rather than by title,
// so renaming a test cannot silently drop it from the other engines, and adding
// or removing a tag must be a deliberate change to EXPECTED_CROSS_ENGINE_TESTS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = path.join(root, 'browser');
const specs = path.join(browser, 'specs');
const TAG = '@cross-engine';
const EXPECTED_CROSS_ENGINE_TESTS = 8;
const ENGINES = ['firefox', 'webkit'];
const declaration = /\btest(?:\.(?:only|fixme|skip|fail|slow))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*\{[^{}]*\btag:\s*(?:(['"])@cross-engine\3|\[[^\]]*(['"])@cross-engine\4[^\]]*\])[^{}]*\}\s*,/g;

async function taggedTests() {
  const found = [];
  for (const file of (await fs.readdir(specs)).filter(name => name.endsWith('.spec.mjs')).sort()) {
    const text = await fs.readFile(path.join(specs, file), 'utf8');
    const declared = [...text.matchAll(declaration)].map(match => ({ file, title: match[2] }));
    const mentions = text.split(TAG).length - 1;
    assert.equal(mentions, declared.length, `${file}: every ${TAG} mention must be a test tag (found ${mentions} mentions, ${declared.length} tagged tests)`);
    for (const item of declared) assert.doesNotMatch(item.title, /@/, `${file}: keep tags out of the title: ${item.title}`);
    found.push(...declared);
  }
  return found;
}

test('the desktop engines select the tagged cross-engine scenarios, not title patterns', async () => {
  const config = await fs.readFile(path.join(browser, 'desktop.config.mjs'), 'utf8');
  assert.match(config, /^\s*grep:\s*\/@cross-engine\\b\/,\s*$/m);
  assert.doesNotMatch(config, /grepInvert/);
  const testMatch = JSON.parse(config.match(/^\s*testMatch:\s*(\[[^\]]*\]),\s*$/m)[1].replaceAll("'", '"'));
  const tagged = await taggedTests();
  assert.equal(tagged.length, EXPECTED_CROSS_ENGINE_TESTS, `expected ${EXPECTED_CROSS_ENGINE_TESTS} ${TAG} tests, found:\n${tagged.map(item => `${item.file}: ${item.title}`).join('\n')}`);
  assert.deepEqual([...new Set(tagged.map(item => item.file))].sort(), [...testMatch].sort(), 'testMatch must cover exactly the spec files that hold cross-engine tests');
  assert.deepEqual(ENGINES, [...config.matchAll(/browserName:\s*'(\w+)'/g)].map(match => match[1]));
});

test('Playwright itself lists every cross-engine scenario once per desktop engine', async t => {
  const cli = path.join(browser, 'node_modules/@playwright/test/cli.js');
  try { await fs.access(cli); } catch {
    if (process.env.STUDIO_REQUIRE_PLAYWRIGHT_LIST === '1') assert.fail('Install browser/ dependencies: this check is required here.');
    t.skip('browser/ dependencies are not installed; the static selection test above still ran');
    return;
  }
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'test', '--config', path.join(browser, 'desktop.config.mjs'), '--list'], {
    cwd: root, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    // Listing loads the config but runs no test and contacts no deployment.
    env: { ...process.env, STUDIO_BROWSER_ORIGIN: 'http://127.0.0.1:9', STUDIO_DISPOSABLE_BROWSER_TEST: '1', STUDIO_TEST_CONTAINERS: '' },
  });
  const listed = stdout.split('\n').map(line => line.match(/^\s*\[(\w+)\] › (\S+?):\d+:\d+ › (.+)$/)).filter(Boolean);
  assert.equal(listed.length, EXPECTED_CROSS_ENGINE_TESTS * ENGINES.length, stdout);
  const tagged = await taggedTests();
  for (const engine of ENGINES) {
    assert.deepEqual(listed.filter(match => match[1] === engine).map(match => `${match[2]} › ${match[3]}`).sort(), tagged.map(item => `${item.file} › ${item.title}`).sort());
  }
});
