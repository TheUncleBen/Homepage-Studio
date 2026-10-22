// SPDX-License-Identifier: AGPL-3.0-or-later
// Recovery regressions use only disposable temporary fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore } from './config.mjs';
import { DEFAULT_PLAYBACK } from './board.mjs';
import { DISCOVERY_UPSTREAM_COMMIT } from './discovery.mjs';

const fields = { servicesYaml:'services.yaml', widgetsYaml:'widgets.yaml', bookmarksYaml:'bookmarks.yaml', settingsYaml:'settings.yaml', dockerYaml:'docker.yaml', kubernetesYaml:'kubernetes.yaml', proxmoxYaml:'proxmox.yaml', customCss:'custom.css', customJs:'custom.js' };
async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-import-'));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const options = { configDir:path.join(root,'config'), stateDir:path.join(root,'state'), ...extra };
  const store = createConfigStore(options);
  await store.initialize();
  return { store, options, ...options };
}
async function populated(t) {
  const fixtureValue = await fixture(t), {store}=fixtureValue;
  let current = await store.save({ revision:(await store.load()).revision,
    servicesYaml:'# Preserve this comment\n- Lab:\n    - Host:\n        id: fixed-native-service\n        href: https://host.example.test\n        unknownOption: {preserved: true}\n        widget:\n          type: portainer\n          url: http://portainer.example.test\n          key: {{HOMEPAGE_FILE_PORTAINER_KEY}}\n',
    widgetsYaml:'- datetime: {}\n- search: {provider: google}\n',
    bookmarksYaml:'- Reading:\n    - Documentation:\n        - href: https://docs.example.test\n',
    settingsYaml:'title: Imported dashboard\nfutureOption: {nested: [one, two]}\n',
    dockerYaml:'local: {host: docker.example.test, port: 2375}\n',
    kubernetesYaml:'mode: default\n',
    proxmoxYaml:'local: {url: https://pve.example.test, token: "{{HOMEPAGE_VAR_PVE_TOKEN}}"}\n',
    customCss:':root { --studio-accent: #605064; }\n',
    customJs:'window.syntheticStudioImport = true;\n',
  });
  const board=structuredClone(current.board);
  board.stacks=[{id:'imported-stack',panelIds:current.infoWidgets.map(({id})=>id),rect:{x:0,y:30,w:6,h:4},playback:{...DEFAULT_PLAYBACK,manualHoldMs:45000}}];
  await store.saveBoard({revision:current.revision,board});
  return {...fixtureValue,current:await store.load(),archive:await store.exportCurrent()};
}

test('a complete dashboard export imports to another instance with all native bytes, IDs, stacks and unknown fields preserved', async(t)=>{
  const source=await populated(t),target=await fixture(t);
  const before=await target.store.load();
  const saved=await target.store.importArchive({revision:before.revision,archive:source.archive});
  for(const [field,file] of Object.entries(fields))assert.equal(saved[field],source.archive.files[file]);
  assert.deepEqual(saved.board,source.current.board);
  for(const field of ['infoWidgets','serviceWidgets','bookmarks'])assert.deepEqual(saved[field],source.current[field]);
  assert.equal((await target.store.listBackups()).length,1);
  assert.deepEqual((await createConfigStore(target.options).load()).board,saved.board);
  const beforeImport=(await target.store.listBackups())[0];
  const restored=await target.store.restoreBackup({revision:saved.revision,backupId:beforeImport.id});
  assert.deepEqual(restored.board.panels,[]);
  assert.equal(restored.customJs,'');
});

test('a downloaded full pre-save snapshot imports its earlier dashboard, including the initial empty state',async(t)=>{
  const source=await populated(t),target=await fixture(t);
  const before=source.current;
  await source.store.mutateSettings({revision:before.revision,config:{title:'After snapshot'}});
  const [snapshot]=await source.store.listBackups();
  const archive=await source.store.exportBackup(snapshot.id);
  archive.revision = 'The source revision is descriptive metadata, never target authorization.';
  let saved=await target.store.importArchive({revision:(await target.store.load()).revision,archive});
  assert.equal(saved.settingsYaml,before.settingsYaml);assert.deepEqual(saved.board,before.board);
  const oldest=(await source.store.listBackups()).at(-1);
  const emptyArchive=await source.store.exportBackup(oldest.id);
  assert.equal(emptyArchive.before['state.json'],null);
  saved=await target.store.importArchive({revision:saved.revision,archive:emptyArchive});
  assert.deepEqual(saved.board.panels,[]);assert.equal(saved.customCss,'');
});

test('import uses only the current target revision and serializes conflicting requests',async(t)=>{
  const source=await populated(t),target=await fixture(t);
  const before=await target.store.load();
  await assert.rejects(target.store.importArchive({revision:source.current.revision,archive:source.archive}),{code:'REVISION_CONFLICT'});
  assert.equal((await target.store.listBackups()).length,0);
  const result=await Promise.allSettled([target.store.importArchive({revision:before.revision,archive:source.archive}),target.store.importArchive({revision:before.revision,archive:source.archive})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(result.filter(r=>r.status==='rejected'&&r.reason.code==='REVISION_CONFLICT').length,1);
  assert.equal((await target.store.listBackups()).length,1);
});

test('invalid archive paths, missing files, malformed state and conflicting board identities reject before creating snapshots',async(t)=>{
  const source=await populated(t),target=await fixture(t);
  const before=await target.store.load();
  const cases=[];
  let value=structuredClone(source.archive);delete value.files['docker.yaml'];cases.push(value);
  value=structuredClone(source.archive);value.files['../../outside']='no';cases.push(value);
  value=structuredClone(source.archive);value.before={};cases.push(value);
  value=structuredClone(source.archive);value.unexpected='no';cases.push(value);
  value=structuredClone(source.archive);value.files['state.json']='{';cases.push(value);
  value=structuredClone(source.archive);value.files['state.json']=JSON.stringify({version:99});cases.push(value);
  value=structuredClone(source.archive);value.files['custom.css']='x'.repeat(2*1024*1024+1);cases.push(value);
  value=structuredClone(source.archive);value.files['services.yaml']='- invalid: [';cases.push(value);
  for(const mutate of [
    state=>state.board.stacks[0].panelIds.push('missing-panel'),
    state=>state.board.panels[1].id=state.board.panels[0].id,
    state=>state.board.panels.pop(),
    state=>state.board.version=99,
    state=>state.board.panels[1].rect=state.board.panels[0].rect,
  ]){value=structuredClone(source.archive);const state=JSON.parse(value.files['state.json']);mutate(state);value.files['state.json']=JSON.stringify(state);cases.push(value);}
  for(const archive of cases){
    await assert.rejects(target.store.importArchive({revision:before.revision,archive}));
    assert.equal((await target.store.load()).revision,before.revision);
    assert.equal((await target.store.listBackups()).length,0);
    await assert.rejects(fs.access(path.join(target.stateDir,'transaction.json')),{code:'ENOENT'});
  }
});

test('an import interrupted during replacement restores the exact target revision and remains reversible',async(t)=>{
  const source=await populated(t),target=await fixture(t);
  const before=await target.store.load();
  const rename=fs.rename;let injected=false;
  fs.rename=async(from,to,...args)=>{
    if(!injected&&to===path.join(target.configDir,'custom.js')){injected=true;throw Object.assign(new Error('Synthetic import disk failure'),{code:'EIO'});}
    return rename(from,to,...args);
  };
  try {await assert.rejects(target.store.importArchive({revision:before.revision,archive:source.archive}),{code:'EIO'});}
  finally {fs.rename=rename;}
  assert(injected);assert.equal((await target.store.load()).revision,before.revision);
  await assert.rejects(fs.access(path.join(target.stateDir,'transaction.json')),{code:'ENOENT'});
  const saved=await target.store.importArchive({revision:before.revision,archive:source.archive});
  assert.deepEqual(saved.board,source.current.board);
});

test('import replaces previous discovery metadata without claiming remote availability or carrying stale cached panels', async (t) => {
  function provider(number) {
    const id = `discovered-service-${number.toString(16).padStart(32, '0')}`;
    const source = { id, kind: 'service', title: `Discovered ${number}`, group: 'Lab', nativeLocator: {
      discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: `Discovered ${number}`, origin: 'docker',
    } };
    return { id, discoveryReader: async () => ({ protocolVersion: 1, upstreamCommit: DISCOVERY_UPSTREAM_COMMIT, sources: [source], warnings: [] }) };
  }
  const imported = provider(1), previous = provider(2);
  const source = await fixture(t, { discoveryReader: imported.discoveryReader });
  const target = await fixture(t, { discoveryReader: previous.discoveryReader });
  for (const { store } of [source, target]) {
    await store.refreshDiscovery('dashboard.example.test');
    const current = await store.load();
    await store.saveBoard({ revision: current.revision, board: current.board });
  }
  const archive = await source.store.exportCurrent();
  const before = await target.store.load();
  assert.deepEqual(before.discoveredSources.map(({ id }) => id), [previous.id]);
  const saved = await target.store.importArchive({ revision: before.revision, archive });
  assert.deepEqual(saved.discoveredSources.map(({ id, available }) => ({ id, available })), [{ id: imported.id, available: false }]);
  assert.deepEqual(saved.board.panels.map(({ id }) => id), [imported.id]);
  assert.deepEqual((await createConfigStore(target.options).load()).board, saved.board);
});
