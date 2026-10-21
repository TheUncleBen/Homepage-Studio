import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { UPSTREAM_COMMIT } from '../scripts/healthcheck.mjs';
import { artifactFingerprint } from '../scripts/release-manifest.mjs';
import { IMAGE_REPOSITORIES, STAGING_REPOSITORIES, PLATFORMS, TEMPLATE_FILES, QUALIFICATION_CHECKS, sha256, candidateFingerprint, validateCandidateManifest, validateQualificationReport, materializeCandidate, matchCandidateToRelease } from '../scripts/candidate-manifest.mjs';
import { inspectImageIndex, inspectImageDirectory } from '../scripts/inspect-image-set.mjs';
import { approvalStatement, verifyTrustedApproval, githubApi, boundedResponse } from '../scripts/release-guard.mjs';
import { publicRegistry } from '../scripts/ghcr-read.mjs';
import { QUALIFIED_BUNDLE_FILES, loadQualifiedCandidateBundle, prepareOfficialAssets, promoteRelease } from '../scripts/promote-release.mjs';
import { preparePromotionInputs } from '../scripts/prepare-promotion-inputs.mjs';
import { buildIdentity, stagingStatement, publicCandidateStatement, packageMetadata, packageVersions, verifyMetadataReader, stageNativeTarget, validateTargetReceipts, assembleCandidate, prepareCandidateDestinations, publishCandidate } from '../scripts/candidate-pipeline.mjs';

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
      ...(name === 'homepage' ? { 'io.homepage-studio.upstream': UPSTREAM_COMMIT } : {}),
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
  const files = { 'studio-source.tar.gz': Buffer.from('synthetic writer source archive'), 'homepage-source.tar.gz': Buffer.from('synthetic native source archive'), 'verification.json': json(report) };
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
  const f = imageFixture('homepage');
  const actual = await inspectImageIndex(f.indexBytes, value => f.blobs.get(value), { imageName: 'homepage', sourceCommit: commit });
  assert.equal(actual.reference, `${IMAGE_REPOSITORIES.homepage}@sha256:${sha256(f.indexBytes)}`);
  assert.deepEqual(actual.platforms, PLATFORMS);
  for (const descriptor of f.index.manifests) assert.equal(actual.manifests[`linux/${descriptor.platform.architecture}`].digest, descriptor.digest);
});

test('OCI inspection rejects corrupt blobs, duplicate/missing platforms and mislabeled images', async () => {
  const options = { imageName: 'homepage', sourceCommit: commit };
  const f = imageFixture('homepage');
  await assert.rejects(inspectImageIndex(f.indexBytes, () => Buffer.from('changed'), options), /immutable descriptor/);
  for (const mutate of [index => index.manifests.pop(), index => index.manifests.push(index.manifests[0]), index => { index.manifests[0].platform.architecture = '386'; }, index => { index.manifests[0].digest = 'sha256:../../path'; }]) {
    const index = clone(f.index); mutate(index);
    await assert.rejects(inspectImageIndex(json(index), value => f.blobs.get(value), options));
  }
  for (const mutate of [config => { config.architecture = '386'; }, config => { config.config.Labels['org.opencontainers.image.revision'] = 'c'.repeat(40); }, config => { config.config.Labels['io.homepage-studio.upstream'] = 'c'.repeat(40); }, config => { config.config.Env.push(`STUDIO_BUILD_REVISION=${commit}`); }]) {
    const altered = imageFixture('homepage', mutate);
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
  for (const mutate of [value => { value.verification.human = 'passed'; }, value => { value.status = 'owner-approved'; }, value => { value.version = '2026.10.20'; }, value => { value.images.studio.reference = `${IMAGE_REPOSITORIES.studio}:latest`; }, value => { value.images.studio.buildRevision = 'c'.repeat(40); }, value => { value.images.homepage.platforms.pop(); }, value => { value.images.homepage.manifests['linux/arm64'].configDigest = ''; }, value => { value.files['verification.json'] = 'e'.repeat(64); }, value => { value.templates['portainer-compose.yml'] = ''; }]) {
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
  await fs.appendFile(path.join(inputs, 'homepage-source.tar.gz'), 'changed');
  await assert.rejects(materializeCandidate(candidate, inputs, root, path.join(temp, 'wrong')), /input hash differs/);
  await assert.rejects(fs.lstat(path.join(temp, 'wrong')), { code: 'ENOENT' });
});

test('official matching refuses rebuilding either image or substituting engineering evidence', async () => {
  const { candidate, release } = await fixture();
  matchCandidateToRelease(candidate, release);
  for (const mutate of [value => { value.images.studio.reference = IMAGE_REPOSITORIES.studio + '@sha256:' + '1'.repeat(64); }, value => { value.images.homepage.reference = IMAGE_REPOSITORIES.homepage + '@sha256:' + '1'.repeat(64); }, value => { value.verification.reportSha256 = '1'.repeat(64); }]) {
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
  const state = { writes: [], docker: [], uploads: [], tagged: new Set(), ref: null, existingTag: false, existingRef: false, badUpload: false, badPromotion: false, workflowMismatch: false };
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
  const registry = name => async (kind, reference, options = {}) => {
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
  assert.equal(f.state.docker.length, 3);
  assert.equal(f.state.uploads.length, 9);
  assert.deepEqual(f.state.writes.map(item => [item.method, item.suffix]), [['POST', '/git/refs'], ['POST', '/releases'], ['PATCH', '/releases/999']]);
  assert.equal(f.state.writes.at(-1).body.draft, false);
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
    f => { f.context.responses['/actions/runs/456'].actor.login = 'another-user'; },
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

async function candidatePipelineFixture({ bootstrap = true, staging = 'private', destination = 'absent' } = {}) {
  const f = await fixture();
  const context = approvedContext(f.candidate, f.release);
  Object.assign(context.environment, { GITHUB_TOKEN: 'synthetic-token', GITHUB_SHA: commit, STUDIO_CANDIDATE_SOURCE: commit, STUDIO_PRIVATE_BOOTSTRAP: String(bootstrap), GITHUB_WORKFLOW_REF: 'TheUncleBen/Homepage-Studio/.github/workflows/candidate-approved.yml@refs/heads/main' });
  Object.assign(context.responses['/actions/runs/123'], { head_sha: commit, path: '.github/workflows/candidate-approved.yml' });
  const gate = (name, id) => ({ id, name, protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'TheUncleBen' } }] }] });
  context.responses['/environments/candidate-publication'] = gate('candidate-publication', 57);
  const approve = candidate => {
    context.responses['/actions/runs/123/approvals'] = [
      { state: 'approved', user: { login: 'TheUncleBen' }, environments: [{ id: 57, name: 'candidate-publication' }], comment: publicCandidateStatement(candidate, context.environment) },
    ];
  };
  approve(f.candidate);
  const identity = buildIdentity(context.environment);
  const fixtures = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, imageFixture(name)]));
  const state = { docker: [], tags: new Map(), packages: new Map(), runnerPlatform: 'linux/amd64', extraVersions: [], wrongLocalId: false, createdVisibility: 'private', failCopy: false, wrongPull: false };
  for (const repository of Object.values(STAGING_REPOSITORIES)) if (staging !== 'absent') state.packages.set(repository, staging);
  for (const repository of Object.values(IMAGE_REPOSITORIES)) if (destination !== 'absent') state.packages.set(repository, destination);
  const metadata = async repository => state.packages.has(repository) ? { name: repository.split('/').at(-1), package_type: 'container', visibility: state.packages.get(repository), owner: { login: 'TheUncleBen' }, repository: { full_name: 'TheUncleBen/Homepage-Studio' } } : null;
  const versions = async repository => {
    const name = Object.keys(IMAGE_REPOSITORIES).find(name => IMAGE_REPOSITORIES[name] === repository);
    return [...(state.tags.has(`${repository}:${identity}`) ? [f.candidate.images[name].reference.split('@')[1], ...PLATFORMS.map(platform => f.candidate.images[name].manifests[platform].digest)] : []), ...state.extraVersions];
  };
  const registry = (name, scope) => async (kind, reference, options = {}) => {
    const repository = scope === 'private' ? STAGING_REPOSITORIES[name] : IMAGE_REPOSITORIES[name];
    if (scope === 'public') assert.equal(state.packages.get(repository), 'public', 'Anonymous reads must wait for actual public visibility.');
    if (reference.startsWith('build-')) {
      const value = state.tags.get(`${repository}:${reference}`);
      if (value) return value;
      if (options.absent) return null;
      throw new Error('Fixture tag is absent.');
    }
    const item = fixtures[name];
    if (reference === f.candidate.images[name].reference.split('@')[1]) return item.indexBytes;
    assert.ok(item.blobs.has(reference));
    return item.blobs.get(reference);
  };
  const docker = async (args, input) => {
    state.docker.push(args);
    if (args[0] === 'login') { assert.equal(input, 'synthetic-token\n'); return ''; }
    if (args[0] === 'logout' || args[0] === 'pull' || args[0] === 'tag') return '';
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (args[2].startsWith('sha256:')) {
        assert.equal(args.length, 3, 'Use the Docker 28.0.4/API 1.48 inspect-by-ID contract.');
        const platform = PLATFORMS.find(platform => Object.values(f.candidate.images).some(image => image.manifests[platform].configDigest === args[2]));
        assert.ok(platform);
        return JSON.stringify([{ Id: state.wrongPull ? 'sha256:' + 'e'.repeat(64) : args[2], Os: 'linux', Architecture: platform.split('/')[1] }]);
      }
      const name = args[2] === 'homepage-studio-ci:writer' ? 'studio' : 'homepage';
      const id = f.candidate.images[name].manifests[state.runnerPlatform].configDigest;
      return JSON.stringify([{ Id: state.wrongLocalId ? 'sha256:' + 'e'.repeat(64) : id, Os: 'linux', Architecture: state.runnerPlatform.split('/')[1], Config: { Labels: { 'org.opencontainers.image.revision': commit } } }]);
    }
    if (args[0] === 'push') {
      const repository = args[1].split(':')[0];
      const name = Object.keys(STAGING_REPOSITORIES).find(name => STAGING_REPOSITORIES[name] === repository);
      const descriptor = fixtures[name].index.manifests.find(item => item.platform.architecture === state.runnerPlatform.split('/')[1]);
      state.packages.set(repository, state.packages.get(repository) || state.createdVisibility);
      state.tags.set(args[1], fixtures[name].blobs.get(descriptor.digest));
      return '';
    }
    assert.deepEqual(args.slice(0, 4), ['buildx', 'imagetools', 'create', '--tag']);
    const repository = args[4].split(':')[0];
    const name = Object.keys(IMAGE_REPOSITORIES).find(name => IMAGE_REPOSITORIES[name] === repository || STAGING_REPOSITORIES[name] === repository);
    assert.ok(name);
    assert.ok(!state.tags.has(args[4]), 'No existing tag may be overwritten.');
    if (state.failCopy) throw new Error('Synthetic copy failure.');
    const sources = args.slice(5);
    if (repository === IMAGE_REPOSITORIES[name]) assert.deepEqual(sources, [`${STAGING_REPOSITORIES[name]}@${f.candidate.images[name].reference.split('@')[1]}`]);
    else assert.deepEqual(sources, PLATFORMS.map(platform => `${repository}@${f.candidate.images[name].manifests[platform].digest}`));
    state.packages.set(repository, state.packages.get(repository) || state.createdVisibility);
    state.tags.set(args[4], fixtures[name].indexBytes);
    return '';
  };
  return { ...f, context, state, fixtures, identity, approve, options: { ...context, metadata, versions, registry, docker } };
}

test('package bootstrap requires verified namespace absence, and API/owner failures stay failures', async () => {
  const calls = [];
  const absent = await packageMetadata(STAGING_REPOSITORIES.studio, 'synthetic-token', async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    return url.includes('/packages/container/') ? new Response('{}', { status: 404 }) : new Response('[]');
  });
  assert.equal(absent, null); assert.equal(calls.length, 2);
  for (const status of [401, 403, 500]) await assert.rejects(packageMetadata(STAGING_REPOSITORIES.studio, 'synthetic-token', async () => new Response('{}', { status })), /Cannot verify/);
  for (const items of [[{ name: 'another', package_type: 'container', owner: { login: 'another-user' } }], [{ name: 'homepage-studio-candidate-staging', package_type: 'container', owner: { login: 'TheUncleBen' } }]]) {
    await assert.rejects(packageMetadata(STAGING_REPOSITORIES.studio, 'synthetic-token', async url => url.includes('/packages/container/') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(items))));
  }
  await assert.rejects(packageVersions(IMAGE_REPOSITORIES.studio, 'synthetic-token', async () => new Response('[{"name":"latest"}]')), /manifest list/);
  await assert.rejects(verifyMetadataReader({ STUDIO_PACKAGE_METADATA_TOKEN: 'synthetic-nonowner' }, async () => new Response('{"login":"another-user"}')), /project owner/);
  await verifyMetadataReader({ STUDIO_PACKAGE_METADATA_TOKEN: 'synthetic-owner' }, async (url, options) => {
    assert.equal(url, 'https://api.github.com/user'); assert.equal(options.redirect, 'error');
    return new Response('{"login":"TheUncleBen"}');
  });
});

test('native staging refuses emulation claims, untrusted dispatch, public staging and implicit bootstrap before any image write', async () => {
  for (const change of [
    f => { f.options.runnerPlatform = 'linux/arm64'; },
    f => { f.context.responses['/actions/runs/123'].actor.login = 'another-user'; },
    f => { f.state.packages.set(STAGING_REPOSITORIES.studio, 'public'); },
    f => { f.state.packages.clear(); f.context.environment.STUDIO_PRIVATE_BOOTSTRAP = 'false'; f.approve(f.candidate); },
    f => { f.context.environment.STUDIO_CANDIDATE_SOURCE = 'b'.repeat(40); },
  ]) {
    const f = await candidatePipelineFixture(); f.options.runnerPlatform = 'linux/amd64'; change(f);
    await assert.rejects(stageNativeTarget('linux/amd64', tree, f.options));
    assert.deepEqual(f.state.docker, []);
  }
});

test('first-use staging preserves tested config IDs and checks real private visibility immediately after creation', async () => {
  const f = await candidatePipelineFixture({ staging: 'absent' });
  const target = await stageNativeTarget('linux/amd64', tree, { ...f.options, runnerPlatform: 'linux/amd64' });
  assert.equal(target.images.studio.configDigest, f.candidate.images.studio.manifests['linux/amd64'].configDigest);
  assert.deepEqual(target.checks, Object.fromEntries(QUALIFICATION_CHECKS.map(name => [name, 'passed'])));
  assert.equal(f.state.docker.filter(args => args[0] === 'push').length, 2);
  assert.ok(f.state.docker.filter(args => args[0] === 'push').every(args => args[1].includes('-candidate-staging:build-')));
  for (const change of [value => { value.state.createdVisibility = 'public'; }, value => { value.state.wrongLocalId = true; }]) {
    const bad = await candidatePipelineFixture({ staging: 'absent' }); change(bad);
    await assert.rejects(stageNativeTarget('linux/amd64', tree, { ...bad.options, runnerPlatform: 'linux/amd64' }));
    assert.equal(bad.state.docker.filter(args => args[0] === 'push').length, 1, 'Stop before staging the second image after a failed readback.');
  }
});

test('complete native receipts bind both Portainer gates, every browser gate and the exact build before index assembly', async t => {
  const f = await candidatePipelineFixture({ staging: 'absent' });
  const receipts = [];
  for (const platform of PLATFORMS) {
    f.state.runnerPlatform = platform;
    receipts.push(await stageNativeTarget(platform, tree, { ...f.options, runnerPlatform: platform }));
  }
  validateTargetReceipts(receipts, f.context.environment);
  for (const change of [value => value.pop(), value => { value[1].runnerPlatform = 'linux/amd64'; }, value => { value[1].buildIdentity += '-other'; }, value => { delete value[1].checks.portainerCompose; }, value => { value[1].checks.portainerSwarm = 'not-run'; }, value => { value[0].checks.hiddenDocument = 'not-run'; }, value => { value[1].sourceTree = 'b'.repeat(40); }]) {
    const altered = clone(receipts); change(altered); assert.throws(() => validateTargetReceipts(altered, f.context.environment));
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-candidate-assembly-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.writeFile(path.join(temp, 'studio-source.tar.gz'), f.files['studio-source.tar.gz']);
  await fs.writeFile(path.join(temp, 'homepage-source.tar.gz'), f.files['homepage-source.tar.gz']);
  const candidate = await assembleCandidate(receipts, temp, f.options);
  validateQualificationReport(JSON.parse(await fs.readFile(path.join(temp, 'verification.json'), 'utf8')), candidate);
  assert.deepEqual(candidate.images, f.candidate.images);
  assert.equal(candidate.verification.human, 'pending');
  assert.equal(f.state.docker.filter(args => args[0] === 'buildx').length, 2);
});

test('first-use complete candidate remains private until owner visibility action and exact approval, then verifies without overwriting', async () => {
  const f = await candidatePipelineFixture();
  const prepared = await prepareCandidateDestinations(f.candidate, f.options);
  assert.equal(prepared.status, 'awaiting-public-distribution-approval');
  assert.deepEqual(Object.values(prepared.destinations), ['private-awaiting-owner-visibility-change', 'private-awaiting-owner-visibility-change']);
  assert.equal(f.state.docker.filter(args => args[0] === 'buildx').length, 2);
  assert.ok(Object.values(IMAGE_REPOSITORIES).every(repository => f.state.packages.get(repository) === 'private'));
  await assert.rejects(publishCandidate(f.candidate, f.options), /public package/);
  const before = f.state.docker.length;
  for (const repository of Object.values(IMAGE_REPOSITORIES)) f.state.packages.set(repository, 'public'); // Simulated owner action, never a pipeline API.
  f.context.responses['/actions/runs/123/approvals'].pop();
  await assert.rejects(publishCandidate(f.candidate, f.options), /owner must approve/);
  assert.equal(f.state.docker.length, before);
  f.approve(f.candidate);
  const result = await publishCandidate(f.candidate, f.options);
  assert.equal(result.officialRelease, false);
  assert.equal(f.state.docker.filter(args => args[0] === 'buildx').length, 2, 'Resumed first-use job must not copy or replace the prepositioned indexes.');
  assert.equal(f.state.docker.filter(args => args[0] === 'pull').length, 4);
  assert.ok(f.state.docker.every(args => !args.includes('build') && !args.some(arg => /^\d{4}\.\d{2}\.\d{2}$/.test(arg))));
});

test('existing public destinations receive no candidate writes until exact publication approval', async () => {
  const f = await candidatePipelineFixture({ bootstrap: false, destination: 'public' });
  const prepared = await prepareCandidateDestinations(f.candidate, f.options);
  assert.deepEqual(Object.values(prepared.destinations), ['copy-after-approval', 'copy-after-approval']);
  assert.deepEqual(f.state.docker, []);
  await publishCandidate(f.candidate, f.options);
  assert.equal(f.state.docker.filter(args => args[0] === 'buildx').length, 2);
  assert.equal(f.state.docker.filter(args => args[0] === 'pull').length, 4);
});

test('unrelated private versions, changed build tags, wrong pull IDs and partial copies cannot produce a candidate handoff', async () => {
  const history = await candidatePipelineFixture({ destination: 'private' });
  history.state.extraVersions = ['sha256:' + 'e'.repeat(64)];
  await assert.rejects(prepareCandidateDestinations(history.candidate, history.options), /other image versions/);
  assert.deepEqual(history.state.docker, []);
  const changed = await candidatePipelineFixture({ destination: 'public', bootstrap: false });
  changed.state.tags.set(`${IMAGE_REPOSITORIES.studio}:${changed.identity}`, Buffer.from('different image bytes'));
  await assert.rejects(publishCandidate(changed.candidate, changed.options), /different bytes/);
  assert.deepEqual(changed.state.docker, []);
  const failed = await candidatePipelineFixture({ destination: 'public', bootstrap: false });
  failed.state.failCopy = true;
  await assert.rejects(publishCandidate(failed.candidate, failed.options), /copy failure/);
  assert.equal(failed.state.docker.filter(args => args[0] === 'buildx').length, 1);
  assert.equal(failed.state.docker.filter(args => args[0] === 'pull').length, 0);
  const badPull = await candidatePipelineFixture({ destination: 'public', bootstrap: false });
  badPull.state.wrongPull = true;
  await assert.rejects(publishCandidate(badPull.candidate, badPull.options), /Anonymous.*differs/);
  assert.equal(badPull.state.docker.filter(args => args[0] === 'pull').length, 1);
});

test('dormant workflow contracts require complete native runtime qualification and protected manual publication', async () => {
  const candidate = parse(await fs.readFile(path.join(root, 'release/workflows/candidate-approved.yml'), 'utf8'));
  const official = parse(await fs.readFile(path.join(root, 'release/workflows/promote-approved.yml'), 'utf8'));
  for (const workflow of [candidate, official]) {
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    for (const job of Object.values(workflow.jobs)) for (const step of job.steps || []) {
      assert.notEqual(step['continue-on-error'], true);
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    }
  }
  assert.equal(candidate.on.workflow_dispatch.inputs.bootstrap_private_packages.default, false);
  assert.equal(candidate.jobs.authorize.environment, undefined, 'The owner dispatch authorizes private staging without an extra protected review.');
  assert.equal(candidate.jobs.native.needs, 'authorize');
  assert.deepEqual(candidate.jobs.native.strategy.matrix.include, [{ arch: 'amd64', runner: 'ubuntu-24.04' }, { arch: 'arm64', runner: 'ubuntu-24.04-arm' }]);
  assert.equal(candidate.jobs.native.strategy['fail-fast'], false);
  const steps = candidate.jobs.native.steps;
  const direct = steps.findIndex(step => step.run === 'node scripts/container-acceptance.mjs');
  const portainer = steps.findIndex(step => step.run === 'node scripts/portainer-acceptance.mjs');
  const stage = steps.findIndex(step => step.run?.includes('candidate-pipeline.mjs stage'));
  assert.ok(direct > 0 && portainer > direct && stage > portainer);
  assert.equal(steps[direct].env.STUDIO_BROWSER_TESTS, '1');
  assert.equal(steps[portainer].env.STUDIO_PORTAINER_TESTS, '1');
  assert.ok(steps.some(step => step.run?.includes('install --with-deps chromium firefox webkit')));
  assert.ok(steps.some(step => step.run?.includes('node --test test/*.test.mjs')));
  assert.ok(steps.find(step => step.run?.includes('docker buildx build')).run.includes('--load --provenance=false --sbom=false --platform'));
  assert.equal(candidate.jobs.assemble.needs, 'native');
  assert.equal(candidate.jobs.publish.needs, 'assemble');
  assert.equal(candidate.jobs.publish.environment.name, 'candidate-publication');
  assert.equal(official.jobs.promote.environment.name, 'official-release');
  assert.ok(!official.jobs.promote.steps.some(step => step.run?.includes('docker build')));
  const originalBundle = official.jobs.promote.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(originalBundle.with['run-id'], '${{ needs.review.outputs.candidate_run_id }}');
  assert.equal(originalBundle.with.name, 'candidate-${{ needs.review.outputs.source_commit }}-${{ needs.review.outputs.candidate_run_id }}');
  assert.equal(originalBundle.with['digest-mismatch'], 'error');
  const artifactPaths = Object.values(candidate.jobs).flatMap(job => job.steps).filter(step => step.uses?.startsWith('actions/upload-artifact@')).map(step => step.with.path);
  assert.deepEqual(artifactPaths, ['candidate-targets/${{ matrix.arch }}.json', 'candidate-bundle/']);
});
