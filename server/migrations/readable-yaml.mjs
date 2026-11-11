// Data version 2: readable YAML (owner decision, 11 Nov 2026). Candidates up
// to cf02529 wrote every change into a new deployment's empty `{}` or `[]`
// files, so services.yaml, settings.yaml and the rest grew as one long flow
// line. Each such file is rewritten as ordinary block YAML. Values, comments,
// key order and {{HOMEPAGE_VAR_…}} / {{HOMEPAGE_FILE_…}} references stay as
// they are; short lists of plain values (fields: [a, b]) stay on one line.
// A file whose root is already block style, that doesn't parse, or whose
// values would differ after the rewrite is left untouched.
import { join } from 'node:path';
import { parseDocument, visit, isMap, isSeq, isScalar } from 'yaml';
import { dashboardDirs, settleInterrupted, update } from './legacy-looks.mjs';

const FILES = ['services.yaml', 'widgets.yaml', 'bookmarks.yaml', 'settings.yaml', 'docker.yaml', 'kubernetes.yaml', 'proxmox.yaml'];
const PLACEHOLDER = /\{\{\s*HOMEPAGE_(?:VAR|FILE)_[^{}\r\n]*\}\}/g;
const OPTIONS = { uniqueKeys: false, prettyErrors: false };

export function readableYamlText(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  let prefix = 'HOMEPAGESTUDIOREF';
  while (text.includes(prefix)) prefix += 'X';
  const references = [];
  const masked = text.replace(PLACEHOLDER, (original) => `${prefix}${references.push(original) - 1}END`);
  const restore = (value) => value.replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (_, index) => references[Number(index)]);
  const doc = parseDocument(masked, OPTIONS);
  if (doc.errors.length || !(isMap(doc.contents) || isSeq(doc.contents)) || !doc.contents.flow || !doc.contents.items.length) return text;
  const before = JSON.stringify(doc.toJS({ maxAliasCount: 100 }));
  visit(doc, {
    Map(_, node) { node.flow = false; },
    Seq(_, node) { node.flow = Boolean(node.items.length) && node.items.every((item) => isScalar(item)); },
  });
  doc.contents.flow = false;
  const next = doc.toString({ lineWidth: 0 });
  const check = parseDocument(next, OPTIONS);
  if (check.errors.length || JSON.stringify(check.toJS({ maxAliasCount: 100 })) !== before) return text;
  return restore(next);
}

export async function migrateReadableYaml({ configRoot, stateRoot, log = console }) {
  let files = 0;
  for (const { configDir, stateDir } of await dashboardDirs(configRoot, stateRoot)) {
    await settleInterrupted(configDir, stateDir);
    for (const name of FILES) if (await update(join(configDir, name), readableYamlText)) files += 1;
  }
  log.log(`Studio upgrade: ${files} one-line YAML file${files === 1 ? '' : 's'} rewritten as readable YAML.`);
}
