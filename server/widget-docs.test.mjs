import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { widgetDocs } from '../scripts/build-widget-docs.mjs';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/catalog.json', root), 'utf8'));

test('the widget reference has one current page per catalog widget and nothing else', async () => {
  const expected = widgetDocs(catalog);
  const shipped = (await readdir(new URL('docs/widgets/', root))).filter(name => name.endsWith('.md')).sort();
  assert.deepEqual(shipped, [...expected.keys()].sort(), 'docs/widgets is stale; run node scripts/build-widget-docs.mjs');
  for (const [name, text] of expected) assert.equal(await readFile(new URL(`docs/widgets/${name}`, root), 'utf8'), text, `docs/widgets/${name} is stale; run node scripts/build-widget-docs.mjs`);
});

test('a widget page says what the service needs and lists every setting the dialog shows', () => {
  const page = widgetDocs(catalog).get('authentik.md');
  assert.match(page, /^# Authentik$/m);
  assert.match(page, /Tokens & App passwords/);
  assert.match(page, /\| API key \| `key` \| Text \| Secret: hidden while you type\./);
  assert.match(page, /\| Visible fields \| `fields` \| List \| Choices: `users`/);
  // The page is built from text, never from the upstream page's HTML.
  assert.doesNotMatch(page, /<img|<br/i);
});

test('every page links back to the index and the index links every page', () => {
  const docs = widgetDocs(catalog);
  const index = docs.get('README.md');
  for (const [name, text] of docs) {
    if (name === 'README.md') continue;
    assert.match(text, /\[All widgets\]\(README\.md\)/, name);
    assert.ok(index.includes(`](${name})`), `${name} is missing from the index`);
  }
});
