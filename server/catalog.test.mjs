// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, writeCatalog, inspectExamples, fieldType, documentedFields, guideBlocks } from '../scripts/build-catalog.mjs';

// Build from the tracked native fork itself, the same input `npm run catalog`
// uses, so the shipped catalog cannot silently drift from its source.
const nativeSource = fileURLToPath(new URL('../homepage/', import.meta.url));
const catalog = await buildCatalog(nativeSource);
const shippedText = await readFile(new URL('../public/catalog.json', import.meta.url), 'utf8');
const shipped = JSON.parse(shippedText);
const widget = (type, kind = 'service', source = catalog) => source[kind].find(item => item.type === type);
const field = (type, key, kind = 'service', source = catalog) => widget(type, kind, source).fields.find(item => item.key === key);

test('only native configuration boundaries create catalog entries', () => {
  assert.deepEqual(inspectExamples({widget:{type:'calendar',integrations:[{type:'sonarr',service_name:'TV'}]}},'service',['calendar','sonarr']).map(item=>item.type),['calendar']);
  assert.deepEqual(inspectExamples({providers:{longhorn:{url:'https://example.invalid'}}},'info',['longhorn']),[]);
  assert.deepEqual(inspectExamples([{Clock:{widget:{type:'clock'}}},{Other:{widgets:[{type:'clock'},{type:'weather'}]}}],'service',['clock','weather']).map(item=>item.type),['clock','clock','weather']);
});

test('Sonarr keeps its own identity and connection options, without Calendar integration fields', () => {
  const sonarr=widget('sonarr');assert.equal(sonarr.name,'Sonarr');assert.equal(sonarr.docs,'https://gethomepage.dev/widgets/services/sonarr/');
  assert.deepEqual(sonarr.fields.map(item=>item.key),['url','key','enableQueue','fields']);
  assert.deepEqual(field('sonarr','fields').choices,['wanted','queued','series']);
  assert.equal(sonarr.examples.length,1);assert.ok(sonarr.examples.every(example=>!example.includes('service_group')));
});

test('Longhorn connection belongs to settings providers and cannot leak into the widget form', () => {
  const longhorn=widget('longhorn','info');assert.deepEqual(longhorn.fields.map(item=>item.key),['expanded','total','labels','nodes','include']);
  assert.match(longhorn.setupNotes.join(' '),/settings\.yaml under providers\.longhorn/);assert.equal(longhorn.examples.length,1);
});

test('native Home Assistant template text survives parsing byte-for-byte', () => {
  const template=field('homeassistant','custom').exampleValue[2].template;
  assert.equal(template,"{{ states.switch|selectattr('state','equalto','on')|list|length }}");
  assert.doesNotMatch(JSON.stringify(widget('homeassistant')),/PLACEHOLDER/);
  assert.match(widget('homeassistant').setupNotes.join(' '),/Defining fields disables custom/);
});

test('blank and comment-only examples do not invent a string alternative', () => {
  assert.equal(fieldType(null),null);assert.equal(fieldType(undefined),null);
  assert.deepEqual(field('calendar','integrations').valueTypes,['array']);
  assert.equal(field('calendar','integrations').exampleValue[0].type,'sonarr');
  assert.deepEqual(field('customapi','headers').valueTypes,['object']);
  assert.deepEqual(field('customapi','requestBody').valueTypes,['string','object']);
});

test('information and service Custom API preserve different native shapes', () => {
  assert.deepEqual(field('customapi','mappings').valueTypes,['array','object']);
  assert.deepEqual(field('customapi','mappings','info').valueTypes,['array']);
  assert.equal(field('customapi','display','info'),undefined);
  // Display is a choice of the three the widget knows, block by default.
  assert.deepEqual(field('customapi','display').choices,['block','list','dynamic-list']);
  assert.equal(field('customapi','display').defaultChoice,'block');
});

test('prose field choices are an ordered optional list and never become defaults', () => {
  assert.deepEqual(field('qnap','fields').choices,['cpuUsage','memUsage','systemTempC','poolUsage','volumeUsage']);
  assert.equal(field('qnap','fields').type,'array');assert.equal(field('qnap','fields').exampleValue,null);
  assert.deepEqual(widget('qnap').defaults,{type:'qnap'});
  assert.deepEqual(documentedFields('Allowed fields: `["first", "last"]`.')[0].choices,['first','last']);
  const bounded=documentedFields('Allowed fields (limited to a max of 4): `["first", "last"]`.')[0];assert.equal(bounded.unconditional,true);assert.equal(bounded.maxItems,'4');
});

test('mode-dependent field groups remain contextual rather than a misleading universal enum', () => {
  const komodo=field('komodo','fields');assert.equal(komodo.choices,undefined);assert.equal(komodo.optionGroups.length,3);
  assert.match(komodo.optionGroups[1].context,/showStacks/);assert.ok(komodo.optionGroups[1].choices.includes('down'));
  const omv=field('openmediavault','fields');assert.equal(omv.choices,undefined);assert.match(omv.optionGroups[0].context,/services\.getStatus/);
  assert.deepEqual(field('uptimerobot','fields').optionGroups.map(group=>group.context),['Monitor-Specific API Key','Read-Only API Key']);
  assert.deepEqual(field('azuredevops','fields').optionGroups.map(group=>group.context),['Pipelines','Pull requests']);
});

test('reviewed prose-only authentication, volume, locale, and version options are surfaced', () => {
  for(const key of ['key','username','password'])assert.ok(field('ntfy',key));
  assert.equal(field('qnap','volume').type,'string');assert.equal(field('datetime','locale','info').type,'string');
  assert.deepEqual(field('komga','version').choices,[1,2]);assert.equal(field('komga','version').type,'number');
  // Every widget version field is a labelled choice whose first entry is the native default.
  for (const kind of ['service','info']) for (const item of catalog[kind]) {
    const version = item.fields.find(entry => entry.key === 'version');
    if (!version) continue;
    assert.ok(version.choices?.length >= 2 && version.choices.every(choice => version.choiceLabels[String(choice)]), `${kind} ${item.type}`);
    assert.equal(version.defaultChoice, version.choices[0], `${kind} ${item.type}`);
  }
  assert.deepEqual(field('pihole','version').choices,[5,6]);assert.deepEqual(field('glances','version','info').choices,[3,4]);
  assert.match(widget('komga').setupNotes.join(' '),/takes precedence/);
});

test('blank documented credentials have reviewed string controls without becoming defaults', () => {
  for (const [type, key] of [['photoprism', 'key'], ['gamedig', 'gameToken']]) {
    for (const source of [catalog, shipped]) {
      const credential = field(type, key, 'service', source);
      assert.ok(credential, `${type}.${key} must be configurable without copying YAML`);
      assert.deepEqual(credential.valueTypes, ['string']);
      assert.equal(credential.sensitive, true);
      assert.equal(credential.exampleValue, null);
      assert.equal(Object.hasOwn(widget(type, 'service', source).defaults, key), false);
    }
  }
  assert.match(widget('photoprism').setupNotes.join(' '), /Username plus password takes precedence/);
});

test('reviewed nonstandard documentation lists expose native field selections', () => {
  const expected = {
    backrest: ['num_success_latest', 'num_failure_latest', 'num_success_30', 'num_plans', 'num_failure_30', 'bytes_added_30'],
    dockhand: ['running', 'stopped', 'paused', 'total', 'cpu', 'memory', 'images', 'volumes', 'events_today', 'pending_updates', 'stacks'],
    emby: ['movies', 'series', 'episodes', 'songs'],
    evcc: ['pv_power', 'grid_power', 'home_power', 'charge_power'],
    suwayomi: ['download', 'nondownload', 'read', 'unread', 'downloadedread', 'downloadedunread', 'nondownloadedread', 'nondownloadedunread'],
    unraid: ['cpu', 'memoryPercent', 'memoryAvailable', 'memoryUsed', 'notifications', 'arrayFree', 'arrayUsedSpace', 'arrayUsedPercent', 'status', 'pool1UsedSpace', 'pool1FreeSpace', 'pool1UsedPercent', 'pool2UsedSpace', 'pool2FreeSpace', 'pool2UsedPercent', 'pool3UsedSpace', 'pool3FreeSpace', 'pool3UsedPercent', 'pool4UsedSpace', 'pool4FreeSpace', 'pool4UsedPercent'],
  };
  for (const [type, choices] of Object.entries(expected)) {
    for (const source of [catalog, shipped]) {
      const selection = field(type, 'fields', 'service', source);
      assert.ok(selection, `${type} documented fields must be available in the form`);
      assert.deepEqual(selection.choices, choices);
      assert.deepEqual(selection.valueTypes, ['array']);
      assert.equal(selection.exampleValue, null);
      assert.equal(Object.hasOwn(widget(type, 'service', source).defaults, 'fields'), false);
    }
  }
  // Homepage's four-value limit does not apply in Studio cards (4 Nov 2026).
  for (const item of shipped.service) for (const entry of item.fields) assert.equal(Object.hasOwn(entry, 'maxItems'), false, item.type);
  assert.match(widget('emby').setupNotes.join(' '), /enableBlocks/);
  assert.match(widget('unraid').setupNotes.join(' '), /pool name/);
  assert.match(field('evcc', 'fields').source, /src\/widgets\/evcc\/component\.jsx$/);
});

test('Portainer field options retain the Docker and Kubernetes mode boundary', () => {
  for (const source of [catalog, shipped]) {
    const selection = field('portainer', 'fields', 'service', source);
    assert.ok(selection);
    assert.equal(selection.choices, undefined);
    assert.deepEqual(selection.optionGroups, [
      { context: 'Docker mode (kubernetes omitted or false)', choices: ['running', 'stopped', 'total'] },
      { context: 'Kubernetes mode (kubernetes: true)', choices: ['applications', 'services', 'namespaces'] },
    ]);
    assert.equal(Object.hasOwn(widget('portainer', 'service', source).defaults, 'fields'), false);
    assert.equal(Object.hasOwn(widget('portainer', 'service', source).defaults, 'kubernetes'), false);
  }
});

test('valid union types and UPS names retain their native meaning', () => {
  assert.deepEqual(field('resources','network','info').valueTypes,['boolean','string']);
  assert.deepEqual(field('glances','disk','info').valueTypes,['string','array']);
  assert.deepEqual(field('rutorrent','username').valueTypes,['string','boolean']);
  assert.deepEqual(field('rutorrent','password').valueTypes,['string','boolean']);
  assert.equal(field('peanut','key').label,'UPS name');assert.equal(field('peanut','key').sensitive,false);
});

test('example literals are not applied as connection or deployment defaults', () => {
  assert.equal(field('portainer','kubernetes').exampleValue,true);
  assert.deepEqual(widget('portainer').defaults,{type:'portainer'});
  assert.deepEqual(widget('longhorn','info').defaults,{});
  assert.equal(field('ntfy','key').exampleValue,null);
});

test('registry-only implementations and undocumented WeatherAPI are labeled explicitly', () => {
  const weather=widget('weatherapi','info');assert.equal(weather.documentationStatus,'registered-undocumented');assert.equal(weather.fields.length,0);assert.match(weather.setupNotes.join(' '),/no dedicated WeatherAPI configuration page/);
  const docker=widget('docker');assert.equal(docker.documentationStatus,'registry-only');assert.match(docker.coverage,/Advanced native configuration/);
});

test('generated full catalog keeps every pinned registered type exactly once', () => {
  assert.equal(shipped.service.length,170);assert.equal(shipped.info.length,18);
  for(const kind of ['service','info']){assert.equal(new Set(shipped[kind].map(item=>item.type)).size,shipped[kind].length);assert.ok(shipped[kind].every(item=>item.coverage&&item.documentationStatus));}
  assert.match(shipped.schemaNotice,/not runtime integration tests/);
});

// Owner request, 4 Nov 2026 (NetBird was missing): nothing Homepage registers
// or documents may be missing from what Studio offers.
test('every widget Homepage registers or documents is in the shipped catalog', async () => {
  const { readdir } = await import('node:fs/promises');
  const registered = text => [...text.matchAll(/^\s+([a-z0-9_]+):\s*dynamic\(/gm)].map(match => match[1]);
  const registries = { service: 'src/widgets/components.js', info: 'src/components/widgets/widget.jsx' };
  for (const [kind, folder] of [['service', 'services'], ['info', 'info']]) {
    const types = new Set(shipped[kind].map(item => item.type));
    const missing = registered(await readFile(join(nativeSource, registries[kind]), 'utf8')).filter(type => !types.has(type));
    assert.deepEqual(missing, [], `Registered ${kind} widgets missing from the catalog: ${missing.join(', ')}`);
    const covered = new Set(shipped[kind].flatMap(item => item.sources.map(source => source.path)));
    const pages = (await readdir(join(nativeSource, 'docs/widgets', folder))).filter(name => name.endsWith('.md') && name !== 'index.md');
    const undocumented = pages.filter(name => !covered.has(`docs/widgets/${folder}/${name}`));
    assert.deepEqual(undocumented, [], `Documented ${kind} widgets missing from the catalog: ${undocumented.join(', ')}`);
  }
  assert.ok(widget('netbird', 'service', shipped));
});

// Owner request, 4 Nov 2026: each integration says what it is and shows,
// instead of one shared line.
test('every widget has its own description of what it is and what it shows', () => {
  for (const kind of ['service', 'info']) for (const item of shipped[kind]) assert.ok(item.description && item.description.length > item.name.length + 2, `${kind} ${item.type}`);
  assert.equal(widget('pfsense', 'service', shipped).description, 'Firewall. Load Avg, Mem Usage, Temp, WAN Status, WAN IP, Disk Usage.');
  assert.equal(widget('portainer', 'service', shipped).description, 'Docker management. Running, Stopped, Total.');
  assert.match(widget('netbird', 'service', shipped).description, /^Mesh VPN\. Online Peers, Users, Login Expired\.$/);
  // Every integration says what kind of app it is (a new upstream widget needs an entry in CATEGORIES).
  for (const item of shipped.service) assert.match(item.description, /^[^.]+\. /, `service ${item.type} has no category in scripts/catalog-descriptions.mjs`);
  const services = shipped.service.map(item => item.description);
  assert.ok(new Set(services).size > services.length * 0.9, 'descriptions are mostly distinct');
});

test('every secret setting names its exact Docker secret, variable and reference', () => {
  assert.deepEqual(widget('pfsense', 'service', shipped).secrets, [
    { key: 'password', label: 'Password', variable: 'HOMEPAGE_FILE_PFSENSE_PASSWORD', secret: 'homepage_pfsense_password', reference: '{{HOMEPAGE_FILE_PFSENSE_PASSWORD}}' },
    { key: 'headers.X-API-Key', label: 'API key (v2), as the X-API-Key header', variable: 'HOMEPAGE_FILE_PFSENSE_API_KEY', secret: 'homepage_pfsense_api_key', reference: '{{HOMEPAGE_FILE_PFSENSE_API_KEY}}' },
  ]);
  assert.equal(widget('unifi_drive', 'service', shipped).secrets[0].variable, 'HOMEPAGE_FILE_UNIFI_DRIVE_PASSWORD');
  for (const kind of ['service', 'info']) for (const item of shipped[kind]) {
    const sensitive = item.fields.filter(field => field.sensitive).map(field => field.key);
    assert.deepEqual((item.secrets || []).map(entry => entry.key).filter(key => !key.includes('.')), sensitive, item.type);
    for (const entry of item.secrets || []) {
      assert.match(entry.variable, /^HOMEPAGE_FILE_[A-Z0-9_]+$/);
      assert.equal(entry.reference, `{{${entry.variable}}}`);
      assert.equal(entry.secret, entry.variable.replace('HOMEPAGE_FILE_', 'homepage_').toLowerCase());
    }
  }
});

test('incomplete documentation examples stay visible as warnings rather than fabricated schemas', () => {
  assert.equal(shipped.generationWarnings.length,2);
  assert.deepEqual(shipped.generationWarnings.map(item=>item.path).sort(),['docs/widgets/info/glances.md','docs/widgets/services/customapi.md']);
  assert.ok(shipped.generationWarnings.every(item=>item.block>0&&item.reason.includes('not treated as a schema')));
});

test('the shipped catalog is exactly what the tracked native source generates', () => {
  assert.equal(`${JSON.stringify(catalog, null, 2)}\n`, shippedText, 'public/catalog.json is stale; regenerate it with `npm run catalog`.');
});

test('generation is deterministic for the same pinned input', async () => {
  assert.deepEqual(await buildCatalog(nativeSource),catalog);
});

test('catalog generation preserves the project license notice and writes its own scoped notice', async () => {
  const destination=await mkdtemp(join(tmpdir(),'homepage-catalog-output-'));
  try{await mkdir(join(destination,'third-party'));await writeFile(join(destination,'third-party/NOTICE.txt'),'Keep derived renderer obligations.\n');await writeCatalog(nativeSource,destination);
    assert.equal(await readFile(join(destination,'third-party/NOTICE.txt'),'utf8'),'Keep derived renderer obligations.\n');
    assert.match(await readFile(join(destination,'third-party/catalog-NOTICE.txt'),'utf8'),/GPL-3\.0/);
    assert.deepEqual(JSON.parse(await readFile(join(destination,'public/catalog.json'),'utf8')),catalog);
  }finally{await rm(destination,{recursive:true,force:true});}
});

test('a mismatched source version cannot be mislabeled as the catalog pin', async () => {
  const source=await mkdtemp(join(tmpdir(),'homepage-catalog-version-'));
  try{await writeFile(join(source,'package.json'),JSON.stringify({version:'99.0.0'}));await assert.rejects(()=>buildCatalog(source),/verified Homepage v2\.7\.0/);}
  finally{await rm(source,{recursive:true,force:true});}
});

test('setup guidance keeps the page prose and leaves out examples, images and listed fields', () => {
  const authentik = catalog.service.find(item => item.type === 'authentik');
  const text = JSON.stringify(authentik.guide);
  assert.match(text, /Tokens & App passwords/);
  assert.ok(authentik.guide.some(block => block.type === 'table' && block.rows[0][0] === 'Authentik Version'));
  // The field picker lists the allowed fields; YAML examples stay in Advanced YAML.
  assert.doesNotMatch(text, /Allowed fields|type: authentik/);
  const markdown = '---\ntitle: X\n---\n\nIntro with a [relative link](../../configs/services.md#block-highlighting).\n\n<img src="x.png">\n\nFor version 2:\n\n```yaml\nwidget:\n  type: x\n```\n\n!!! warning\n\n    Not **proxied**.\n\n```bash\nuhttpd -m "<pass>"\n```\n';
  assert.deepEqual(guideBlocks(markdown, 'https://gethomepage.dev/widgets/services/'), [
    { type: 'p', text: 'Intro with a [relative link](https://gethomepage.dev/configs/services/#block-highlighting).' },
    { type: 'note', tone: 'warning', blocks: [{ type: 'p', text: 'Not **proxied**.' }] },
    { type: 'code', text: 'uhttpd -m "<pass>"' },
  ]);
});

// Owner feedback T8 on 65f724c (U6): Studio's own fillers, where Homepage has
// nothing. They are marked as Studio's and never claim Homepage's documentation.
test('Studio fillers are in the catalog as Studio-made, with their dialog settings', () => {
  for (const source of [catalog, shipped]) {
    const fillers = source.info.filter(item => item.documentationStatus === 'studio');
    assert.deepEqual(fillers.map(item => item.type).sort(), ['heading', 'note', 'picture', 'spacer']);
    for (const item of fillers) {
      assert.equal(item.docs, '');
      assert.ok(item.guide?.length && item.description);
      assert.ok(item.sources.every(entry => !entry.url.includes('gethomepage/homepage')));
    }
  }
  assert.equal(field('note', 'text', 'info').editor, 'multiline');
  assert.equal(field('picture', 'image', 'info').editor, 'picture');
  assert.deepEqual(field('picture', 'fit', 'info').choices, ['fill', 'fit']);
  assert.equal(field('heading', 'text_size', 'info').defaultChoice, 'xl');
  assert.deepEqual(widget('spacer', 'info').fields, []);
});
