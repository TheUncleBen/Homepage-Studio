// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const HOMEPAGE_VERSION = '2.6.0';
export const SOURCE_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';
const SOURCE_BASE = `https://github.com/gethomepage/homepage/blob/${SOURCE_COMMIT}/`;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const registryTypes = text => [...text.matchAll(/^\s+([a-z0-9_]+):\s*dynamic\(/gm)].map(match => match[1]);
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Inspect configuration boundaries, never arbitrary nested objects with a type.
// A Calendar integration is not a separate Sonarr service. A provider is not an
// information widget merely because its mapping has the same name.
export function inspectExamples(value, kind, knownTypes) {
  const types = new Set(knownTypes);
  const found = [];
  if (kind === 'info') {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!record(item)) continue;
      for (const [type, options] of Object.entries(item)) {
        if (types.has(type) && record(options)) found.push({ ...options, type });
      }
    }
    return found;
  }
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!record(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'widget') {
        if (record(child) && types.has(child.type)) found.push(child);
        continue; // Do not descend into integrations, mappings, or API examples.
      }
      if (key === 'widgets' && Array.isArray(child)) {
        for (const widget of child) if (record(widget) && types.has(widget.type)) found.push(widget);
        continue;
      }
      visit(child);
    }
  }
  visit(value);
  return found;
}

export function fieldType(value) {
  if (value === null || value === undefined) return null; // A blank example proves no type.
  if (Array.isArray(value)) return 'array';
  if (record(value)) return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function label(key) {
  const labels = { url: 'Service URL', key: 'API key', username: 'Username', password: 'Password', fields: 'Visible fields', env: 'Environment ID', refreshInterval: 'Refresh interval (ms)', headers: 'Request headers', mappings: 'Value mappings', text_size: 'Text size', wan: 'WAN interface', type: 'Widget type' };
  return labels[key] || key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
}

function defineField(item, key, types, metadata = {}) {
  let field = item.fields.find(candidate => candidate.key === key);
  if (!field) {
    field = { key, label: label(key), type: types[0], valueTypes: [...types], exampleValue: null, sensitive: /(?:password|token|secret|api.?key|^key$)/i.test(key) };
    item.fields.push(field);
  }
  field.type = types[0];
  field.valueTypes = [...types];
  Object.assign(field, metadata);
  return field;
}

// Only literal documented field lists are collected. Multiple or qualified
// lists keep their contexts; they are never flattened into a universal enum.
export function documentedFields(markdown) {
  const result = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /Allowed fields[^:\n]*:\s*`(\[[^`]+\])`/i.exec(line);
    if (!match) continue;
    let choices;
    try { choices = JSON.parse(match[1]); } catch { continue; }
    if (!Array.isArray(choices) || !choices.every(choice => typeof choice === 'string')) continue;
    result.push({ context: line.trim(), choices, unconditional: /^\s*Allowed fields(?: \((?:max \d+|limited to a max of \d+|up to \d+)\))?:/i.test(line), maxItems: /Allowed fields \((?:max|limited to a max of|up to) (\d+)\):/i.exec(line)?.[1] });
  }
  return result;
}

function applyReviewedCorrections(byType) {
  const set = (kind, type, key, types, metadata = {}) => {
    const item = byType[kind].get(type);
    if (item) defineField(item, key, types, { source: item.docs, ...metadata });
  };
  const note = (kind, type, message) => {
    const item = byType[kind].get(type);
    if (item) item.setupNotes = [...(item.setupNotes || []), message];
  };

  for (const kind of ['service', 'info']) {
    set(kind, 'customapi', 'headers', ['object']);
    set(kind, 'customapi', 'requestBody', ['string', 'object']);
  }
  set('service', 'calendar', 'integrations', ['array'], { description: 'A list of Calendar integrations. Omit this property or use an empty list when none are configured.' });
  note('service', 'homeassistant', 'Defining fields disables custom states/templates. Omit fields to use custom; at most four custom entries are supported.');
  note('info', 'longhorn', 'Connection URL and optional username/password belong in settings.yaml under providers.longhorn, not in this widget.');
  note('info', 'stocks', 'Configure the provider API key in settings.yaml under providers.finnhub. The widget contains the watchlist and display settings.');

  set('service', 'ntfy', 'key', ['string'], { label: 'Access token', sensitive: true, description: 'Optional Bearer token for a private topic. Omit for public topics or Basic authentication.' });
  set('service', 'ntfy', 'username', ['string'], { description: 'Optional Basic authentication username; use together with password.' });
  set('service', 'ntfy', 'password', ['string'], { description: 'Optional Basic authentication password; use together with username.' });
  set('service', 'qnap', 'volume', ['string'], { description: 'Optional QNAP volume name to show through the volumeUsage field; poolUsage otherwise aggregates volumes.' });
  set('info', 'datetime', 'locale', ['string'], { description: 'Optional locale for this clock. Format options use native Intl.DateTimeFormat settings.' });
  set('info', 'glances', 'disk', ['string', 'array'], { description: 'One mount path or a list of mount paths reported by Glances.' });
  set('info', 'resources', 'network', ['boolean', 'string'], { description: 'false disables network; true uses the default interface; a string selects an interface. A named host interface requires the documented read-only /sys mount.' });
  for (const key of ['username', 'password']) set('service', 'rutorrent', key, ['string', 'boolean'], { description: 'Use a credential string, omit when unnecessary, or use the native boolean false to disable it. Boolean true is not a credential.' });
  set('service', 'peanut', 'key', ['string'], { label: 'UPS name', sensitive: false, description: 'The UPS name, not an API credential. The documented default is ups.' });
  set('service', 'komga', 'version', ['number'], { choices: [1, 2], description: 'Native API mode: 1 (omitted default) or numeric 2. Choose for your Komga API version; no server version is detected.', source: `${SOURCE_BASE}src/widgets/komga/proxy.js` });
  note('service', 'komga', 'Username plus password takes precedence over key. Clear both when choosing API-key authentication.');
  // These documented credentials have deliberately blank examples, which do
  // not prove a type. Their pinned native proxies confirm string credentials.
  set('service', 'photoprism', 'key', ['string'], { label: 'App password', sensitive: true, description: 'PhotoPrism app password. Omit username and password when using this authentication method.' });
  note('service', 'photoprism', 'Username plus password takes precedence over key. Clear both when choosing an app password.');
  set('service', 'gamedig', 'gameToken', ['string'], { label: 'Game token', sensitive: true, description: 'Optional GameDig token for server types that require one. Leave unset for other games.' });

  // Reviewed native lists whose prose, emphasis or malformed example syntax
  // cannot safely be treated as a generic documentation schema. Keep the
  // original documented order and leave native defaults absent.
  const reviewedFieldLists = {
    backrest: ['num_success_latest', 'num_failure_latest', 'num_success_30', 'num_plans', 'num_failure_30', 'bytes_added_30'],
    dockhand: ['running', 'stopped', 'paused', 'total', 'cpu', 'memory', 'images', 'volumes', 'events_today', 'pending_updates', 'stacks'],
    emby: ['movies', 'series', 'episodes', 'songs'],
    evcc: ['pv_power', 'grid_power', 'home_power', 'charge_power'],
    suwayomi: ['download', 'nondownload', 'read', 'unread', 'downloadedread', 'downloadedunread', 'nondownloadedread', 'nondownloadedunread'],
    unraid: ['cpu', 'memoryPercent', 'memoryAvailable', 'memoryUsed', 'notifications', 'arrayFree', 'arrayUsedSpace', 'arrayUsedPercent', 'status', 'pool1UsedSpace', 'pool1FreeSpace', 'pool1UsedPercent', 'pool2UsedSpace', 'pool2FreeSpace', 'pool2UsedPercent', 'pool3UsedSpace', 'pool3FreeSpace', 'pool3UsedPercent', 'pool4UsedSpace', 'pool4FreeSpace', 'pool4UsedPercent'],
  };
  for (const [type, choices] of Object.entries(reviewedFieldLists)) {
    set('service', type, 'fields', ['array'], {
      choices,
      exampleValue: null,
      description: 'Optional ordered list of visible native fields. Leave unset for the native default.',
      ...(['backrest', 'dockhand', 'suwayomi', 'unraid'].includes(type) ? { maxItems: 4 } : {}),
      ...(type === 'evcc' ? { source: `${SOURCE_BASE}src/widgets/evcc/component.jsx` } : {}),
    });
  }
  note('service', 'emby', 'The fields selection controls count blocks, which require enableBlocks: true. Now Playing remains independently configurable.');
  note('service', 'unraid', 'Each selected pool field also needs its corresponding pool name, such as pool1 for pool1UsedSpace.');
  set('service', 'portainer', 'fields', ['array'], {
    exampleValue: null,
    description: 'Optional ordered list for the selected native environment mode. Docker and Kubernetes use different fields; leave unset for the mode default.',
    optionGroups: [
      { context: 'Docker mode (kubernetes omitted or false)', choices: ['running', 'stopped', 'total'] },
      { context: 'Kubernetes mode (kubernetes: true)', choices: ['applications', 'services', 'namespaces'] },
    ],
  });
  note('info', 'resources', 'CPU and memory describe container usage. Disks must be mounted into the Homepage container. Glances provides separate host/remote statistics.');
  note('info', 'openmeteo', 'Provide coordinates or deliberately use browser location. Browser geolocation requires a secure context; NetBird protection alone does not make HTTP a secure context.');
  // These pages introduce each list in preceding prose rather than in its
  // "Allowed fields" line. Retain the documented context explicitly.
  for (const [type, contexts] of [['azuredevops', ['Pipelines', 'Pull requests']], ['uptimerobot', ['Monitor-Specific API Key', 'Read-Only API Key']]]) {
    const groups = byType.service.get(type)?.fields.find(field => field.key === 'fields')?.optionGroups;
    if (groups?.length === contexts.length) groups.forEach((group, index) => { group.context = contexts[index]; });
  }
}

export async function buildCatalog(sourceDirectory) {
  const source = resolve(sourceDirectory);
  const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (packageJson.version !== HOMEPAGE_VERSION) throw new Error(`Catalog input must be the verified Homepage v${HOMEPAGE_VERSION} source tree.`);
  const serviceRegistry = await readFile(join(source, 'src/widgets/components.js'), 'utf8');
  const infoRegistry = await readFile(join(source, 'src/components/widgets/widget.jsx'), 'utf8');
  const registry = { service: registryTypes(serviceRegistry), info: registryTypes(infoRegistry) };
  const byType = { service: new Map(), info: new Map() };
  const warnings = [];
  const docRecords = [];

  for (const [kind, folder] of [['service', 'services'], ['info', 'info']]) {
    for (const filename of (await readdir(join(source, 'docs/widgets', folder))).filter(name => name.endsWith('.md') && name !== 'index.md').sort()) {
      const path = `docs/widgets/${folder}/${filename}`;
      const markdown = await readFile(join(source, path), 'utf8');
      const title = /^title:\s*(.+)$/m.exec(markdown)?.[1]?.replace(/^['"]|['"]$/g, '') || filename.replace('.md', '');
      const docs = `https://gethomepage.dev/widgets/${folder}/${filename.replace('.md', '')}/`;
      const sourceRecord = { path, url: `${SOURCE_BASE}${path}`, sha256: sha256(markdown) };
      const typesInPage = new Set();
      let blockIndex = 0;
      for (const block of markdown.matchAll(/```ya?ml\s*\n([\s\S]*?)```/g)) {
        blockIndex += 1;
        let parsed;
        // Parse quoted native templates as-is. Replacing {{...}} corrupts valid
        // Home Assistant expressions and is unnecessary for this pinned corpus.
        try { parsed = parse(block[1], { maxAliasCount: 20 }); }
        catch { warnings.push({ path, block: blockIndex, reason: 'Incomplete or invalid YAML example; preserved in native documentation, not treated as a schema.' }); continue; }
        for (const widget of inspectExamples(parsed, kind, registry[kind])) {
          typesInPage.add(widget.type);
          let item = byType[kind].get(widget.type);
          if (!item) {
            item = { type: widget.type, name: title, docs, fields: [], defaults: kind === 'service' ? { type: widget.type } : {}, example: block[1].trim(), examples: [], documentationStatus: 'documented-example', sources: [], coverage: 'Configuration aids from native examples and explicitly reviewed documentation. This is not a complete validation schema; additional native options remain available through advanced YAML/JSON.' };
            byType[kind].set(widget.type, item);
          }
          if (!item.sources.some(entry => entry.path === path)) item.sources.push(sourceRecord);
          if (!item.examples.includes(block[1].trim())) item.examples.push(block[1].trim());
          for (const [key, value] of Object.entries(widget)) {
            if (key === 'type') continue;
            const type = fieldType(value);
            if (type === null) continue;
            const known = item.fields.find(field => field.key === key);
            if (known) { if (!known.valueTypes.includes(type)) known.valueTypes.push(type); continue; }
            defineField(item, key, [type], { exampleValue: value, source: docs });
          }
        }
      }
      docRecords.push({ kind, markdown, docs, types: [...typesInPage] });
    }
  }

  for (const doc of docRecords) {
    if (doc.kind !== 'service' || doc.types.length !== 1) continue;
    const options = documentedFields(doc.markdown);
    if (!options.length) continue;
    const item = byType.service.get(doc.types[0]);
    const field = defineField(item, 'fields', ['array'], { exampleValue: null, source: doc.docs, description: 'Optional ordered list of visible native fields. Leave unset for the native default.' });
    if (options.length === 1 && options[0].unconditional) {
      field.choices = options[0].choices;
      if (options[0].maxItems) field.maxItems = Number(options[0].maxItems);
    } else {
      field.optionGroups = options.map(({ context, choices }) => ({ context, choices }));
      field.description = 'Allowed fields depend on the native mode or version. Review the contextual lists in the documentation; keep their order. Leave unset for the native default.';
    }
  }
  applyReviewedCorrections(byType);

  for (const kind of ['service', 'info']) {
    for (const type of registry[kind]) {
      if (byType[kind].has(type)) continue;
      byType[kind].set(type, { type, name: label(type), docs: `https://gethomepage.dev/widgets/${kind === 'service' ? 'services' : 'info'}/`, fields: [], defaults: kind === 'service' ? { type } : {}, example: kind === 'service' ? `widget:\n  type: ${type}` : `- ${type}: {}`, documentationStatus: 'registry-only', coverage: 'Registered native implementation without a complete dedicated documentation example in this pinned corpus. Advanced native configuration is required; integration behavior has not been live-tested.', sources: [{ path: kind === 'service' ? 'src/widgets/components.js' : 'src/components/widgets/widget.jsx', url: `${SOURCE_BASE}${kind === 'service' ? 'src/widgets/components.js' : 'src/components/widgets/widget.jsx'}`, sha256: sha256(kind === 'service' ? serviceRegistry : infoRegistry) }] });
    }
  }
  const weather = byType.info.get('weatherapi');
  if (weather) { weather.name = 'WeatherAPI (source only)'; weather.documentationStatus = 'registered-undocumented'; weather.setupNotes = ['A distinct native implementation exists in the source, but the pinned documentation has no dedicated WeatherAPI configuration page. Use advanced configuration with source review; this entry is not evidence of live-tested support.']; }

  return {
    homepageVersion: HOMEPAGE_VERSION,
    sourceCommit: SOURCE_COMMIT,
    generatedFrom: 'Verified pinned Homepage registries, structurally scoped examples, and reviewed native documentation corrections',
    schemaNotice: 'Catalog presence and documented configuration are not runtime integration tests. Example literals are not defaults. Guided metadata is incomplete; advanced native YAML/JSON remains available.',
    generationWarnings: warnings,
    service: [...byType.service.values()].sort((a, b) => a.name.localeCompare(b.name)),
    info: [...byType.info.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function writeCatalog(sourceDirectory, destinationDirectory = process.cwd()) {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  const catalog = await buildCatalog(source);
  await mkdir(join(destination, 'public'), { recursive: true });
  await writeFile(join(destination, 'public/catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await mkdir(join(destination, 'third-party'), { recursive: true });
  await copyFile(join(source, 'LICENSE'), join(destination, 'third-party/homepage-LICENSE'));
  // Do not overwrite the product's derived-image/source-availability notice.
  await writeFile(join(destination, 'third-party/catalog-NOTICE.txt'), `Catalog documentation examples derive from gethomepage/homepage v${HOMEPAGE_VERSION}, pinned commit ${SOURCE_COMMIT}. These upstream examples retain Homepage's GPL-3.0 license; see homepage-LICENSE. Studio's generator and reviewed metadata use AGPL-3.0-or-later. No source or license for the derived renderer is replaced by this generated catalog notice.\n`);
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = await writeCatalog(process.argv[2] || 'homepage', process.argv[3] || process.cwd());
  console.log(JSON.stringify({ serviceWidgets: catalog.service.length, informationWidgets: catalog.info.length, examplesSkipped: catalog.generationWarnings.length, registeredWithoutCompleteExamples: [...catalog.service, ...catalog.info].filter(widget => widget.documentationStatus !== 'documented-example').map(widget => widget.type) }, null, 2));
}
