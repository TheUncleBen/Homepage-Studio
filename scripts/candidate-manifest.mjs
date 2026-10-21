#!/usr/bin/env node
// Local artifact consistency, never authorization or publication.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';
import { validateReleaseManifest } from './release-manifest.mjs';

export const IMAGE_REPOSITORIES = Object.freeze({
  studio: 'ghcr.io/theuncleben/homepage-studio',
  homepage: 'ghcr.io/theuncleben/homepage-studio-renderer',
});
// Proposed private stage. Existing packages are verified private before pushes.
// Explicit first-use bootstrap may create absent packages from qualified images;
// the real private visibility is checked immediately after creation.
export const STAGING_REPOSITORIES = Object.freeze({
  studio: 'ghcr.io/theuncleben/homepage-studio-candidate-staging',
  homepage: 'ghcr.io/theuncleben/homepage-studio-renderer-candidate-staging',
});
export const PLATFORMS = Object.freeze(['linux/amd64', 'linux/arm64']);
export const CANDIDATE_FILES = Object.freeze(['studio-source.tar.gz', 'homepage-source.tar.gz', 'verification.json']);
export const TEMPLATE_FILES = Object.freeze(['portainer-compose.yml', 'portainer-swarm.yml']);
export const QUALIFICATION_CHECKS = Object.freeze(['writer', 'packaging', 'native', 'dependencies', 'browser', 'desktopFirefox', 'desktopWebKit', 'hiddenDocument', 'compose', 'swarm', 'portainerCompose', 'portainerSwarm']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
export const isCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const digest = value => typeof value === 'string' && value.startsWith('sha256:') && isHash(value.slice(7));
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function candidateFingerprint(manifest) {
  const { artifactSetSha256, ...content } = manifest;
  return sha256(JSON.stringify(canonical(content)));
}

export function validateCandidateManifest(manifest) {
  if (!exactKeys(manifest, ['schemaVersion', 'status', 'sourceCommit', 'sourceTree', 'upstreamCommit', 'images', 'verification', 'files', 'templates', 'artifactSetSha256']) || manifest.schemaVersion !== 1 || manifest.status !== 'engineering-qualified') throw new Error('Expected an engineering-qualified candidate, without official approval or a date version.');
  if (!isCommit(manifest.sourceCommit) || !isCommit(manifest.sourceTree)) throw new Error('A candidate requires the actual full build commit and source tree.');
  if (manifest.upstreamCommit !== UPSTREAM_COMMIT) throw new Error('Candidate upstream pin does not match this build definition.');
  if (!exactKeys(manifest.images, Object.keys(IMAGE_REPOSITORIES))) throw new Error('A candidate contains both and only the writer and native renderer.');
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    const image = manifest.images[name];
    const prefix = `${repository}@sha256:`;
    if (!exactKeys(image, ['reference', 'buildRevision', 'platforms', 'manifests']) || typeof image.reference !== 'string' || !image.reference.startsWith(prefix) || !isHash(image.reference.slice(prefix.length))) throw new Error('Candidate images require the expected repository and exact index digest.');
    if (image.buildRevision !== manifest.sourceCommit) throw new Error('Each image must identify the actual candidate build commit.');
    if (!Array.isArray(image.platforms) || [...image.platforms].sort().join(',') !== PLATFORMS.join(',') || !exactKeys(image.manifests, PLATFORMS)) throw new Error('Both architectures must be present exactly once in each image.');
    for (const platform of PLATFORMS) {
      const child = image.manifests[platform];
      if (!exactKeys(child, ['digest', 'configDigest']) || !digest(child.digest) || !digest(child.configDigest)) throw new Error('Each architecture needs its immutable manifest and tested image configuration digest.');
    }
  }
  if (!exactKeys(manifest.verification, ['automated', 'human', 'reportSha256']) || manifest.verification.automated !== 'passed' || manifest.verification.human !== 'pending' || !isHash(manifest.verification.reportSha256)) throw new Error('Candidates require engineering evidence and must leave human acceptance pending.');
  if (!exactKeys(manifest.files, CANDIDATE_FILES) || CANDIDATE_FILES.some(name => !isHash(manifest.files[name])) || manifest.files['verification.json'] !== manifest.verification.reportSha256) throw new Error('Candidate evidence and both corresponding-source archives require exact hashes.');
  if (!exactKeys(manifest.templates, TEMPLATE_FILES) || TEMPLATE_FILES.some(name => !isHash(manifest.templates[name]))) throw new Error('Candidate deployment template inputs must be bound by hash.');
  const fingerprint = candidateFingerprint(manifest);
  if (manifest.artifactSetSha256 !== fingerprint) throw new Error('Candidate fingerprint does not match its exact artifact set.');
  return { sourceCommit: manifest.sourceCommit, artifactSetSha256: fingerprint };
}

export function validateQualificationReport(report, manifest) {
  validateCandidateManifest(manifest);
  if (!object(report) || report.schemaVersion !== 1 || report.sourceCommit !== manifest.sourceCommit || report.sourceTree !== manifest.sourceTree || report.upstreamCommit !== manifest.upstreamCommit || !exactKeys(report.targets, PLATFORMS)) throw new Error('Qualification evidence must identify the actual candidate source and both native architecture targets.');
  if (!exactKeys(report.workflowRun, ['repository', 'runId', 'attempt']) || report.workflowRun.repository !== 'TheUncleBen/Homepage-Studio' || !/^[1-9][0-9]*$/.test(report.workflowRun.runId || '') || typeof report.workflowRun.runId !== 'string' || report.workflowRun.attempt !== 1) throw new Error('Qualification evidence must bind the exact candidate workflow run and first attempt.');
  for (const platform of PLATFORMS) {
    const target = report.targets[platform];
    if (!object(target) || target.runnerPlatform !== platform || !exactKeys(target.images, Object.keys(IMAGE_REPOSITORIES)) || !exactKeys(target.checks, QUALIFICATION_CHECKS) || QUALIFICATION_CHECKS.some(name => target.checks[name] !== 'passed')) throw new Error('Every required engineering check must pass on each advertised native architecture.');
    for (const name of Object.keys(IMAGE_REPOSITORIES)) {
      if (target.images[name] !== manifest.images[name].manifests[platform].configDigest) throw new Error('The tested local image configuration must equal the published architecture configuration.');
    }
  }
}

export function matchCandidateToRelease(candidate, release) {
  validateCandidateManifest(candidate);
  validateReleaseManifest(release);
  if (release.sourceCommit !== candidate.sourceCommit || release.upstreamCommit !== candidate.upstreamCommit || release.verification.reportSha256 !== candidate.verification.reportSha256) throw new Error('Official approval must retain the candidate source and engineering evidence.');
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    const before = candidate.images[name];
    const after = release.images[name];
    if (before.reference !== after.reference || before.buildRevision !== after.buildRevision || [...after.platforms].sort().join(',') !== [...before.platforms].sort().join(',')) throw new Error('Official promotion must preserve both candidate image index digests and build identities.');
  }
}

async function readRegular(filename, maximum = 512 * 1024 * 1024) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size > maximum) throw new Error('Candidate inputs must be bounded regular files, not links.');
  const bytes = await fs.readFile(filename);
  if (bytes.length > maximum) throw new Error('Candidate input exceeds its size limit.');
  return bytes;
}

export async function materializeCandidate(manifest, inputDirectory, sourceRoot, outputDirectory) {
  const result = validateCandidateManifest(manifest);
  const files = new Map();
  for (const name of CANDIDATE_FILES) {
    const bytes = await readRegular(path.join(inputDirectory, name));
    if (sha256(bytes) !== manifest.files[name]) throw new Error(`Candidate input hash differs: ${name}`);
    files.set(name, bytes);
  }
  validateQualificationReport(JSON.parse(files.get('verification.json').toString('utf8')), manifest);
  for (const name of TEMPLATE_FILES) {
    const bytes = await readRegular(path.join(sourceRoot, name), 1024 * 1024);
    if (sha256(bytes) !== manifest.templates[name]) throw new Error(`Deployment template input hash differs: ${name}`);
    let contents = bytes.toString('utf8');
    for (const [variable, image] of [['STUDIO_IMAGE', 'studio'], ['HOMEPAGE_IMAGE', 'homepage']]) {
      const expression = new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`, 'g');
      if ([...contents.matchAll(expression)].length !== 1) throw new Error('Each deployment template needs exactly one substitution for each image.');
      contents = contents.replace(expression, manifest.images[image].reference);
    }
    files.set(name, Buffer.from(contents));
  }
  files.set('candidate-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  files.set('portainer.env.example', Buffer.from('STUDIO_PUBLIC_ORIGIN=http://homepage.example.test:3000\nSTUDIO_PORT=3000\n# Swarm only: the node holding the named volumes.\nSTUDIO_NODE=<docker-node-hostname>\nSTUDIO_BACKUP_RETENTION=25\n'));
  files.set('READ-ME-FIRST.txt', Buffer.from(`Homepage Studio human-test candidate\n\nSource: ${manifest.sourceCommit}\nArtifact set: ${result.artifactSetSha256}\nHuman acceptance: pending. No official version is assigned.\n\nDelivery must be separately authorized. These templates are usable only after\nthe exact images are available through the approved access path. This bundle\ndoes not publish images or certify owner approval.\n\nIn Portainer, create a new stack using the Compose or Swarm template.\nSet the exact dashboard origin and, for Swarm, the node holding the volumes.\nUse a new stack/volumes for the first evaluation. Keep the old dashboard intact.\n\nHuman checks: your phone's touch/scroll feel and Samsung-style stack behavior;\ntheme and readability on your displays; actual service credentials and widget\ndata; hostname/NetBird access and storage on your Portainer host.\n\nRecord findings against this artifact set. Do not upgrade one image alone.\nFor rollback, retain the previous digest-pinned image pair and its matching\nconfiguration/state backup. Restore the full pair and matching data together.\nA first evaluation on a new stack can be stopped without altering the old one.\n`));
  files.set('SHA256SUMS', Buffer.from([...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join('')));
  const output = path.resolve(outputDirectory);
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Exclusive directory creation prevents concurrent invocations overwriting a bundle.
  await fs.mkdir(output);
  try {
    for (const [name, bytes] of files) await fs.writeFile(path.join(output, name), bytes, { flag: 'wx', mode: 0o644 });
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true });
    throw error;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, filename, inputDirectory, sourceRoot, outputDirectory, ...extra] = process.argv.slice(2);
    if (extra.length || !filename || !['validate', 'materialize'].includes(command) || (command === 'materialize' && (!inputDirectory || !sourceRoot || !outputDirectory)) || (command === 'validate' && inputDirectory)) throw new Error('Usage: node scripts/candidate-manifest.mjs validate <manifest.json> | materialize <manifest.json> <candidate-inputs> <accepted-source-directory> <new-output-directory>');
    const manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
    console.log(JSON.stringify(command === 'validate' ? validateCandidateManifest(manifest) : await materializeCandidate(manifest, inputDirectory, sourceRoot, outputDirectory)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
