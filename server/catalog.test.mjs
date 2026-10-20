// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, writeCatalog, inspectExamples, fieldType, documentedFields } from '../scripts/build-catalog.mjs';

const fixture = fileURLToPath(new URL('./fixtures/homepage/', import.meta.url));
const catalog = await buildCatalog(fixture);
const shipped = JSON.parse(await readFile(new URL('../public/catalog.json', import.meta.url), 'utf8'));
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
  assert.match(widget('komga').setupNotes.join(' '),/takes precedence/);
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
  assert.equal(shipped.service.length,169);assert.equal(shipped.info.length,14);
  for(const kind of ['service','info']){assert.equal(new Set(shipped[kind].map(item=>item.type)).size,shipped[kind].length);assert.ok(shipped[kind].every(item=>item.coverage&&item.documentationStatus));}
  assert.match(shipped.schemaNotice,/not runtime integration tests/);
});

test('incomplete documentation examples stay visible as warnings rather than fabricated schemas', () => {
  assert.equal(shipped.generationWarnings.length,2);
  assert.deepEqual(shipped.generationWarnings.map(item=>item.path).sort(),['docs/widgets/info/glances.md','docs/widgets/services/customapi.md']);
  assert.ok(shipped.generationWarnings.every(item=>item.block>0&&item.reason.includes('not treated as a schema')));
});

test('source-backed fixtures still match their pinned source manifest', async () => {
  const manifest=JSON.parse(await readFile(new URL('./fixtures/source-manifest.json',import.meta.url),'utf8'));
  for(const item of manifest.files){const bytes=await readFile(join(fixture,item.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path);}
});

test('generation is deterministic for the same pinned input', async () => {
  assert.deepEqual(await buildCatalog(fixture),catalog);
});

test('catalog generation preserves the project license notice and writes its own scoped notice', async () => {
  const destination=await mkdtemp(join(tmpdir(),'homepage-catalog-output-'));
  try{await mkdir(join(destination,'third-party'));await writeFile(join(destination,'third-party/NOTICE.txt'),'Keep derived renderer obligations.\n');await writeCatalog(fixture,destination);
    assert.equal(await readFile(join(destination,'third-party/NOTICE.txt'),'utf8'),'Keep derived renderer obligations.\n');
    assert.match(await readFile(join(destination,'third-party/catalog-NOTICE.txt'),'utf8'),/GPL-3\.0/);
    assert.deepEqual(JSON.parse(await readFile(join(destination,'public/catalog.json'),'utf8')),catalog);
  }finally{await rm(destination,{recursive:true,force:true});}
});

test('a mismatched source version cannot be mislabeled as the catalog pin', async () => {
  const source=await mkdtemp(join(tmpdir(),'homepage-catalog-version-'));
  try{await writeFile(join(source,'package.json'),JSON.stringify({version:'99.0.0'}));await assert.rejects(()=>buildCatalog(source),/verified Homepage v2\.6\.0/);}
  finally{await rm(source,{recursive:true,force:true});}
});
