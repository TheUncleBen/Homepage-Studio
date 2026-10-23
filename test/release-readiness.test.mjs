import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { UPSTREAM_COMMIT } from '../scripts/healthcheck.mjs';
import { artifactFingerprint } from '../scripts/release-manifest.mjs';
import { IMAGE_REPOSITORIES, PLATFORMS, TEMPLATE_FILES, QUALIFICATION_CHECKS, sha256, candidateFingerprint, validateCandidateManifest, validateQualificationReport, materializeCandidate, matchCandidateToRelease } from '../scripts/candidate-manifest.mjs';
import { inspectImageIndex, inspectImageDirectory } from '../scripts/inspect-image-set.mjs';
import { approvalStatement, verifyTrustedApproval, githubApi, boundedResponse } from '../scripts/release-guard.mjs';
import { RegistryAccessError, publicRegistry, registryReader } from '../scripts/ghcr-read.mjs';
import { QUALIFIED_BUNDLE_FILES, loadQualifiedCandidateBundle, prepareOfficialAssets, promoteRelease } from '../scripts/promote-release.mjs';
import { preparePromotionInputs } from '../scripts/prepare-promotion-inputs.mjs';
import { buildIdentity, stageNativeTarget, validateTargetReceipts, assembleCandidate, verifyCandidateDelivery, verifyPublicCandidate } from '../scripts/candidate-pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = 'a'.repeat(40);
const tree = 'f'.repeat(40);
const clone = value => structuredClone(value);
const json = value => Buffer.from(JSON.stringify(value));
const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';

function imageFixture(name, change = () => {}) {
  const blobs = new Map();
  const add = (mediaType, value) => {
    const bytes = json(value);
    const digest = `sha256:${sha256(bytes)}`;
    blobs.set(digest, bytes);
    return { mediaType, digest, size: bytes.length };
  };
  const descriptors = PLATFORMS.map(platform => {
    const [os, architecture] = platform.split('/');
    const config = { os, architecture, config: { Labels: {
      'org.opencontainers.image.source': 'https://github.com/TheUncleBen/Homepage-Studio',
      'org.opencontainers.image.revision': commit,
      'org.opencontainers.image.licenses': 'AGPL-3.0-or-later',
      'io.homepage-studio.upstream': UPSTREAM_COMMIT,
    }, Env: [`STUDIO_BUILD_REVISION=${commit}`] } };
    change(config, platform);
    const manifest = { schemaVersion: 2, mediaType: OCI_MANIFEST, config: add(OCI_CONFIG, config), layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: `sha256:${'e'.repeat(64)}`, size: 10 }] };
    return { ...add(OCI_MANIFEST, manifest), platform: { os, architecture } };
  });
  const index = { schemaVersion: 2, mediaType: OCI_INDEX, manifests: descriptors };
  return { index, indexBytes: json(index), blobs, add };
}

async function fixture() {
  const images = {};
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    const item = imageFixture(name);
    images[name] = await inspectImageIndex(item.indexBytes, value => item.blobs.get(value), { imageName: name, sourceCommit: commit });
  }
  const report = {
    schemaVersion: 1, sourceCommit: commit, sourceTree: tree, upstreamCommit: UPSTREAM_COMMIT,
    workflowRun: { repository: 'TheUncleBen/Homepage-Studio', runId: '456', attempt: 1 },
    targets: Object.fromEntries(PLATFORMS.map(platform => [platform, {
      runnerPlatform: platform,
      images: Object.fromEntries(Object.keys(images).map(name => [name, images[name].manifests[platform].configDigest])),
      checks: Object.fromEntries(QUALIFICATION_CHECKS.map(name => [name, 'passed'])),
    }])),
  };
  const files = { 'studio-source.tar.gz': Buffer.from('synthetic complete application source archive'), 'verification.json': json(report) };
  const templates = Object.fromEntries(await Promise.all(TEMPLATE_FILES.map(async name => [name, sha256(await fs.readFile(path.join(root, name)))])));
  const candidate = {
    schemaVersion: 1, status: 'engineering-qualified', sourceCommit: commit, sourceTree: tree, upstreamCommit: UPSTREAM_COMMIT,
    images, verification: { automated: 'passed', human: 'pending', reportSha256: sha256(files['verification.json']) },
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])), templates,
  };
  candidate.artifactSetSha256 = candidateFingerprint(candidate);
  const release = {
    schemaVersion: 1, status: 'owner-approved', version: '2026.10.20', sourceCommit: commit, upstreamCommit: UPSTREAM_COMMIT,
    images: Object.fromEntries(Object.entries(images).map(([name, image]) => [name, { reference: image.reference, buildRevision: image.buildRevision, platforms: image.platforms }])),
    verification: { automated: 'passed', human: 'passed', reportSha256: candidate.verification.reportSha256, humanAcceptanceSha256: 'b'.repeat(64) },
    approval: { actor: 'TheUncleBen', approvedAt: '2026-10-21T03:00:00Z' },
  };
  release.approval.artifactSetSha256 = artifactFingerprint(release);
  return { candidate, release, report, files };
}

function approvedContext(candidate, release) {
  const environment = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'TheUncleBen/Homepage-Studio', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_ACTOR: 'TheUncleBen', GITHUB_TRIGGERING_ACTOR: 'TheUncleBen', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123',
    GITHUB_SHA: 'd'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'TheUncleBen/Homepage-Studio/.github/workflows/promote-approved.yml@refs/heads/main',
  };
  const responses = {
    '': { full_name: 'TheUncleBen/Homepage-Studio', private: false, default_branch: 'main' },
    '/actions/runs/123': { id: 123, run_attempt: 1, event: 'workflow_dispatch', status: 'in_progress', head_branch: 'main', head_sha: environment.GITHUB_SHA, actor: { login: 'TheUncleBen' }, triggering_actor: { login: 'TheUncleBen' }, repository: { full_name: 'TheUncleBen/Homepage-Studio' }, path: '.github/workflows/promote-approved.yml' },
    '/actions/runs/456': { id: 456, run_attempt: 1, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: commit, actor: { login: 'TheUncleBen' }, triggering_actor: { login: 'TheUncleBen' }, repository: { full_name: 'TheUncleBen/Homepage-Studio' }, path: '.github/workflows/candidate-approved.yml' },
    '/environments/official-release': { id: 55, name: 'official-release', protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'TheUncleBen' } }] }] },
    '/actions/runs/123/approvals': [{ state: 'approved', comment: approvalStatement(candidate, release), environments: [{ id: 55, name: 'official-release' }], user: { login: 'TheUncleBen' } }],
  };
  return { environment, responses, request: async suffix => { assert.ok(Object.hasOwn(responses, suffix)); return responses[suffix]; }, now: new Date('2026-10-21T03:30:00Z') };
}

test('OCI inspection binds raw index, each architecture, config and native source identity', async () => {
  const f = imageFixture('studio');
  const actual = await inspectImageIndex(f.indexBytes, value => f.blobs.get(value), { imageName: 'studio', sourceCommit: commit });
  assert.equal(actual.reference, `${IMAGE_REPOSITORIES.studio}@sha256:${sha256(f.indexBytes)}`);
  assert.deepEqual(actual.platforms, PLATFORMS);
  for (const descriptor of f.index.manifests) assert.equal(actual.manifests[`linux/${descriptor.platform.architecture}`].digest, descriptor.digest);
});

test('OCI inspection rejects corrupt blobs, duplicate/missing platforms and mislabeled images', async () => {
  const options = { imageName: 'studio', sourceCommit: commit };
  const f = imageFixture('studio');
  await assert.rejects(inspectImageIndex(f.indexBytes, () => Buffer.from('changed'), options), /immutable descriptor/);
  for (const mutate of [index => index.manifests.pop(), index => index.manifests.push(index.manifests[0]), index => { index.manifests[0].platform.architecture = '386'; }, index => { index.manifests[0].digest = 'sha256:../../path'; }]) {
    const index = clone(f.index); mutate(index);
    await assert.rejects(inspectImageIndex(json(index), value => f.blobs.get(value), options));
  }
  for (const mutate of [config => { config.architecture = '386'; }, config => { config.config.Labels['org.opencontainers.image.revision'] = 'c'.repeat(40); }, config => { config.config.Labels['io.homepage-studio.upstream'] = 'c'.repeat(40); }, config => { config.config.Env.push(`STUDIO_BUILD_REVISION=${commit}`); }]) {
    const altered = imageFixture('studio', mutate);
    await assert.rejects(inspectImageIndex(altered.indexBytes, value => altered.blobs.get(value), options));
  }
});

test('OCI inspection permits bound provenance descriptors without treating them as architectures', async () => {
  const f = imageFixture('studio');
  const provenance = { schemaVersion: 2, mediaType: OCI_MANIFEST, config: {}, layers: [] };
  const descriptor = { ...f.add(OCI_MANIFEST, provenance), platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': f.index.manifests[0].digest } };
  f.index.manifests.push(descriptor);
  const inspected = await inspectImageIndex(json(f.index), value => f.blobs.get(value), { imageName: 'studio', sourceCommit: commit });
  assert.deepEqual(inspected.platforms, PLATFORMS);
  descriptor.annotations['vnd.docker.reference.digest'] = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(inspectImageIndex(json(f.index), value => f.blobs.get(value), { imageName: 'studio', sourceCommit: commit }), /Attestation/);
});

test('local metadata inspection rejects symlinked input and bounds bytes before parsing', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-image-fixture-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const f = imageFixture('studio');
  await fs.mkdir(path.join(temp, 'blobs'));
  await fs.writeFile(path.join(temp, 'index.json'), f.indexBytes);
  for (const [digest, bytes] of f.blobs) await fs.writeFile(path.join(temp, 'blobs', digest.slice(7)), bytes);
  const options = { imageName: 'studio', sourceCommit: commit };
  assert.equal((await inspectImageDirectory(path.join(temp, 'index.json'), path.join(temp, 'blobs'), options)).buildRevision, commit);
  await fs.symlink(path.join(temp, 'index.json'), path.join(temp, 'alias.json'));
  await assert.rejects(inspectImageDirectory(path.join(temp, 'alias.json'), path.join(temp, 'blobs'), options), /regular file/);
  await assert.rejects(inspectImageIndex(Buffer.alloc(4 * 1024 * 1024 + 1), () => {}, options), /bounded/);
});

test('candidate validation has no official date or fabricated human approval and binds every input', async () => {
  const { candidate } = await fixture();
  assert.equal(validateCandidateManifest(candidate).artifactSetSha256, candidate.artifactSetSha256);
  const reordered = Object.fromEntries(Object.entries(candidate).reverse());
  assert.equal(candidateFingerprint(reordered), candidate.artifactSetSha256);
  for (const mutate of [value => { value.verification.human = 'passed'; }, value => { value.status = 'owner-approved'; }, value => { value.version = '2026.10.20'; }, value => { value.images.studio.reference = `${IMAGE_REPOSITORIES.studio}:latest`; }, value => { value.images.studio.buildRevision = 'c'.repeat(40); }, value => { value.images.studio.platforms.pop(); }, value => { value.images.studio.manifests['linux/arm64'].configDigest = ''; }, value => { value.files['verification.json'] = 'e'.repeat(64); }, value => { value.templates['portainer-compose.yml'] = ''; }]) {
    const altered = clone(candidate); mutate(altered); altered.artifactSetSha256 = candidateFingerprint(altered);
    assert.throws(() => validateCandidateManifest(altered));
  }
  const stale = clone(candidate); stale.files['studio-source.tar.gz'] = 'e'.repeat(64);
  assert.throws(() => validateCandidateManifest(stale), /fingerprint/);
});

test('candidate qualification binds tested config digests and requires every architecture/check', async () => {
  const { candidate, report } = await fixture();
  validateQualificationReport(report, candidate);
  for (const mutate of [value => { value.sourceCommit = 'c'.repeat(40); }, value => { value.sourceTree = 'c'.repeat(40); }, value => { value.targets['linux/arm64'].runnerPlatform = 'linux/amd64'; }, value => { value.targets['linux/amd64'].images.studio = 'sha256:' + 'c'.repeat(64); }, value => { value.targets['linux/arm64'].checks.swarm = 'not-run'; }, value => { delete value.targets['linux/amd64'].checks.browser; }]) {
    const altered = clone(report); mutate(altered);
    assert.throws(() => validateQualificationReport(altered, candidate));
  }
  for (const name of QUALIFICATION_CHECKS) {
    const altered = clone(report); delete altered.targets['linux/arm64'].checks[name];
    assert.throws(() => validateQualificationReport(altered, candidate), /Every required engineering check/);
  }
  for (const change of [value => { delete value.workflowRun; }, value => { value.workflowRun.runId = '0'; }, value => { value.workflowRun.attempt = 2; }, value => { value.workflowRun.repository = 'another/repository'; }]) {
    const altered = clone(report); change(altered);
    assert.throws(() => validateQualificationReport(altered, candidate), /exact candidate workflow run/);
  }
});

test('candidate materialization pins Portainer assets, verifies source/evidence hashes and never overwrites', async t => {
  const { candidate, files } = await fixture();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-candidate-fixture-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const inputs = path.join(temp, 'inputs'); await fs.mkdir(inputs);
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(inputs, name), bytes);
  const output = path.join(temp, 'bundle');
  await materializeCandidate(candidate, inputs, root, output);
  for (const name of TEMPLATE_FILES) {
    const text = await fs.readFile(path.join(output, name), 'utf8');
    for (const image of Object.values(candidate.images)) assert.ok(text.includes(image.reference));
    assert.ok(!text.includes('${STUDIO_IMAGE:'));
  }
  const sums = (await fs.readFile(path.join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  for (const line of sums) { const [digest, filename] = line.split('  '); assert.equal(sha256(await fs.readFile(path.join(output, filename))), digest); }
  await assert.rejects(materializeCandidate(candidate, inputs, root, output), { code: 'EEXIST' });
  await fs.appendFile(path.join(inputs, 'studio-source.tar.gz'), 'changed');
  await assert.rejects(materializeCandidate(candidate, inputs, root, path.join(temp, 'wrong')), /input hash differs/);
  await assert.rejects(fs.lstat(path.join(temp, 'wrong')), { code: 'ENOENT' });
});

test('official matching refuses rebuilding either image or substituting engineering evidence', async () => {
  const { candidate, release } = await fixture();
  matchCandidateToRelease(candidate, release);
  for (const mutate of [value => { value.images.studio.reference = IMAGE_REPOSITORIES.studio + '@sha256:' + '1'.repeat(64); }, value => { value.images.studio.reference = IMAGE_REPOSITORIES.studio + '@sha256:' + '1'.repeat(64); }, value => { value.verification.reportSha256 = '1'.repeat(64); }]) {
    const altered = clone(release); mutate(altered); altered.approval.artifactSetSha256 = artifactFingerprint(altered);
    assert.throws(() => matchCandidateToRelease(candidate, altered), /preserve|retain/);
  }
});

test('trusted guard accepts actual owner self-approval bound to the candidate and release', async () => {
  const { candidate, release } = await fixture();
  const context = approvedContext(candidate, release);
  const receipt = await verifyTrustedApproval(candidate, release, context);
  assert.equal(receipt.actor, 'TheUncleBen');
  assert.equal(receipt.candidateArtifactSetSha256, candidate.artifactSetSha256);
  assert.equal(receipt.releaseArtifactSetSha256, release.approval.artifactSetSha256);
});

test('trusted guard rejects absent protections, bypass, replay, wrong owner/default branch and old date', async () => {
  const { candidate, release } = await fixture();
  for (const mutate of [
    value => { value.environment.GITHUB_ACTIONS = ''; },
    value => { value.environment.GITHUB_RUN_ATTEMPT = '2'; },
    value => { value.environment.GITHUB_ACTOR = 'another-user'; },
    value => { value.environment.GITHUB_REF = 'refs/heads/unreviewed'; },
    value => { value.environment.GITHUB_WORKFLOW_REF = 'another/repository/.github/workflows/promote-approved.yml@refs/heads/main'; },
    value => { value.responses['/actions/runs/123'].head_sha = 'f'.repeat(40); },
    value => { value.responses['/actions/runs/123'].event = 'pull_request'; },
    value => { value.responses['/environments/official-release'].protection_rules = []; },
    value => { value.responses['/environments/official-release'].protection_rules[0].prevent_self_review = true; },
    value => { value.responses['/actions/runs/123/approvals'] = []; },
    value => { value.responses['/actions/runs/123/approvals'][0].user.login = 'another-user'; },
    value => { value.responses['/actions/runs/123/approvals'][0].state = 'rejected'; },
    value => { value.responses['/actions/runs/123/approvals'][0].comment = 'Approved'; },
    value => { value.responses['/actions/runs/123/approvals'][0].environments[0].id = 99; },
    value => { value.responses['/actions/runs/123/approvals'].push(clone(value.responses['/actions/runs/123/approvals'][0])); },
    value => { value.now = new Date('2026-10-21T05:01:00Z'); },
  ]) {
    const context = approvedContext(candidate, release); mutate(context);
    await assert.rejects(verifyTrustedApproval(candidate, release, context));
  }
});

test('GitHub transport never follows credential redirects or swallows access failures', async () => {
  const calls = [];
  const api = githubApi('synthetic-token', async (url, options) => {
    calls.push({ url, options });
    return new Response('{"full_name":"TheUncleBen/Homepage-Studio"}', { status: 200 });
  });
  await api('');
  assert.equal(calls[0].url, 'https://api.github.com/repos/TheUncleBen/Homepage-Studio');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.method, 'GET');
  for (const suffix of ['https://example.test', '//example.test', '/../other-repository']) await assert.rejects(api(suffix), /Invalid/);
  const denied = githubApi('synthetic-token', async () => new Response('synthetic private server text', { status: 403 }));
  await assert.rejects(denied('/environments/official-release'), error => error.message.includes('403') && !error.message.includes('synthetic private'));
  const missing = githubApi('synthetic-token', async () => new Response('{}', { status: 404 }));
  assert.equal(await missing('/releases/tags/2026.10.20', { absent: true }), null);
  await assert.rejects(boundedResponse(new Response('x'.repeat(20)), 10), /size limit/);
});

test('dispatch input preparation treats multiline JSON as data and preserves evidence bytes', async t => {
  const { candidate, release, files } = await fixture();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-input-fixture-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const environment = { STUDIO_CANDIDATE_MANIFEST: JSON.stringify(candidate, null, 2), STUDIO_RELEASE_MANIFEST: JSON.stringify(release, null, 2), STUDIO_QUALIFICATION_REPORT: files['verification.json'].toString() };
  const result = await preparePromotionInputs(path.join(temp, 'inputs'), environment);
  assert.equal(result.sourceCommit, commit);
  assert.equal(result.candidateRunId, '456');
  assert.equal(result.approvalStatement, approvalStatement(candidate, release));
  assert.equal(sha256(await fs.readFile(path.join(temp, 'inputs/verification.json'))), candidate.verification.reportSha256);
  await assert.rejects(preparePromotionInputs(path.join(temp, 'changed'), { ...environment, STUDIO_QUALIFICATION_REPORT: environment.STUDIO_QUALIFICATION_REPORT + '\n' }), /report bytes differ/);
});

test('anonymous GHCR readback follows only the exact pull challenge and drops authorization at the CDN', async () => {
  const calls = [];
  const digest = 'sha256:' + 'a'.repeat(64);
  const reader = publicRegistry('studio', async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://ghcr.io/token?')) { assert.equal(options.headers, undefined); return new Response('{"token":"synthetic-anonymous-token"}'); }
    if (url.startsWith('https://pkg-containers.githubusercontent.com/')) { assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error'); return new Response('raw config'); }
    if (!options.headers.authorization) return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:theuncleben/homepage-studio:pull"' } });
    return new Response('', { status: 307, headers: { location: 'https://pkg-containers.githubusercontent.com/fixture' } });
  });
  assert.equal((await reader('blobs', digest)).toString(), 'raw config');
  assert.equal(calls.length, 4);
  const errorReader = publicRegistry('studio', async () => new Response('denied', { status: 403 }));
  await assert.rejects(errorReader('manifests', '2026.10.20', { absent: true }), /403/);
  const unsafeReader = publicRegistry('studio', async () => new Response('', { status: 307, headers: { location: 'https://example.test/credentials' } }));
  await assert.rejects(unsafeReader('blobs', digest), /Unexpected registry blob redirect/);
  const missingReader = publicRegistry('studio', async () => new Response('', { status: 404 }));
  assert.equal(await missingReader('manifests', '2026.10.20', { absent: true }), null);
});

async function publicationFixture(t) {
  const { candidate, release, files } = await fixture();
  const context = approvedContext(candidate, release);
  context.environment.GITHUB_TOKEN = 'synthetic-token';
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-promotion-fixture-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const inputs = path.join(temp, 'inputs'); await fs.mkdir(inputs);
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(inputs, name), bytes);
  const assets = await prepareOfficialAssets(candidate, release, inputs, root, path.join(temp, 'official'));
  const bundleDirectory = path.join(temp, 'qualified-bundle'); await fs.mkdir(bundleDirectory);
  for (const name of QUALIFIED_BUNDLE_FILES) await fs.writeFile(path.join(bundleDirectory, name), assets[name]);
  const qualifiedBundle = await loadQualifiedCandidateBundle(bundleDirectory);
  const templateSources = Object.fromEntries(await Promise.all(TEMPLATE_FILES.map(async name => [name, await fs.readFile(path.join(root, name))])));
  const state = { writes: [], docker: [], uploads: [], layerReads: [], tagged: new Set(), ref: null, existingTag: false, existingRef: false, badUpload: false, badPromotion: false, workflowMismatch: false };
  const request = async (suffix, options = {}) => {
    if (!options.method || options.method === 'GET') {
      if (Object.hasOwn(context.responses, suffix)) return context.responses[suffix];
      if (suffix === `/git/ref/tags/${release.version}`) return state.existingRef ? { ref: 'existing' } : state.ref;
      if (suffix === `/releases/tags/${release.version}`) return null;
      if (suffix === `/git/commits/${commit}`) return { sha: commit, tree: { sha: tree } };
      if (suffix === '/git/ref/heads/main') return { object: { type: 'commit', sha: state.workflowMismatch ? 'd'.repeat(40) : commit } };
      if (suffix === `/git/commits/${'d'.repeat(40)}`) return { sha: 'd'.repeat(40), tree: { sha: 'b'.repeat(40) } };
      if (suffix.startsWith('/git/trees/')) return { tree: [{ path: '.github/workflows', type: 'tree', sha: suffix.includes(tree) ? '1'.repeat(40) : '2'.repeat(40) }], truncated: false };
      if (suffix === '/releases/999/assets?per_page=100') return state.uploads;
      throw new Error('Unexpected fixture read: ' + suffix);
    }
    state.writes.push({ suffix, ...options });
    if (suffix === '/git/refs' && options.method === 'POST') { state.ref = { ref: options.body.ref, object: { sha: options.body.sha } }; return state.ref; }
    if (suffix === '/releases' && options.method === 'POST') return { id: 999, draft: true, tag_name: release.version };
    if (suffix === '/releases/999' && options.method === 'PATCH') return { id: 999, draft: false, tag_name: release.version, target_commitish: commit, immutable: false };
    throw new Error('Unexpected fixture write: ' + suffix);
  };
  const imageFixtures = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, imageFixture(name)]));
  const registry = name => {
    const read = async (kind, reference, options = {}) => {
      const item = imageFixtures[name];
      if (reference === release.version) {
        if (options.absent && !state.tagged.has(name)) return state.existingTag ? item.indexBytes : null;
        assert.ok(state.tagged.has(name));
        return state.badPromotion ? Buffer.from('different image bytes') : item.indexBytes;
      }
      if (reference === candidate.images[name].reference.split('@')[1]) return item.indexBytes;
      assert.ok(item.blobs.has(reference));
      return item.blobs.get(reference);
    };
    read.verifyBlob = async (digest, size) => {
      state.layerReads.push({ name, digest, size });
      if (state.layerUnavailable) throw new Error('Synthetic public runtime layer unavailable');
      return { digest, size };
    };
    return read;
  };
  const docker = async (args, input) => {
    state.docker.push(args);
    if (args[0] === 'login') { assert.equal(input, 'synthetic-token\n'); return; }
    assert.deepEqual(args.slice(0, 4), ['buildx', 'imagetools', 'create', '--tag']);
    const name = Object.keys(IMAGE_REPOSITORIES).find(name => args[4] === `${IMAGE_REPOSITORIES[name]}:${release.version}`);
    assert.ok(name); assert.equal(args[5], candidate.images[name].reference); assert.equal(args.length, 6);
    state.tagged.add(name);
  };
  const upload = async (name, bytes, id) => {
    assert.equal(id, 999);
    const result = { name, size: bytes.length, state: 'uploaded', digest: `sha256:${state.badUpload ? '0'.repeat(64) : sha256(bytes)}` };
    state.uploads.push(result); return result;
  };
  return { candidate, release, assets, context, state, options: { ...context, request, registry, docker, upload, templateSources, qualifiedBundle } };
}

test('official promotion preserves image bytes, creates one fresh ref and publishes only after every asset hash matches', async t => {
  const f = await publicationFixture(t);
  f.context.responses['/actions/runs/456'].path += '@main'; // Documented REST representation; bare paths are also returned.
  const receipt = await promoteRelease(f.candidate, f.release, f.assets, f.options);
  assert.equal(receipt.releaseId, 999);
  assert.equal(receipt.githubImmutable, false, 'GitHub optional immutability is not fabricated or required.');
  assert.equal(f.state.docker.length, 2);
  assert.equal(f.state.uploads.length, 8);
  assert.equal(f.state.layerReads.length, 1, 'Shared layers are verified once within the application repository.');
  assert.deepEqual(f.state.writes.map(item => [item.method, item.suffix]), [['POST', '/git/refs'], ['POST', '/releases'], ['PATCH', '/releases/999']]);
  assert.equal(f.state.writes.at(-1).body.draft, false);
});

test('official promotion stops before any write when anonymous runtime layers are unavailable despite valid metadata', async t => {
  const f = await publicationFixture(t);
  f.state.layerUnavailable = true;
  await assert.rejects(promoteRelease(f.candidate, f.release, f.assets, f.options), /runtime layer unavailable/);
  assert.equal(f.state.layerReads.length, 1);
  assert.deepEqual(f.state.writes, []);
  assert.deepEqual(f.state.docker, []);
  assert.deepEqual(f.state.uploads, []);
});

test('official promotion stops before any write while the accepted package remains private', async t => {
  const f = await publicationFixture(t);
  const registry = f.options.registry;
  f.options.registry = name => name === 'studio' ? async () => { throw new RegistryAccessError(403, true); } : registry(name);
  await assert.rejects(promoteRelease(f.candidate, f.release, f.assets, f.options), /publicly readable/);
  assert.deepEqual(f.state.writes, []);
  assert.deepEqual(f.state.docker, []);
  assert.deepEqual(f.state.uploads, []);
});

test('failed approval, changed assets and existing date tags produce no remote writes', async t => {
  for (const change of [
    f => { f.context.responses['/actions/runs/123/approvals'] = []; },
    f => { f.assets['portainer-compose.yml'] = Buffer.from('unapproved deployment'); },
    f => { f.assets['studio-source.tar.gz'] = Buffer.from('changed source'); },
    f => { f.state.existingTag = true; },
    f => { f.state.existingRef = true; },
    f => { f.state.workflowMismatch = true; },
    f => { f.context.responses['/actions/runs/456'].conclusion = 'failure'; },
    f => { f.context.responses['/actions/runs/456'].status = 'in_progress'; },
    f => { f.context.responses['/actions/runs/456'].path = '.github/workflows/validate.yml'; },
    f => { f.context.responses['/actions/runs/456'].head_sha = 'b'.repeat(40); },
    f => { f.context.responses['/actions/runs/456'].event = 'pull_request'; },
    f => { f.context.responses['/actions/runs/456'].event = 'push'; f.context.responses['/actions/runs/456'].head_commit = { message: 'Validate only' }; },
    f => { f.context.responses['/actions/runs/456'].run_attempt = 2; },
    f => { f.options.qualifiedBundle = undefined; },
    f => { f.options.qualifiedBundle['candidate-manifest.json'] = Buffer.from('{}\n'); },
    f => { f.options.qualifiedBundle['verification.json'] = Buffer.from('self-consistent replacement report'); },
    f => { f.options.qualifiedBundle['studio-source.tar.gz'] = Buffer.from('different source archive'); },
    f => { f.options.qualifiedBundle['portainer-swarm.yml'] = Buffer.from('different deployment template'); },
  ]) {
    const f = await publicationFixture(t); change(f);
    await assert.rejects(promoteRelease(f.candidate, f.release, f.assets, f.options));
    assert.deepEqual(f.state.writes, []);
    assert.deepEqual(f.state.docker, []);
    assert.deepEqual(f.state.uploads, []);
  }
});

test('partial registry or upload failure never publishes a release, retries, overwrites or deletes artifacts', async t => {
  for (const change of [f => { f.state.badPromotion = true; }, f => { f.state.badUpload = true; }]) {
    const f = await publicationFixture(t); change(f);
    await assert.rejects(promoteRelease(f.candidate, f.release, f.assets, f.options));
    assert.ok(f.state.writes.some(item => item.suffix === '/git/refs'));
    assert.ok(!f.state.writes.some(item => item.method === 'PATCH' || item.method === 'DELETE'));
    assert.ok(f.state.docker.every(args => !args.includes('build') && !args.includes('--append')));
  }
});

async function candidatePipelineFixture({ event = 'push', publicAccess = false } = {}) {
  const f = await fixture();
  const context = approvedContext(f.candidate, f.release);
  Object.assign(context.environment, { GITHUB_TOKEN: 'synthetic-token', GITHUB_EVENT_NAME: event, GITHUB_ACTOR: 'delivery-integration', GITHUB_TRIGGERING_ACTOR: 'delivery-integration', GITHUB_SHA: commit, STUDIO_CANDIDATE_SOURCE: commit, GITHUB_WORKFLOW_REF: 'TheUncleBen/Homepage-Studio/.github/workflows/candidate-approved.yml@refs/heads/main' });
  Object.assign(context.responses['/actions/runs/123'], { event, head_sha: commit, path: '.github/workflows/candidate-approved.yml', actor: { login: 'delivery-integration' }, triggering_actor: { login: 'delivery-integration' }, head_commit: { message: 'Prepare tested containers [deliver-candidate]' } });
  const calls = [];
  context.request = async suffix => {
    calls.push(suffix);
    assert.ok(['', '/actions/runs/123'].includes(suffix), 'Candidate delivery must not query approvals, environments or package REST metadata.');
    return context.responses[suffix];
  };
  const identity = buildIdentity(context.environment);
  const fixtures = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, imageFixture(name)]));
  const state = { docker: [], calls, reads: [], tags: new Map(), pulledReferences: new Map(), pulledImages: new Map(), runnerPlatform: 'linux/amd64', wrongLocalId: false, wrongLocalRevision: false, failPush: false, failAssembly: false, wrongPull: false, wrongPullOs: false, wrongPullArchitecture: false, publicAccess, publicError: null, layerReads: [], layerError: null };
  const registry = (name, scope) => {
    const read = async (kind, reference, options = {}) => {
    assert.ok(['authenticated', 'public'].includes(scope));
    state.reads.push({ name, scope, kind, reference });
    if (scope === 'public') {
      if (state.publicError) throw state.publicError;
      if (!state.publicAccess) throw new RegistryAccessError(403, true);
    }
    const repository = IMAGE_REPOSITORIES[name];
    if (reference.startsWith('build-')) {
      const value = state.tags.get(`${repository}:${reference}`);
      if (value) return value;
      if (options.absent) return null;
      throw new Error('Fixture tag is absent; first-use must push before attempting pull-only readback.');
    }
    const item = fixtures[name];
    if (reference === f.candidate.images[name].reference.split('@')[1]) return item.indexBytes;
    assert.ok(item.blobs.has(reference));
    return item.blobs.get(reference);
    };
    read.verifyBlob = async (digest, size) => {
      assert.equal(scope, 'public');
      if (state.layerError) throw state.layerError;
      state.layerReads.push({ name, digest, size });
      return { digest, size };
    };
    return read;
  };
  const docker = async (args, input) => {
    state.docker.push(args);
    if (args[0] === 'login') { assert.equal(input, 'synthetic-token\n'); return ''; }
    if (args[0] === 'logout' || args[0] === 'tag') return '';
    if (args[0] === 'pull') {
      assert.equal(args.length, 4);
      assert.equal(args[1], '--platform');
      const [repository, digest] = args[3].split('@');
      const name = Object.keys(IMAGE_REPOSITORIES).find(name => IMAGE_REPOSITORIES[name] === repository);
      assert.ok(name && digest, 'Pull an immutable image from an intended package.');
      const item = fixtures[name];
      const descriptor = digest === f.candidate.images[name].reference.split('@')[1]
        ? item.index.manifests.find(value => `${value.platform.os}/${value.platform.architecture}` === args[2])
        : item.index.manifests.find(value => value.digest === digest);
      assert.ok(descriptor, 'The requested digest must belong to the verified image index.');
      assert.equal(`${descriptor.platform.os}/${descriptor.platform.architecture}`, args[2]);
      const manifest = JSON.parse(item.blobs.get(descriptor.digest));
      const config = JSON.parse(item.blobs.get(manifest.config.digest));
      const previous = state.pulledReferences.get(args[3]);
      if (previous && previous !== manifest.config.digest) throw new Error(`cannot overwrite digest ${digest}`);
      state.pulledReferences.set(args[3], manifest.config.digest);
      state.pulledImages.set(manifest.config.digest, { Id: manifest.config.digest, Os: config.os, Architecture: config.architecture });
      return '';
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (args[2].startsWith('sha256:')) {
        assert.equal(args.length, 3, 'Use the Docker 28.0.4/API 1.48 inspect-by-ID contract.');
        const actual = state.pulledImages.get(args[2]);
        assert.ok(actual, 'Inspect only an image that this daemon actually pulled.');
        return JSON.stringify([{ ...actual, Id: state.wrongPull ? 'sha256:' + 'e'.repeat(64) : actual.Id, Os: state.wrongPullOs ? 'windows' : actual.Os, Architecture: state.wrongPullArchitecture ? '386' : actual.Architecture }]);
      }
      assert.equal(args[2], 'homepage-studio-ci:application');
      const name = 'studio';
      const id = f.candidate.images[name].manifests[state.runnerPlatform].configDigest;
      return JSON.stringify([{ Id: state.wrongLocalId ? 'sha256:' + 'e'.repeat(64) : id, Os: 'linux', Architecture: state.runnerPlatform.split('/')[1], Config: { Labels: { 'org.opencontainers.image.revision': state.wrongLocalRevision ? 'c'.repeat(40) : commit } } }]);
    }
    if (args[0] === 'push') {
      if (state.failPush) throw new Error('Synthetic authenticated push failure.');
      const repository = args[1].split(':')[0];
      const name = Object.keys(IMAGE_REPOSITORIES).find(name => IMAGE_REPOSITORIES[name] === repository);
      assert.ok(name, 'Only the intended application package may be written.');
      assert.equal(args[1], `${repository}:${identity}-${state.runnerPlatform.split('/')[1]}`);
      assert.ok(!state.tags.has(args[1]), 'Fresh run/architecture identities must not reuse tags.');
      const descriptor = fixtures[name].index.manifests.find(item => item.platform.architecture === state.runnerPlatform.split('/')[1]);
      state.tags.set(args[1], fixtures[name].blobs.get(descriptor.digest));
      return '';
    }
    assert.deepEqual(args.slice(0, 4), ['buildx', 'imagetools', 'create', '--tag']);
    const repository = args[4].split(':')[0];
    const name = Object.keys(IMAGE_REPOSITORIES).find(name => IMAGE_REPOSITORIES[name] === repository);
    assert.ok(name);
    assert.equal(args[4], `${repository}:${identity}`);
    assert.ok(!state.tags.has(args[4]), 'An existing assembled index must not be overwritten.');
    if (state.failAssembly) throw new Error('Synthetic index assembly failure.');
    assert.deepEqual(args.slice(5), PLATFORMS.map(platform => `${repository}@${f.candidate.images[name].manifests[platform].digest}`));
    state.tags.set(args[4], fixtures[name].indexBytes);
    return '';
  };
  const seedIndexes = () => {
    for (const name of Object.keys(IMAGE_REPOSITORIES)) state.tags.set(`${IMAGE_REPOSITORIES[name]}:${identity}`, fixtures[name].indexBytes);
  };
  return { ...f, context, state, fixtures, identity, seedIndexes, options: { ...context, registry, docker } };
}

async function stageFixtureTargets(f) {
  const receipts = [];
  for (const platform of PLATFORMS) {
    f.state.runnerPlatform = platform;
    receipts.push(await stageNativeTarget(platform, tree, { ...f.options, runnerPlatform: platform }));
  }
  return receipts;
}

async function candidateInputs(t, f) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-candidate-assembly-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.writeFile(path.join(temp, 'studio-source.tar.gz'), f.files['studio-source.tar.gz']);
  return temp;
}

test('native candidate retention rejects emulation, unrelated runs, missing delivery requests and stale identities before image writes', async () => {
  for (const change of [
    f => { f.options.runnerPlatform = 'linux/arm64'; },
    f => { f.context.environment.GITHUB_REPOSITORY = 'another/repository'; },
    f => { f.context.environment.GITHUB_REF = 'refs/heads/unreviewed'; },
    f => { f.context.environment.GITHUB_EVENT_NAME = 'pull_request'; },
    f => { f.context.responses['/actions/runs/123'].head_commit.message = 'Only validate source'; },
    f => { f.context.responses['/actions/runs/123'].head_sha = 'b'.repeat(40); },
    f => { f.context.responses['/actions/runs/123'].event = 'workflow_dispatch'; },
    f => { f.context.responses['/actions/runs/123'].path = '.github/workflows/validate.yml'; },
    f => { f.context.responses['/actions/runs/123'].status = 'completed'; },
    f => { f.context.environment.STUDIO_CANDIDATE_SOURCE = 'b'.repeat(40); },
    f => { f.context.environment.GITHUB_RUN_ATTEMPT = '2'; },
  ]) {
    const f = await candidatePipelineFixture(); f.options.runnerPlatform = 'linux/amd64'; change(f);
    await assert.rejects(stageNativeTarget('linux/amd64', tree, f.options));
    assert.deepEqual(f.state.docker, []);
  }
});

test('first-use direct delivery uses the standard workflow token and preserves the exact tested application image ID without owner approval or metadata probes', async () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const f = await candidatePipelineFixture({ event });
    const target = await stageNativeTarget('linux/amd64', tree, { ...f.options, runnerPlatform: 'linux/amd64' });
    assert.equal(target.images.studio.configDigest, f.candidate.images.studio.manifests['linux/amd64'].configDigest);
    assert.deepEqual(target.checks, Object.fromEntries(QUALIFICATION_CHECKS.map(name => [name, 'passed'])));
    assert.equal(f.state.docker.filter(args => args[0] === 'push').length, 1);
    assert.ok(f.state.docker.filter(args => args[0] === 'push').every(args => !args[1].includes('-staging')));
    assert.deepEqual(f.state.calls, ['', '/actions/runs/123']);
  }
  const bad = await candidatePipelineFixture(); bad.state.wrongLocalId = true;
  await assert.rejects(stageNativeTarget('linux/amd64', tree, { ...bad.options, runnerPlatform: 'linux/amd64' }), /differ from the exact locally tested/);
  assert.equal(bad.state.docker.filter(args => args[0] === 'push').length, 1, 'A mismatched image must stop before candidate completion.');
  const wrongRevision = await candidatePipelineFixture(); wrongRevision.state.wrongLocalRevision = true;
  await assert.rejects(stageNativeTarget('linux/amd64', tree, { ...wrongRevision.options, runnerPlatform: 'linux/amd64' }), /locally qualified image identity/);
  assert.equal(wrongRevision.state.docker.filter(args => args[0] === 'push').length, 0);
  const denied = await candidatePipelineFixture(); denied.state.failPush = true;
  await assert.rejects(stageNativeTarget('linux/amd64', tree, { ...denied.options, runnerPlatform: 'linux/amd64' }), /authenticated push failure/);
  assert.equal(denied.state.docker.filter(args => args[0] === 'push').length, 1);
});

test('complete native receipts bind both Portainer gates, every browser gate and the exact build before direct index assembly', async t => {
  const f = await candidatePipelineFixture();
  const receipts = await stageFixtureTargets(f);
  validateTargetReceipts(receipts, f.context.environment);
  for (const change of [value => value.pop(), value => { value[1].runnerPlatform = 'linux/amd64'; }, value => { value[1].buildIdentity += '-other'; }, value => { delete value[1].checks.portainerCompose; }, value => { value[1].checks.portainerSwarm = 'not-run'; }, value => { value[0].checks.hiddenDocument = 'not-run'; }, value => { value[1].sourceTree = 'b'.repeat(40); }]) {
    const altered = clone(receipts); change(altered); assert.throws(() => validateTargetReceipts(altered, f.context.environment));
  }
  const temp = await candidateInputs(t, f);
  const candidate = await assembleCandidate(receipts, temp, f.options);
  validateQualificationReport(JSON.parse(await fs.readFile(path.join(temp, 'verification.json'), 'utf8')), candidate);
  assert.deepEqual(candidate.images, f.candidate.images);
  assert.equal(candidate.verification.human, 'pending');
  assert.equal(f.state.docker.filter(args => args[0] === 'buildx').length, 1);
});

test('changed index tags and partial assembly failures never overwrite or invent a completed candidate', async t => {
  for (const collision of [true, false]) {
    const f = await candidatePipelineFixture();
    const receipts = await stageFixtureTargets(f);
    const temp = await candidateInputs(t, f);
    if (collision) f.seedIndexes(); else f.state.failAssembly = true;
    await assert.rejects(assembleCandidate(receipts, temp, f.options), collision ? /already exists/ : /assembly failure/);
    assert.equal(f.state.docker.filter(args => args[0] === 'buildx').length, collision ? 0 : 1);
    await assert.rejects(fs.stat(path.join(temp, 'verification.json')), { code: 'ENOENT' });
  }
});

test('first private package access preserves the qualified candidate and exact authenticated pulls, then public verification resumes without rebuilding', async () => {
  const f = await candidatePipelineFixture(); f.seedIndexes();
  const result = await verifyCandidateDelivery(f.candidate, f.options);
  assert.equal(result.status, 'package-access-pending');
  assert.equal(result.authenticatedPulls, 'passed');
  assert.equal(result.anonymousAccess, 'pending');
  assert.equal(result.officialRelease, false);
  assert.deepEqual(result.pendingPackages, Object.values(IMAGE_REPOSITORIES));
  assert.equal(f.state.docker.filter(args => args[0] === 'pull').length, 2);
  assert.ok(f.state.docker.every(args => !['build', 'buildx', 'push'].includes(args[0])));
  f.state.publicAccess = true; // Simulates the one-time GitHub package setting only.
  const verified = await verifyPublicCandidate(f.candidate, f.options);
  assert.equal(verified.anonymousAccess, 'passed');
  assert.equal(verified.verificationMethod, 'registry-stream-sha256');
  assert.deepEqual(verified.pendingPackages, []);
  assert.equal(verified.layers.length, 1, 'Shared architecture layers are deduplicated within each repository, never across repository permissions.');
  assert.equal(f.state.layerReads.length, 1);
  assert.equal(f.state.docker.filter(args => args[0] === 'pull').length, 2, 'Post-visibility verification runs without Docker.');
  assert.ok(f.state.docker.every(args => !['build', 'buildx', 'push'].includes(args[0])));
});

test('public candidate completion verifies the application on both architectures anonymously and creates no release or moving tags', async () => {
  const f = await candidatePipelineFixture({ publicAccess: true }); f.seedIndexes();
  const result = await verifyCandidateDelivery(f.candidate, f.options);
  assert.equal(result.status, 'public-ready');
  assert.equal(result.anonymousAccess, 'passed');
  assert.equal(result.officialRelease, false);
  const authenticated = f.state.docker.filter(args => args[0] === 'pull');
  assert.equal(authenticated.length, 2);
  assert.deepEqual(authenticated.map(args => [args[2], args[3]]).sort(), Object.entries(f.candidate.images).flatMap(([name, image]) => PLATFORMS.map(platform => [platform, `${IMAGE_REPOSITORIES[name]}@${image.manifests[platform].digest}`])).sort());
  assert.equal(result.verificationMethod, 'registry-stream-sha256');
  assert.equal(result.layers.length, 1);
  assert.equal(f.state.layerReads.length, 1);
  assert.ok(f.state.docker.every(args => !args.some(arg => arg === 'latest' || /^\d{4}\.\d{2}\.\d{2}$/.test(arg))));
});

test('authenticated candidate delivery avoids classic-store digest collisions while preserving every exact native image', async () => {
  const collision = await candidatePipelineFixture();
  const reference = collision.candidate.images.studio.reference;
  await collision.options.docker(['pull', '--platform', 'linux/amd64', reference]);
  await assert.rejects(collision.options.docker(['pull', '--platform', 'linux/arm64', reference]), /cannot overwrite digest/);
  assert.equal(collision.state.pulledReferences.get(reference), collision.candidate.images.studio.manifests['linux/amd64'].configDigest);

  const f = await candidatePipelineFixture({ publicAccess: true }); f.seedIndexes();
  const result = await verifyCandidateDelivery(f.candidate, f.options);
  assert.equal(result.authenticatedPulls, 'passed');
  assert.equal(result.anonymousAccess, 'passed');
  const expected = Object.entries(f.candidate.images).flatMap(([name, image]) => PLATFORMS.map(platform => [`${IMAGE_REPOSITORIES[name]}@${image.manifests[platform].digest}`, image.manifests[platform].configDigest]));
  assert.deepEqual([...f.state.pulledReferences], expected);
  assert.equal(f.state.pulledImages.size, 2);
  assert.deepEqual(f.state.docker.filter(args => args[0] === 'image').map(args => args[2]), expected.map(([, config]) => config));
  assert.ok(f.state.docker.every(args => ['login', 'pull', 'image', 'logout'].includes(args[0])), 'Delivery verification must not delete, retag or rebuild images to avoid a local reference collision.');
});

test('registry faults, altered bytes, authenticated denial and wrong pulled IDs or platforms cannot be relabeled as a pending public setting', async () => {
  for (const change of [
    f => { f.state.publicError = new Error('Registry server unavailable (500)'); },
    f => { f.state.publicError = new RegistryAccessError(403, false); },
    f => { f.state.tags.set(`${IMAGE_REPOSITORIES.studio}:${f.identity}`, Buffer.from('different image bytes')); },
    f => { f.state.wrongPull = true; },
    f => { f.state.wrongPullOs = true; },
    f => { f.state.wrongPullArchitecture = true; },
    f => { f.state.layerError = new RegistryAccessError(403, true); },
    f => { f.state.layerError = new Error('Streamed layer digest differs'); },
  ]) {
    const f = await candidatePipelineFixture({ publicAccess: true }); f.seedIndexes(); change(f);
    await assert.rejects(verifyCandidateDelivery(f.candidate, f.options));
    assert.ok(f.state.docker.every(args => !['build', 'buildx', 'push'].includes(args[0])));
  }
});

test('GHCR anonymous access denial is typed while transport and CDN errors remain failures', async () => {
  for (const status of [401, 403]) {
    const read = publicRegistry('studio', async url => url.startsWith('https://ghcr.io/token?') ? new Response('{}', { status }) : new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:theuncleben/homepage-studio:pull"' } }));
    await assert.rejects(read('manifests', 'sha256:' + 'a'.repeat(64)), error => error instanceof RegistryAccessError && error.status === status && error.anonymous);
  }
  const authenticated = registryReader(IMAGE_REPOSITORIES.studio, { credential: 'synthetic-token', fetcher: async () => new Response('{}', { status: 403 }) });
  await assert.rejects(authenticated('manifests', 'sha256:' + 'a'.repeat(64)), error => error instanceof RegistryAccessError && !error.anonymous);
  const broken = publicRegistry('studio', async () => new Response('{}', { status: 500 }));
  await assert.rejects(broken('manifests', 'sha256:' + 'a'.repeat(64)), error => !(error instanceof RegistryAccessError));
  const cdn = publicRegistry('studio', async url => url.startsWith('https://ghcr.io/') ? new Response('', { status: 307, headers: { location: 'https://pkg-containers.githubusercontent.com/fixture' } }) : new Response('{}', { status: 403 }));
  await assert.rejects(cdn('blobs', 'sha256:' + 'a'.repeat(64)), error => !(error instanceof RegistryAccessError));
});

test('official promotion accepts a successful marked candidate push by the delivery integration while still requiring exact owner release approval', async t => {
  const f = await publicationFixture(t);
  Object.assign(f.context.responses['/actions/runs/456'], { event: 'push', actor: { login: 'delivery-integration' }, triggering_actor: { login: 'delivery-integration' }, head_commit: { message: 'Test exact deployable images [deliver-candidate]' } });
  assert.equal((await promoteRelease(f.candidate, f.release, f.assets, f.options)).releaseId, 999);
});

test('workflow contracts run full native qualification once per push and retain images only for deliberate delivery requests', async () => {
  const candidateText = await fs.readFile(path.join(root, '.github/workflows/candidate-approved.yml'), 'utf8');
  const candidate = parse(candidateText);
  const officialText = await fs.readFile(path.join(root, '.github/workflows/promote-approved.yml'), 'utf8');
  const official = parse(officialText);
  const validation = parse(await fs.readFile(path.join(root, '.github/workflows/validate.yml'), 'utf8'));
  assert.deepEqual(Object.keys(candidate.on), ['push', 'workflow_dispatch']);
  assert.deepEqual(candidate.on.push.branches, ['implementation/native-dashboard']);
  assert.deepEqual(Object.keys(validation.on), ['pull_request', 'workflow_dispatch'], 'Default pushes must not duplicate the same native qualification workflow.');
  assert.deepEqual(Object.keys(official.on), ['workflow_dispatch']);
  for (const workflow of [candidate, official, validation]) {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.concurrency['cancel-in-progress'], workflow === validation);
    for (const job of Object.values(workflow.jobs)) for (const step of [job, ...(job.steps || [])]) {
      assert.notEqual(step['continue-on-error'], true);
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    }
  }
  assert.equal(candidate.jobs.authorize, undefined);
  assert.equal(candidate.jobs.publish, undefined);
  assert.ok(Object.values(candidate.jobs).every(job => !job.environment));
  assert.ok(!candidateText.includes('STUDIO_PACKAGE_METADATA_TOKEN'));
  // The architecture jobs wait only for the required native source checks (lint,
  // unit tests, audit, redirect check), which run once and gate every image build.
  assert.equal(candidate.jobs.native.needs, 'native-checks');
  assert.equal(candidate.jobs['native-checks'].needs, undefined);
  assert.equal(candidate.jobs['native-checks'].if, candidate.jobs.native.if);
  assert.deepEqual(candidate.jobs['native-checks'].permissions, { contents: 'read' });
  assert.deepEqual(candidate.jobs.native.strategy.matrix.include, [{ arch: 'amd64', runner: 'ubuntu-24.04' }, { arch: 'arm64', runner: 'ubuntu-24.04-arm' }]);
  assert.equal(candidate.jobs.native.strategy['fail-fast'], false);
  const steps = candidate.jobs.native.steps;
  const direct = steps.findIndex(step => step.run === 'node scripts/container-acceptance.mjs');
  const portainer = steps.findIndex(step => step.run === 'node scripts/portainer-acceptance.mjs');
  const stage = steps.findIndex(step => step.run?.includes('candidate-pipeline.mjs stage'));
  assert.ok(direct > 0 && portainer > direct && stage > portainer);
  assert.equal(steps[direct].env.STUDIO_BROWSER_TESTS, '1');
  assert.equal(steps[portainer].env.STUDIO_PORTAINER_TESTS, '1');
  const request = "github.event_name == 'workflow_dispatch' || contains(github.event.head_commit.message, '[deliver-candidate]')";
  assert.equal(steps[stage].if, request);
  assert.equal(steps.find(step => step.uses?.startsWith('actions/upload-artifact@')).if, request);
  assert.equal(candidate.jobs.assemble.if, request);
  assert.ok(steps.some(step => step.run?.includes('install --with-deps chromium firefox webkit')));
  assert.ok(steps.some(step => step.run?.includes('node --test test/*.test.mjs')));
  assert.ok(steps.find(step => step.run?.includes('docker buildx build')).run.includes('--load --provenance=false --sbom=false --platform'));
  assert.deepEqual(candidate.jobs.assemble.needs, ['native-checks', 'native']);
  assert.equal(official.jobs.promote.environment.name, 'official-release');
  for (const job of Object.values(official.jobs)) assert.ok(!job.steps.some(step => /docker\s+(?:buildx\s+)?build|pnpm/.test(step.run || '')), 'promotion must not rebuild or retest images');
  const originalBundle = official.jobs.promote.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(originalBundle.with['run-id'], '${{ needs.review.outputs.candidate_run_id }}');
  assert.equal(originalBundle.with.name, 'candidate-${{ needs.review.outputs.source_commit }}-${{ needs.review.outputs.candidate_run_id }}');
  assert.equal(originalBundle.with['digest-mismatch'], 'error');
  const artifactPaths = Object.values(candidate.jobs).flatMap(job => job.steps).filter(step => step.uses?.startsWith('actions/upload-artifact@')).map(step => step.with.path);
  assert.deepEqual(artifactPaths, ['candidate-targets/${{ matrix.arch }}.json', 'candidate-bundle/']);
});
