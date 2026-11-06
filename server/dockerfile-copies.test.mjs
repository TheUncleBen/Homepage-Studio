import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The image copies the server whole but only named files from homepage/src.
// Every homepage module the server imports, directly or through another
// copied module, must be one of them, or the container fails at start.
test('the image copies every homepage module the server imports', async () => {
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  const copied = new Set([...dockerfile.matchAll(/^COPY (homepage\/src\/\S+\.mjs) /gm)].map(match => match[1]));
  const files = [];
  for (const dir of ['server', 'server/auth', 'server/observability']) {
    for (const name of await readdir(join(root, dir))) if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) files.push(join(root, dir, name));
  }
  const needed = new Set();
  const visit = async file => {
    const source = await readFile(file, 'utf8');
    for (const [, spec] of source.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), spec);
      const path = relative(root, target);
      if (!path.startsWith('homepage/') || needed.has(path)) continue;
      needed.add(path);
      await visit(target);
    }
  };
  for (const file of files) await visit(file);
  assert.ok(needed.size > 0);
  for (const path of needed) assert.ok(copied.has(path), `Dockerfile must COPY ${path}`);
});
