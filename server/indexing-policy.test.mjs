import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readNativeIndexingPolicy, renderRobotsPolicy } from './indexing-policy.mjs';

test('indexing reads native YAML truthiness, merges and literal environment values', () => {
  for (const [text, disabled] of [['', false], ['# empty\n', false], ['disableIndexing: false', false], ['disableIndexing: true', true], ['disableIndexing: "false"', true], ['disableIndexing: 0', false], ['base: &base {disableIndexing: true}\n<<: *base\n', true]]) {
    assert.equal(readNativeIndexingPolicy(text, {}).disableIndexing, disabled);
  }
  assert.deepEqual(readNativeIndexingPolicy('disableIndexing: {{HOMEPAGE_VAR_INDEX}}\ntitle: "{{HOMEPAGE_VAR_TITLE}}"', { HOMEPAGE_VAR_INDEX: 'false', HOMEPAGE_VAR_TITLE: '$&' }), { disableIndexing: false });
  assert.throws(() => readNativeIndexingPolicy('disableIndexing: [', {}));
  assert.throws(() => readNativeIndexingPolicy('- not a mapping', {}));
});

test('file references retain native order and semantics while bounding expanded settings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-indexing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = path.join(root, 'policy');
  await fs.writeFile(policy, 'true');
  const link = path.join(root, 'policy-link'); await fs.symlink(policy, link);
  assert.deepEqual(readNativeIndexingPolicy('disableIndexing: {{HOMEPAGE_FILE_POLICY}}', { HOMEPAGE_FILE_POLICY: link }), { disableIndexing: true });
  await fs.writeFile(policy, 'false');
  assert.deepEqual(readNativeIndexingPolicy('disableIndexing: {{HOMEPAGE_VAR_POLICY}}', { HOMEPAGE_VAR_POLICY: '{{HOMEPAGE_FILE_POLICY}}', HOMEPAGE_FILE_POLICY: policy }), { disableIndexing: false });
  assert.throws(() => readNativeIndexingPolicy('title: "{{HOMEPAGE_VAR_TITLE}}"', { HOMEPAGE_VAR_TITLE: 'Fine', HOMEPAGE_FILE_UNUSED: path.join(root, 'missing') }));
  assert.throws(() => readNativeIndexingPolicy('disableIndexing: {{HOMEPAGE_FILE_POLICY}}', { HOMEPAGE_FILE_POLICY: root }));
  await fs.writeFile(policy, 'a'.repeat(1024 * 1024));
  assert.throws(() => readNativeIndexingPolicy('title: "{{HOMEPAGE_FILE_POLICY}}{{HOMEPAGE_FILE_POLICY}}{{HOMEPAGE_FILE_POLICY}}"', { HOMEPAGE_FILE_POLICY: policy }), /limit|large|size|bytes|expand/i);
});

function allowed(content, target) {
  const rules = content.split('\n').filter(line => /^(?:Allow|Disallow):/.test(line)).map(line => {
    const [directive, pattern] = line.split(': ');
    const anchored = pattern.endsWith('$');
    const literal = anchored ? pattern.slice(0, -1) : pattern;
    return { directive, specificity: literal.length, matches: anchored ? target === literal : target.startsWith(literal) };
  }).filter(rule => rule.matches).sort((a, b) => b.specificity - a.specificity || (a.directive === 'Allow' ? -1 : 1));
  return rules[0]?.directive !== 'Disallow';
}

test('each dashboard opts out on its own; editor endpoints, an unaddressed main dashboard and prefix collisions stay safe', async () => {
  const manifest = { dashboards: [{ id: 'default', slug: '', archived: false }, { id: 'family', slug: 'family', archived: false }, { id: 'old', slug: 'old', archived: true }, { id: 'broken', slug: 'broken', archived: false }, { id: 'private', slug: 'private', archived: false }] };
  let reads = 0;
  const content = await renderRobotsPolicy(manifest, async entry => { reads++; if (entry.id === 'broken') throw new Error('Private settings diagnostic'); return { disableIndexing: entry.id === 'private' }; });
  assert.equal(reads, 4, 'Archived dashboards do not touch their configuration.');
  for (const url of ['/broken', '/broken/', '/private', '/private/x', '/studio/api/dashboards', '/family/studio/api/state']) assert.equal(allowed(content, url), false, url);
  for (const url of ['/', '/family', '/family/', '/family?x=1', '/family/api/services', '/private-other', '/_next/static/chunks/shared.js']) assert.equal(allowed(content, url), true, url);
  assert.doesNotMatch(content, /Private settings/);
});

test('named dashboard exclusion matches exact path, descendants and queries only', async () => {
  const manifest = { dashboards: [{ id: 'default', slug: 'admin' }, { id: 'tools', slug: 'admin-tools' }] };
  const content = await renderRobotsPolicy(manifest, async entry => ({ disableIndexing: entry.id === 'default' }));
  for (const url of ['/admin', '/admin/', '/admin?x=1', '/admin/api/services']) assert.equal(allowed(content, url), false, url);
  for (const url of ['/', '/admin-tools', '/admin-tools/api/services']) assert.equal(allowed(content, url), true, url);
});

test('archived dashboards are never enumerated in the public crawl policy', async () => {
  const manifest = { dashboards: [{ id: 'default', slug: 'main', archived: false }, { id: 'family', slug: 'family', archived: false }, { id: 'retired', slug: 'retired-private-name', archived: true }] };
  let reads = 0;
  const content = await renderRobotsPolicy(manifest, async entry => { reads++; return { disableIndexing: entry.id === 'default' }; });
  assert.equal(reads, 2, 'Archived dashboards do not touch their configuration.');
  assert.doesNotMatch(content, /retired-private-name/);
  assert.match(content, /^Disallow: \/family\/studio\/$/m);
  assert.equal(allowed(content, '/family'), true);
  for (const url of ['/main', '/main/', '/main?x=1']) assert.equal(allowed(content, url), false, url);
});
