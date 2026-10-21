#!/usr/bin/env node
// Candidate delivery retains the exact natively qualified image pair.
// A marked default-branch push or manual run requests delivery; no owner review
// is needed for engineering candidates. Official promotion remains separate.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';
import { IMAGE_REPOSITORIES, PLATFORMS, TEMPLATE_FILES, CANDIDATE_FILES, QUALIFICATION_CHECKS, sha256, isCommit, isHash, candidateFingerprint, validateCandidateManifest, validateQualificationReport, materializeCandidate } from './candidate-manifest.mjs';
import { inspectArchitectureManifest, inspectImageIndex } from './inspect-image-set.mjs';
import { RELEASE_REPOSITORY, RELEASE_OWNER, CANDIDATE_WORKFLOW, verifyCandidateRun } from './release-guard.mjs';
import { RegistryAccessError, registryReader, publicRegistry } from './ghcr-read.mjs';

export { CANDIDATE_WORKFLOW };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localNames = { studio: 'homepage-studio-ci:writer', homepage: 'homepage-studio-ci:renderer' };

export function buildIdentity(environment = process.env) {
  if (!isCommit(environment.GITHUB_SHA) || !/^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ID || '') || environment.GITHUB_RUN_ATTEMPT !== '1' || environment.STUDIO_CANDIDATE_SOURCE !== environment.GITHUB_SHA) throw new Error('Build only the identified default-branch source in a fresh run.');
  return `build-${environment.GITHUB_SHA}-${environment.GITHUB_RUN_ID}`;
}

async function command(program, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; const errors = []; let total = 0; let errorTotal = 0;
    child.stdout.on('data', bytes => { total += bytes.length; if (total > 8 * 1024 * 1024) child.kill(); else output.push(bytes); });
    child.stderr.on('data', bytes => { if (errorTotal < 16384) errors.push(bytes.subarray(0, 16384 - errorTotal)); errorTotal += bytes.length; });
    const detail = () => {
      let text = Buffer.concat(errors).toString('utf8').trim();
      for (const secret of [process.env.GITHUB_TOKEN, input?.trim()].filter(value => value && value.length > 3)) text = text.replaceAll(secret, '[redacted]');
      return text.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, '$1?[redacted]').replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, '[redacted authorization]');
    };
    child.on('error', () => reject(new Error(`${program} candidate operation could not start.`)));
    child.on('close', code => code === 0 && total <= 8 * 1024 * 1024 ? resolve(Buffer.concat(output).toString('utf8').trim()) : reject(new Error(`${program} ${args.slice(0, 3).join(' ')} failed (${code}). ${detail()}`)));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
const dockerCommand = (args, input) => command('docker', args, input);
const digest = value => typeof value === 'string' && value.startsWith('sha256:') && isHash(value.slice(7));

export async function stageNativeTarget(platform, sourceTree, { environment = process.env, request, registry, docker = dockerCommand, runnerPlatform = `linux/${process.arch === 'x64' ? 'amd64' : process.arch}` } = {}) {
  const identity = buildIdentity(environment);
  if (!PLATFORMS.includes(platform) || runnerPlatform !== platform || !isCommit(sourceTree)) throw new Error('The advertised architecture must be tested on its native runner with an exact source tree.');
  await verifyCandidateRun({ environment, request });
  if (!environment.GITHUB_TOKEN) throw new Error('The repository workflow token is required to retain this candidate.');
  const tag = `${identity}-${platform.split('/')[1]}`;
  const readers = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, registry ? registry(name, 'authenticated') : registryReader(IMAGE_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  const ids = {};
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    const inspected = JSON.parse(await docker(['image', 'inspect', localNames[name]]))[0];
    if (!digest(inspected?.Id) || `${inspected.Os}/${inspected.Architecture}` !== platform || inspected.Config?.Labels?.['org.opencontainers.image.revision'] !== environment.GITHUB_SHA) throw new Error('The locally qualified image identity/architecture does not match this run.');
    ids[name] = inspected.Id;
  }
  await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  const images = {};
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    // The full commit, globally unique run ID, native architecture and first-attempt
    // guard reserve a new candidate name. A pull-only probe before first creation
    // cannot prove absence, so let the standard authenticated push create packages.
    await docker(['tag', localNames[name], `${repository}:${tag}`]);
    await docker(['push', `${repository}:${tag}`]);
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

export async function assembleCandidate(receipts, inputDirectory, { environment = process.env, request, registry, docker = dockerCommand, sourceRoot = root } = {}) {
  const { identity, sourceTree } = validateTargetReceipts(receipts, environment);
  await verifyCandidateRun({ environment, request });
  const images = {};
  const readers = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, registry ? registry(name, 'authenticated') : registryReader(IMAGE_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN })]));
  for (const name of Object.keys(IMAGE_REPOSITORIES)) if (await readers[name]('manifests', identity, { absent: true }) !== null) throw new Error('A candidate index already exists; do not replace it.');
  await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    // Check all staged child/config bytes before constructing this index.
    for (const target of receipts) {
      const child = await readers[name]('manifests', target.images[name].digest);
      const inspected = await inspectArchitectureManifest(child, value => readers[name]('blobs', value), { imageName: name, sourceCommit: environment.GITHUB_SHA, platform: target.runnerPlatform });
      if (!isDeepStrictEqual(inspected, target.images[name])) throw new Error('Staged native image bytes differ from the qualification receipt.');
    }
    await docker(['buildx', 'imagetools', 'create', '--tag', `${repository}:${identity}`, ...PLATFORMS.map(platform => `${repository}@${receipts.find(item => item.runnerPlatform === platform).images[name].digest}`)]);
    const raw = await readers[name]('manifests', identity);
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
  const children = new Map();
  const inspected = await inspectImageIndex(bytes, async value => {
    const kind = index.manifests.some(item => item.digest === value) ? 'manifests' : 'blobs';
    const raw = await read(kind, value);
    if (kind === 'manifests') children.set(value, JSON.parse(raw));
    return raw;
  }, { imageName: name, sourceCommit: candidate.sourceCommit });
  if (!isDeepStrictEqual(inspected, candidate.images[name])) throw new Error('Registry index/architecture/configuration bytes differ from the exact candidate.');
  return children;
}

async function pullCandidateImages(candidate, docker, access) {
  for (const [name, image] of Object.entries(candidate.images)) for (const platform of PLATFORMS) {
    const target = image.manifests[platform];
    // A classic Docker store binds each digest reference to one image ID.
    // The verified index already binds these exact platform-specific manifests.
    await docker(['pull', '--platform', platform, `${IMAGE_REPOSITORIES[name]}@${target.digest}`]);
    const expectedId = target.configDigest;
    const inspected = JSON.parse(await docker(['image', 'inspect', expectedId]))[0];
    if (inspected?.Id !== expectedId || `${inspected.Os}/${inspected.Architecture}` !== platform) throw new Error(`${access} ${name} pull differs from the natively tested ${platform} image.`);
  }
}

export async function verifyPublicCandidate(candidate, { registry } = {}) {
  validateCandidateManifest(candidate);
  // Metadata access-denied responses identify a one-time package setting.
  // Every unique layer in each repository is then streamed and hashed without
  // credentials or a Docker cache. Layer failures never become "access pending".
  const pendingPackages = [];
  const layers = new Map();
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    const repository = IMAGE_REPOSITORIES[name];
    const read = registry ? registry(name, 'public') : publicRegistry(name);
    let children;
    try { children = await checkCandidateIndex(candidate, name, read); }
    catch (error) {
      if (!(error instanceof RegistryAccessError) || !error.anonymous) throw error;
      pendingPackages.push(repository);
      continue;
    }
    if (typeof read.verifyBlob !== 'function') throw new Error('Anonymous verification requires streamed layer hashing.');
    for (const { digest: manifestDigest } of Object.values(candidate.images[name].manifests)) {
      for (const layer of children.get(manifestDigest).layers) {
        const key = `${repository}@${layer.digest}`;
        const previous = layers.get(key);
        if (previous && previous.size !== layer.size) throw new Error('A repeated layer digest declares conflicting sizes.');
        layers.set(key, { repository, digest: layer.digest, size: layer.size, read });
      }
    }
  }
  const verificationMethod = 'registry-stream-sha256';
  if (pendingPackages.length) return { anonymousAccess: 'pending', verificationMethod, pendingPackages, layers: [] };
  const verified = [];
  for (const { repository, digest: layerDigest, size, read } of layers.values()) {
    const actual = await read.verifyBlob(layerDigest, size);
    if (actual.digest !== layerDigest || actual.size !== size) throw new Error('Streamed layer verification differs from the accepted manifest.');
    verified.push({ repository, ...actual });
  }
  return { anonymousAccess: 'passed', verificationMethod, pendingPackages: [], layers: verified };
}

export async function verifyCandidateDelivery(candidate, { environment = process.env, request, registry, docker = dockerCommand } = {}) {
  const identity = buildIdentity(environment);
  validateCandidateManifest(candidate);
  if (candidate.sourceCommit !== environment.GITHUB_SHA) throw new Error('Candidate source differs from this delivery run.');
  await verifyCandidateRun({ environment, request });
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    const read = registry ? registry(name, 'authenticated') : registryReader(IMAGE_REPOSITORIES[name], { credential: environment.GITHUB_TOKEN });
    await checkCandidateIndex(candidate, name, read, identity);
  }
  await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  await pullCandidateImages(candidate, docker, 'Authenticated');
  await docker(['logout', 'ghcr.io']);
  const publicAccess = await verifyPublicCandidate(candidate, { registry });
  return { schemaVersion: 1, buildIdentity: identity, sourceCommit: candidate.sourceCommit, artifactSetSha256: candidate.artifactSetSha256, officialRelease: false, status: publicAccess.anonymousAccess === 'passed' ? 'public-ready' : 'package-access-pending', authenticatedPulls: 'passed', ...publicAccess, images: Object.fromEntries(Object.entries(candidate.images).map(([name, value]) => [name, value.reference])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, argument] = process.argv.slice(2);
    if (operation === 'stage') {
      const sourceTree = await command('git', ['rev-parse', 'HEAD^{tree}']);
      if (await command('git', ['rev-parse', 'HEAD']) !== process.env.GITHUB_SHA || await command('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Native build source is not the exact clean workflow commit.');
      const target = await stageNativeTarget(argument, sourceTree);
      await fs.mkdir('candidate-targets', { recursive: true });
      await fs.writeFile(`candidate-targets/${argument.split('/')[1]}.json`, JSON.stringify(target, null, 2) + '\n', { flag: 'wx' });
    } else if (operation === 'assemble') {
      const identity = buildIdentity();
      const receipts = await Promise.all(PLATFORMS.map(async platform => JSON.parse(await fs.readFile(`candidate-targets/${platform.split('/')[1]}.json`, 'utf8'))));
      const candidate = await assembleCandidate(receipts, 'candidate-inputs');
      await materializeCandidate(candidate, 'candidate-inputs', root, 'candidate-bundle');
      const delivery = await verifyCandidateDelivery(candidate);
      const deliveryBytes = Buffer.from(JSON.stringify(delivery, null, 2) + '\n');
      await fs.writeFile('candidate-bundle/delivery-receipt.json', deliveryBytes, { flag: 'wx' });
      await fs.appendFile('candidate-bundle/SHA256SUMS', `${sha256(deliveryBytes)}  delivery-receipt.json\n`);
      const accessNote = delivery.anonymousAccess === 'passed'
        ? 'Anonymous metadata and every unique image layer were downloaded and SHA-256 verified for both images and native architectures. Use the digest-pinned Portainer templates in the candidate bundle.'
        : `The exact images are built, qualified and retained. Authenticated pulls passed for both images and architectures. GitHub starts new packages private; anonymous access is still pending. Change only these intended application packages to Public once, then verify the same image digests without rebuilding:\n\n${delivery.pendingPackages.map(repository => `- [${repository}](https://github.com/users/${RELEASE_OWNER}/packages/container/package/${repository.split('/').at(-1)})`).join('\n')}`;
      if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Candidate built: ${delivery.status}\n\nBuild: ${identity}\n\nArtifact set: \`${candidate.artifactSetSha256}\`\n\n${Object.entries(candidate.images).map(([name, value]) => `${name}: \`${value.reference}\``).join('\n\n')}\n\n${accessNote}\n\nNo candidate workflow approval is required. Human testing is pending; no official date version or GitHub release was created.\n`);
      console.log(JSON.stringify(delivery));
    } else if (operation === 'verify-public' && argument) {
      const candidate = JSON.parse(await fs.readFile(argument, 'utf8'));
      const result = await verifyPublicCandidate(candidate);
      console.log(JSON.stringify({ sourceCommit: candidate.sourceCommit, artifactSetSha256: candidate.artifactSetSha256, ...result }));
      if (result.anonymousAccess !== 'passed') process.exitCode = 2;
    } else throw new Error('Usage: node scripts/candidate-pipeline.mjs stage <linux/amd64|linux/arm64> | assemble | verify-public <candidate-manifest.json>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
