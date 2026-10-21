#!/usr/bin/env node
// Dormant candidate operator. Every image write requires live owner authorization.
// First-use creation uses qualified images only, under an explicit private bootstrap.
// No package visibility changes, official tags, releases or image rebuilds on promotion.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';
import { IMAGE_REPOSITORIES, STAGING_REPOSITORIES, PLATFORMS, TEMPLATE_FILES, CANDIDATE_FILES, QUALIFICATION_CHECKS, sha256, isCommit, isHash, candidateFingerprint, validateCandidateManifest, validateQualificationReport, materializeCandidate } from './candidate-manifest.mjs';
import { inspectArchitectureManifest, inspectImageIndex } from './inspect-image-set.mjs';
import { RELEASE_REPOSITORY, RELEASE_OWNER, CANDIDATE_WORKFLOW, verifyOwnerRun, verifyOwnerGate, boundedResponse } from './release-guard.mjs';
import { registryReader, publicRegistry } from './ghcr-read.mjs';

export { CANDIDATE_WORKFLOW };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localNames = { studio: 'homepage-studio-ci:writer', homepage: 'homepage-studio-ci:renderer' };

export function buildIdentity(environment = process.env) {
  if (!isCommit(environment.GITHUB_SHA) || !/^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ID || '') || environment.GITHUB_RUN_ATTEMPT !== '1' || environment.STUDIO_CANDIDATE_SOURCE !== environment.GITHUB_SHA) throw new Error('Build only the explicitly identified default-branch source in a fresh run.');
  return `build-${environment.GITHUB_SHA}-${environment.GITHUB_RUN_ID}`;
}

export function stagingStatement(environment = process.env) {
  return `Authorize private Homepage Studio staging ${buildIdentity(environment)}; staging ${Object.values(STAGING_REPOSITORIES).join(', ')} must stay private; bootstrap ${bootstrapAllowed(environment) ? `allowed only as private for these staging packages and ${Object.values(IMAGE_REPOSITORIES).join(', ')}` : 'disabled'}; public distribution requires a separate exact-candidate approval`;
}

export function bootstrapAllowed(environment = process.env) {
  if (!['true', 'false', undefined].includes(environment.STUDIO_PRIVATE_BOOTSTRAP)) throw new Error('Private bootstrap must be an explicit boolean workflow input.');
  return environment.STUDIO_PRIVATE_BOOTSTRAP === 'true';
}

export function publicCandidateStatement(candidate, environment = process.env) {
  validateCandidateManifest(candidate);
  if (candidate.sourceCommit !== environment.GITHUB_SHA) throw new Error('Candidate source and this build run differ.');
  return `Publish one public Homepage Studio candidate ${buildIdentity(environment)}; artifact set ${candidate.artifactSetSha256}; no official release`;
}

export async function verifyCandidateGate(phase, candidate, options = {}) {
  const environment = options.environment || process.env;
  buildIdentity(environment);
  if (!['stage', 'publish'].includes(phase)) throw new Error('Unknown candidate authorization phase.');
  // The authenticated owner dispatch itself authorizes private engineering work.
  // Only public distribution waits for a second, exact-artifact owner review.
  if (phase === 'stage') return { ...await verifyOwnerRun(CANDIDATE_WORKFLOW, options), bootstrapPrivatePackages: bootstrapAllowed(environment) };
  return verifyOwnerGate({ workflowPath: CANDIDATE_WORKFLOW, environmentName: 'candidate-publication', approvalComment: publicCandidateStatement(candidate, environment) }, options);
}

async function packageApi(suffix, token, fetcher, absent = false) {
  const response = await fetcher(`https://api.github.com${suffix}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10' } });
  if (absent && response.status === 404) return null;
  if (!response.ok) throw new Error(`Cannot verify package metadata (${response.status}); no unverified visibility or absence is accepted.`);
  return JSON.parse((await boundedResponse(response)).toString('utf8'));
}

const verifiedMetadataTokens = new Set();
export async function verifyMetadataReader(environment = process.env, fetcher = fetch) {
  const token = environment.STUDIO_PACKAGE_METADATA_TOKEN;
  if (!token || verifiedMetadataTokens.has(token)) return;
  // A separately configured read-only token must belong to the actual owner;
  // another account's empty namespace must never look like bootstrap eligibility.
  const identity = await packageApi('/user', token, fetcher);
  if (identity.login !== RELEASE_OWNER) throw new Error('A supplemental package metadata token must belong to the project owner.');
  verifiedMetadataTokens.add(token);
}

export async function packageMetadata(repository, token, fetcher = fetch) {
  if (!token || ![...Object.values(STAGING_REPOSITORIES), ...Object.values(IMAGE_REPOSITORIES)].includes(repository)) throw new Error('A known package and metadata-read authorization are required.');
  const name = repository.split('/').at(-1);
  const data = await packageApi(`/user/packages/container/${name}`, token, fetcher, true);
  if (data !== null) return data;
  // A named 404 alone may hide an access failure. Require a successful, complete
  // authenticated namespace listing, with the expected owner, before bootstrap.
  for (let page = 1; page <= 100; page += 1) {
    const items = await packageApi(`/user/packages?package_type=container&per_page=100&page=${page}`, token, fetcher);
    if (!Array.isArray(items) || items.some(item => item.package_type !== 'container' || item.owner?.login !== RELEASE_OWNER)) throw new Error('Package listing did not verify the intended owner namespace.');
    if (items.some(item => item.name === name)) throw new Error('The package exists but its metadata cannot be inspected; bootstrap is forbidden.');
    if (items.length < 100) return null;
  }
  throw new Error('Package absence could not be verified within the API pagination bound.');
}

export async function packageVersions(repository, token, fetcher = fetch) {
  if (!token || !Object.values(IMAGE_REPOSITORIES).includes(repository)) throw new Error('Only the declared destination package history may be inspected.');
  const versions = [];
  for (let page = 1; page <= 100; page += 1) {
    const items = await packageApi(`/user/packages/container/${repository.split('/').at(-1)}/versions?state=active&per_page=100&page=${page}`, token, fetcher);
    if (!Array.isArray(items) || items.some(item => !digest(item.name))) throw new Error('Destination package history is not a verified container manifest list.');
    versions.push(...items.map(item => item.name));
    if (items.length < 100) return versions;
  }
  throw new Error('Destination package history exceeds the reviewed pagination bound.');
}

function assertPackage(data, repository, visibility) {
  if (!data || data.name !== repository.split('/').at(-1) || data.package_type !== 'container' || data.visibility !== visibility || data.owner?.login !== RELEASE_OWNER || data.repository?.full_name !== RELEASE_REPOSITORY) throw new Error(`Declared ${visibility} package visibility/owner/repository linkage was not verified.`);
}

export async function verifyPackageSet(visibility, { environment = process.env, metadata = packageMetadata, allowAbsent = false } = {}) {
  await verifyMetadataReader(environment);
  const repositories = visibility === 'private' ? STAGING_REPOSITORIES : visibility === 'public' ? IMAGE_REPOSITORIES : null;
  if (!repositories) throw new Error('Explicit private or public package visibility is required.');
  const result = {};
  for (const [name, repository] of Object.entries(repositories)) {
    const data = await metadata(repository, environment.STUDIO_PACKAGE_METADATA_TOKEN || environment.GITHUB_TOKEN);
    if (data === null && allowAbsent && bootstrapAllowed(environment)) result[name] = null;
    else { assertPackage(data, repository, visibility); result[name] = data; }
  }
  return result;
}

export async function destinationStates({ environment = process.env, metadata = packageMetadata } = {}) {
  await verifyMetadataReader(environment);
  const result = {};
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    const data = await metadata(repository, environment.STUDIO_PACKAGE_METADATA_TOKEN || environment.GITHUB_TOKEN);
    if (data === null) {
      if (!bootstrapAllowed(environment)) throw new Error('An absent destination requires explicitly approved private bootstrap.');
      result[name] = 'absent';
    } else {
      if (!['public', 'private'].includes(data.visibility)) throw new Error('Destination visibility must be explicitly private or public.');
      assertPackage(data, repository, data.visibility);
      if (data.visibility === 'private' && !bootstrapAllowed(environment)) throw new Error('Preparing an existing private destination requires the explicit bootstrap decision.');
      result[name] = data.visibility;
    }
  }
  return result;
}

async function command(program, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; let total = 0;
    child.stdout.on('data', bytes => { total += bytes.length; if (total > 8 * 1024 * 1024) child.kill(); else output.push(bytes); });
    child.stderr.resume();
    child.on('error', () => reject(new Error(`${program} candidate operation could not start.`)));
    child.on('close', code => code === 0 && total <= 8 * 1024 * 1024 ? resolve(Buffer.concat(output).toString('utf8').trim()) : reject(new Error(`${program} candidate operation failed (${code}); inspect the run without retrying a partial publication.`)));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
const dockerCommand = (args, input) => command('docker', args, input);
const digest = value => typeof value === 'string' && value.startsWith('sha256:') && isHash(value.slice(7));

export async function stageNativeTarget(platform, sourceTree, { environment = process.env, request, metadata, registry, docker = dockerCommand, runnerPlatform = `linux/${process.arch === 'x64' ? 'amd64' : process.arch}` } = {}) {
  const identity = buildIdentity(environment);
  if (!PLATFORMS.includes(platform) || runnerPlatform !== platform || !isCommit(sourceTree)) throw new Error('The advertised architecture must be tested on its native runner with an exact source tree.');
  await verifyCandidateGate('stage', null, { environment, request });
  const packages = await verifyPackageSet('private', { environment, metadata, allowAbsent: true });
  const tag = `${identity}-${platform.split('/')[1]}`;
  const readers = Object.fromEntries(Object.keys(STAGING_REPOSITORIES).map(name => [name, registry ? registry(name, 'private') : registryReader(STAGING_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  const ids = {};
  for (const name of Object.keys(STAGING_REPOSITORIES)) {
    const inspected = JSON.parse(await docker(['image', 'inspect', localNames[name]]))[0];
    if (!digest(inspected?.Id) || `${inspected.Os}/${inspected.Architecture}` !== platform || inspected.Config?.Labels?.['org.opencontainers.image.revision'] !== environment.GITHUB_SHA) throw new Error('The locally qualified image identity/architecture does not match this run.');
    ids[name] = inspected.Id;
    if (packages[name] !== null && await readers[name]('manifests', tag, { absent: true }) !== null) throw new Error('This unique private build tag already exists; no overwrite is allowed.');
  }
  await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  const images = {};
  for (const [name, repository] of Object.entries(STAGING_REPOSITORIES)) {
    // Recheck immediately before each application push; an existing public package is never accepted.
    await verifyPackageSet('private', { environment, metadata, allowAbsent: true });
    await docker(['tag', localNames[name], `${repository}:${tag}`]);
    await docker(['push', `${repository}:${tag}`]);
    // New packages default private, but default behavior is never accepted as a
    // readback result. Verify real visibility immediately after first creation.
    assertPackage(await (metadata || packageMetadata)(repository, environment.STUDIO_PACKAGE_METADATA_TOKEN || environment.GITHUB_TOKEN), repository, 'private');
    const raw = await readers[name]('manifests', tag);
    const inspected = await inspectArchitectureManifest(raw, value => readers[name]('blobs', value), { imageName: name, sourceCommit: environment.GITHUB_SHA, platform });
    if (inspected.configDigest !== ids[name]) throw new Error('Registry configuration bytes differ from the exact locally tested image.');
    images[name] = inspected;
  }
  return { schemaVersion: 1, sourceCommit: environment.GITHUB_SHA, sourceTree, upstreamCommit: UPSTREAM_COMMIT, buildIdentity: identity, runnerPlatform, images, checks: Object.fromEntries(QUALIFICATION_CHECKS.map(name => [name, 'passed'])) };
}

export function validateTargetReceipts(receipts, environment = process.env) {
  const identity = buildIdentity(environment);
  if (!Array.isArray(receipts) || receipts.length !== 2 || receipts.map(item => item.runnerPlatform).sort().join(',') !== PLATFORMS.join(',')) throw new Error('Both native target receipts are required exactly once.');
  const sourceTree = receipts[0].sourceTree;
  for (const item of receipts) {
    if (item.schemaVersion !== 1 || item.sourceCommit !== environment.GITHUB_SHA || item.sourceTree !== sourceTree || !isCommit(sourceTree) || item.upstreamCommit !== UPSTREAM_COMMIT || item.buildIdentity !== identity || Object.keys(item.images || {}).sort().join(',') !== 'homepage,studio' || Object.keys(item.checks || {}).sort().join(',') !== [...QUALIFICATION_CHECKS].sort().join(',') || QUALIFICATION_CHECKS.some(name => item.checks[name] !== 'passed') || Object.values(item.images).some(value => !digest(value.digest) || !digest(value.configDigest))) throw new Error('Native target receipts must belong to this complete successful build and image pair.');
  }
  return { identity, sourceTree };
}

export async function assembleCandidate(receipts, inputDirectory, { environment = process.env, request, metadata, registry, docker = dockerCommand, sourceRoot = root } = {}) {
  const { identity, sourceTree } = validateTargetReceipts(receipts, environment);
  await verifyCandidateGate('stage', null, { environment, request });
  await verifyPackageSet('private', { environment, metadata });
  const images = {};
  const readers = Object.fromEntries(Object.keys(STAGING_REPOSITORIES).map(name => [name, registry ? registry(name, 'private') : registryReader(STAGING_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  for (const name of Object.keys(STAGING_REPOSITORIES)) if (await readers[name]('manifests', `${identity}-index`, { absent: true }) !== null) throw new Error('A private candidate index already exists; do not replace it.');
  await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  for (const [name, repository] of Object.entries(STAGING_REPOSITORIES)) {
    // Check all staged child/config bytes before constructing this index.
    for (const target of receipts) {
      const child = await readers[name]('manifests', target.images[name].digest);
      const inspected = await inspectArchitectureManifest(child, value => readers[name]('blobs', value), { imageName: name, sourceCommit: environment.GITHUB_SHA, platform: target.runnerPlatform });
      if (!isDeepStrictEqual(inspected, target.images[name])) throw new Error('Staged native image bytes differ from the qualification receipt.');
    }
    await verifyPackageSet('private', { environment, metadata });
    await docker(['buildx', 'imagetools', 'create', '--tag', `${repository}:${identity}-index`, ...PLATFORMS.map(platform => `${repository}@${receipts.find(item => item.runnerPlatform === platform).images[name].digest}`)]);
    const raw = await readers[name]('manifests', `${identity}-index`);
    const index = JSON.parse(raw);
    images[name] = await inspectImageIndex(raw, value => readers[name](index.manifests.some(item => item.digest === value) ? 'manifests' : 'blobs', value), { imageName: name, sourceCommit: environment.GITHUB_SHA });
    for (const target of receipts) if (!isDeepStrictEqual(images[name].manifests[target.runnerPlatform], target.images[name])) throw new Error('Assembled index changed a natively tested architecture.');
  }
  const report = { schemaVersion: 1, sourceCommit: environment.GITHUB_SHA, sourceTree, upstreamCommit: UPSTREAM_COMMIT, workflowRun: { repository: RELEASE_REPOSITORY, runId: environment.GITHUB_RUN_ID, attempt: 1 }, targets: Object.fromEntries(receipts.map(item => [item.runnerPlatform, { runnerPlatform: item.runnerPlatform, images: Object.fromEntries(Object.entries(item.images).map(([name, value]) => [name, value.configDigest])), checks: item.checks }])) };
  await fs.writeFile(path.join(inputDirectory, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const files = Object.fromEntries(await Promise.all(CANDIDATE_FILES.map(async name => [name, sha256(await fs.readFile(path.join(inputDirectory, name)))])));
  const templates = Object.fromEntries(await Promise.all(TEMPLATE_FILES.map(async name => [name, sha256(await fs.readFile(path.join(sourceRoot, name)))])));
  const candidate = { schemaVersion: 1, status: 'engineering-qualified', sourceCommit: environment.GITHUB_SHA, sourceTree, upstreamCommit: UPSTREAM_COMMIT, images, verification: { automated: 'passed', human: 'pending', reportSha256: files['verification.json'] }, files, templates };
  candidate.artifactSetSha256 = candidateFingerprint(candidate);
  validateQualificationReport(report, candidate);
  return candidate;
}

async function checkCandidateIndex(candidate, name, read, reference = candidate.images[name].reference.split('@')[1]) {
  const bytes = await read('manifests', reference);
  const index = JSON.parse(bytes);
  const inspected = await inspectImageIndex(bytes, value => read(index.manifests.some(item => item.digest === value) ? 'manifests' : 'blobs', value), { imageName: name, sourceCommit: candidate.sourceCommit });
  if (!isDeepStrictEqual(inspected, candidate.images[name])) throw new Error('Registry index/architecture/configuration bytes differ from the exact candidate.');
  return bytes;
}

async function checkPrivateDestinationHistory(candidate, name, environment, versions, complete = false) {
  const index = candidate.images[name].reference.split('@')[1];
  const allowed = new Set([index, ...PLATFORMS.map(platform => candidate.images[name].manifests[platform].digest)]);
  const actual = await versions(IMAGE_REPOSITORIES[name], environment.STUDIO_PACKAGE_METADATA_TOKEN || environment.GITHUB_TOKEN);
  if (!Array.isArray(actual) || actual.some(value => !allowed.has(value)) || (complete && !actual.includes(index))) throw new Error('A private destination contains other image versions or an incomplete candidate; review its history before making the whole package public.');
}

export async function prepareCandidateDestinations(candidate, { environment = process.env, request, metadata = packageMetadata, versions = packageVersions, registry, docker = dockerCommand } = {}) {
  const identity = buildIdentity(environment);
  validateCandidateManifest(candidate);
  if (candidate.sourceCommit !== environment.GITHUB_SHA) throw new Error('Candidate source differs from the authorized private bootstrap build.');
  await verifyCandidateGate('stage', null, { environment, request });
  await verifyPackageSet('private', { environment, metadata });
  const states = await destinationStates({ environment, metadata });
  const privateReaders = Object.fromEntries(Object.keys(STAGING_REPOSITORIES).map(name => [name, registry ? registry(name, 'private') : registryReader(STAGING_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  const destinationReaders = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, registry ? registry(name, 'destination') : registryReader(IMAGE_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  // Existing public destinations receive nothing before the exact-publication gate.
  // Private destinations may contain only these candidate manifest bytes; changing
  // visibility later exposes the entire package, not merely its current build tag.
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    await checkCandidateIndex(candidate, name, privateReaders[name]);
    if (states[name] === 'public') continue;
    if (states[name] === 'private') {
      await checkPrivateDestinationHistory(candidate, name, environment, versions);
      if (await destinationReaders[name]('manifests', identity, { absent: true }) !== null) throw new Error('A private destination build tag already exists; do not overwrite it.');
    }
  }
  if (Object.values(states).some(value => value !== 'public')) await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    if (states[name] === 'public') continue;
    await verifyPackageSet('private', { environment, metadata });
    const before = await metadata(repository, environment.STUDIO_PACKAGE_METADATA_TOKEN || environment.GITHUB_TOKEN);
    if (before !== null) {
      assertPackage(before, repository, 'private');
      await checkPrivateDestinationHistory(candidate, name, environment, versions);
      if (await destinationReaders[name]('manifests', identity, { absent: true }) !== null) throw new Error('The destination build tag appeared before copying; do not overwrite it.');
    } else if (!bootstrapAllowed(environment)) throw new Error('Private package creation was not authorized.');
    await docker(['buildx', 'imagetools', 'create', '--tag', `${repository}:${identity}`, `${STAGING_REPOSITORIES[name]}@${candidate.images[name].reference.split('@')[1]}`]);
    assertPackage(await metadata(repository, environment.STUDIO_PACKAGE_METADATA_TOKEN || environment.GITHUB_TOKEN), repository, 'private');
    await checkCandidateIndex(candidate, name, destinationReaders[name], identity);
    await checkPrivateDestinationHistory(candidate, name, environment, versions, true);
  }
  return { buildIdentity: identity, artifactSetSha256: candidate.artifactSetSha256, status: 'awaiting-public-distribution-approval', destinations: Object.fromEntries(Object.entries(states).map(([name, state]) => [name, state === 'public' ? 'copy-after-approval' : 'private-awaiting-owner-visibility-change'])) };
}

export async function publishCandidate(candidate, { environment = process.env, request, metadata, registry, docker = dockerCommand } = {}) {
  const identity = buildIdentity(environment);
  validateCandidateManifest(candidate);
  await verifyCandidateGate('publish', candidate, { environment, request });
  await verifyPackageSet('private', { environment, metadata });
  await verifyPackageSet('public', { environment, metadata });
  const privateReaders = Object.fromEntries(Object.keys(STAGING_REPOSITORIES).map(name => [name, registry ? registry(name, 'private') : registryReader(STAGING_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  const publicReaders = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, registry ? registry(name, 'public') : publicRegistry(name)]));
  const pending = [];
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    await checkCandidateIndex(candidate, name, privateReaders[name]);
    const existing = await publicReaders[name]('manifests', identity, { absent: true });
    if (existing === null) pending.push(name);
    else if (`${IMAGE_REPOSITORIES[name]}@sha256:${sha256(existing)}` !== candidate.images[name].reference) throw new Error('An existing candidate build tag has different bytes; never overwrite it.');
  }
  if (pending.length) await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  for (const name of pending) {
    const repository = IMAGE_REPOSITORIES[name];
    await verifyPackageSet('private', { environment, metadata });
    await verifyPackageSet('public', { environment, metadata });
    await docker(['buildx', 'imagetools', 'create', '--tag', `${repository}:${identity}`, `${STAGING_REPOSITORIES[name]}@${candidate.images[name].reference.split('@')[1]}`]);
  }
  for (const name of Object.keys(IMAGE_REPOSITORIES)) await checkCandidateIndex(candidate, name, publicReaders[name], identity);
  // Pull every architecture after dropping login; this verifies registry layer
  // availability without rebuilding or pretending an emulated runtime test is native.
  await docker(['logout', 'ghcr.io']);
  for (const [name, image] of Object.entries(candidate.images)) for (const platform of PLATFORMS) {
    await docker(['pull', '--platform', platform, image.reference]);
    // Docker 28.0.4/API 1.48 cannot inspect --platform. The expected config ID
    // is unambiguous even when a newer image store retains both architectures.
    const expectedId = image.manifests[platform].configDigest;
    const inspected = JSON.parse(await docker(['image', 'inspect', expectedId]))[0];
    if (inspected?.Id !== expectedId || `${inspected.Os}/${inspected.Architecture}` !== platform) throw new Error(`Anonymous ${name} pull differs from the natively tested ${platform} image.`);
  }
  return { buildIdentity: identity, artifactSetSha256: candidate.artifactSetSha256, officialRelease: false, images: Object.fromEntries(Object.entries(candidate.images).map(([name, value]) => [name, value.reference])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, argument] = process.argv.slice(2);
    const identity = buildIdentity();
    if (operation === 'review') {
      if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Owner-dispatched private candidate build\n\n\`\`\`text\n${stagingStatement()}\n\`\`\`\n\nThe authenticated owner's manual dispatch and explicit bootstrap input authorize this private operation. Public distribution requires a later exact-digest approval.\n`);
      console.log(stagingStatement());
    } else if (operation === 'authorize') {
      await verifyCandidateGate('stage');
      await verifyPackageSet('private', { allowAbsent: true });
      await destinationStates();
      console.log('Owner gate and actual package visibility/explicit first-use bootstrap eligibility verified.');
    } else if (operation === 'stage') {
      const sourceTree = await command('git', ['rev-parse', 'HEAD^{tree}']);
      if (await command('git', ['rev-parse', 'HEAD']) !== process.env.GITHUB_SHA || await command('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Native build source is not the exact clean workflow commit.');
      const target = await stageNativeTarget(argument, sourceTree);
      await fs.mkdir('candidate-targets', { recursive: true });
      await fs.writeFile(`candidate-targets/${argument.split('/')[1]}.json`, JSON.stringify(target, null, 2) + '\n', { flag: 'wx' });
    } else if (operation === 'assemble') {
      const receipts = await Promise.all(PLATFORMS.map(async platform => JSON.parse(await fs.readFile(`candidate-targets/${platform.split('/')[1]}.json`, 'utf8'))));
      const candidate = await assembleCandidate(receipts, 'candidate-inputs');
      await materializeCandidate(candidate, 'candidate-inputs', root, 'candidate-bundle');
      const prepared = await prepareCandidateDestinations(candidate);
      const visibilityActions = Object.entries(prepared.destinations).filter(([, state]) => state === 'private-awaiting-owner-visibility-change').map(([name]) => `- [${IMAGE_REPOSITORIES[name]}](https://github.com/users/${RELEASE_OWNER}/packages/container/package/${IMAGE_REPOSITORIES[name].split('/').at(-1)}): change this intended destination package to Public. Its active versions were checked against only this complete candidate.`);
      if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Complete candidate awaiting public-distribution approval\n\nBuild: ${identity}\n\n${Object.entries(candidate.images).map(([name, value]) => `${name}: \`${value.reference}\``).join('\n\n')}\n\n${visibilityActions.length ? `First use: while the next job waits for approval, perform these one-time visibility actions only if you approve public distribution of this exact candidate. Package visibility applies to all versions and cannot be made private again. The two staging packages must remain private.\n\n${visibilityActions.join('\n')}\n\n` : ''}\`\`\`text\n${publicCandidateStatement(candidate)}\n\`\`\`\n\nApprove the candidate-publication environment with this exact comment after any listed visibility actions. Both native architectures and all required deployment/browser checks passed before assembly. The bundle is not yet a completed public handoff; the resumed job must verify anonymous pulls for both images and architectures. This is not human acceptance or an official release.\n`);
    } else if (operation === 'publish') {
      const candidate = JSON.parse(await fs.readFile('candidate-bundle/candidate-manifest.json', 'utf8'));
      for (const name of CANDIDATE_FILES) if (sha256(await fs.readFile(path.join('candidate-bundle', name))) !== candidate.files[name]) throw new Error('Downloaded candidate source/evidence bundle differs from its approved fingerprint.');
      validateQualificationReport(JSON.parse(await fs.readFile('candidate-bundle/verification.json', 'utf8')), candidate);
      const result = await publishCandidate(candidate);
      if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Exact public candidate available\n\nArtifact set: \`${result.artifactSetSha256}\`\n\nUse the digest-pinned Portainer templates in this run's candidate bundle. No official date version was created.\n`);
      console.log(JSON.stringify(result));
    } else throw new Error('Usage: node scripts/candidate-pipeline.mjs review | authorize | stage <linux/amd64|linux/arm64> | assemble | publish');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
