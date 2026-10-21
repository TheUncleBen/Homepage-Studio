#!/usr/bin/env node
// The only publisher. Requires authenticated approval in the dormant manual workflow.
// Never builds, changes visibility, replaces a ref/asset, or overwrites a date tag.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { materializeRelease } from './release-manifest.mjs';
import { IMAGE_REPOSITORIES, CANDIDATE_FILES, TEMPLATE_FILES, sha256, matchCandidateToRelease, validateQualificationReport } from './candidate-manifest.mjs';
import { inspectImageIndex } from './inspect-image-set.mjs';
import { RELEASE_REPOSITORY, RELEASE_OWNER, verifyTrustedApproval, verifyQualifiedCandidateRun, githubApi, boundedResponse } from './release-guard.mjs';
import { publicRegistry } from './ghcr-read.mjs';

async function runDocker(args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Docker publication command could not start.')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Docker publication command failed (${code}); inspect the runner without retrying publication blindly.`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function regularFile(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Release inputs must be bounded regular files.');
  return fs.readFile(filename);
}

export const QUALIFIED_BUNDLE_FILES = Object.freeze(['candidate-manifest.json', ...CANDIDATE_FILES, ...TEMPLATE_FILES]);
export async function loadQualifiedCandidateBundle(directory) {
  return Object.fromEntries(await Promise.all(QUALIFIED_BUNDLE_FILES.map(async name => [name, await regularFile(path.join(directory, name))])));
}

export async function prepareOfficialAssets(candidate, release, candidateDirectory, acceptedSource, outputDirectory) {
  matchCandidateToRelease(candidate, release);
  const files = {};
  for (const name of CANDIDATE_FILES) {
    files[name] = await regularFile(path.join(candidateDirectory, name));
    if (sha256(files[name]) !== candidate.files[name]) throw new Error(`Accepted candidate bytes changed: ${name}`);
  }
  validateQualificationReport(JSON.parse(files['verification.json'].toString('utf8')), candidate);
  for (const [name, expected] of Object.entries(candidate.templates)) if (sha256(await regularFile(path.join(acceptedSource, name))) !== expected) throw new Error('Accepted deployment-template source changed.');
  await materializeRelease(release, outputDirectory, acceptedSource);
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(outputDirectory, name), bytes, { flag: 'wx' });
  await fs.writeFile(path.join(outputDirectory, 'candidate-manifest.json'), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  const assets = {};
  for (const name of (await fs.readdir(outputDirectory)).sort()) assets[name] = await regularFile(path.join(outputDirectory, name));
  assets.SHA256SUMS = Buffer.from(Object.entries(assets).map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join(''));
  await fs.writeFile(path.join(outputDirectory, 'SHA256SUMS'), assets.SHA256SUMS, { flag: 'wx' });
  return assets;
}

export async function promoteRelease(candidate, release, assets, {
  environment = process.env, request, registry, docker = runDocker, upload,
  now, fetcher = fetch, templateSources, qualifiedBundle,
} = {}) {
  // The guard performs all its own authenticated reads; no guard receipt input is trusted.
  const api = request || githubApi(environment.GITHUB_TOKEN, fetcher);
  const authorization = await verifyTrustedApproval(candidate, release, { environment, request: api, now: now || new Date() });
  if (!environment.GITHUB_TOKEN) throw new Error('The approved workflow token is required.');
  const expectedAssetNames = ['candidate-manifest.json', 'release-manifest.json', 'portainer-compose.yml', 'portainer-swarm.yml', 'portainer.env.example', ...CANDIDATE_FILES, 'SHA256SUMS'].sort();
  if (!assets || Object.keys(assets).sort().join(',') !== expectedAssetNames.join(',') || Object.values(assets).some(bytes => !Buffer.isBuffer(bytes))) throw new Error('Publish only the complete, prepared official asset allowlist.');
  // The reviewed workflow downloads this exact named artifact from the successful
  // candidate run using a pinned action with digest-mismatch=error. A matching run
  // alone is insufficient: its immutable bundle must contain these accepted bytes.
  if (!qualifiedBundle || Object.keys(qualifiedBundle).sort().join(',') !== [...QUALIFIED_BUNDLE_FILES].sort().join(',') || QUALIFIED_BUNDLE_FILES.some(name => !Buffer.isBuffer(qualifiedBundle[name]) || !qualifiedBundle[name].equals(assets[name]))) throw new Error('Accepted manifests, evidence, source and deployment templates must match the immutable bundle downloaded from the exact candidate run.');
  if (!isDeepStrictEqual(JSON.parse(assets['candidate-manifest.json']), candidate) || !isDeepStrictEqual(JSON.parse(assets['release-manifest.json']), release)) throw new Error('Prepared manifest assets do not identify this promotion.');
  for (const name of CANDIDATE_FILES) if (sha256(assets[name]) !== candidate.files[name]) throw new Error('Prepared corresponding-source or evidence bytes changed.');
  const report = JSON.parse(assets['verification.json'].toString('utf8'));
  validateQualificationReport(report, candidate);
  const qualification = await verifyQualifiedCandidateRun(report, candidate, { environment, request: api });
  for (const [name, expectedHash] of Object.entries(candidate.templates)) {
    const source = templateSources?.[name];
    if (!Buffer.isBuffer(source) || sha256(source) !== expectedHash) throw new Error('Promotion must recheck the exact accepted template source.');
    let rendered = source.toString('utf8');
    for (const [variable, image] of [['STUDIO_IMAGE', 'studio'], ['HOMEPAGE_IMAGE', 'homepage']]) {
      const pattern = new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`, 'g');
      if ([...rendered.matchAll(pattern)].length !== 1) throw new Error('Accepted template image substitution is ambiguous.');
      rendered = rendered.replace(pattern, candidate.images[image].reference);
    }
    if (!assets[name].equals(Buffer.from(rendered))) throw new Error('Prepared Portainer asset differs from the accepted template and image pair.');
  }
  const sums = expectedAssetNames.filter(name => name !== 'SHA256SUMS').map(name => `${sha256(assets[name])}  ${name}\n`).join('');
  if (assets.SHA256SUMS.toString('utf8') !== sums) throw new Error('The official asset checksum list differs from the prepared bytes.');
  const readers = Object.fromEntries(Object.keys(IMAGE_REPOSITORIES).map(name => [name, registry ? registry(name) : publicRegistry(name, fetcher)]));
  // All preconditions, including anonymous readback, precede the first write.
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    const read = readers[name];
    const bytes = await read('manifests', candidate.images[name].reference.split('@')[1]);
    const actual = await inspectImageIndex(bytes, async digest => {
      // Both config and manifest digests are immutable; try manifest first only for known children.
      const index = JSON.parse(bytes.toString('utf8'));
      const isManifest = index.manifests.some(item => item.digest === digest);
      return read(isManifest ? 'manifests' : 'blobs', digest);
    }, { imageName: name, sourceCommit: candidate.sourceCommit });
    if (!isDeepStrictEqual(actual, candidate.images[name])) throw new Error(`Registry identity differs from the accepted ${name} image.`);
    if (await read('manifests', release.version, { absent: true }) !== null) throw new Error(`The official image tag already exists in ${repository}.`);
  }
  if (await api(`/git/ref/tags/${release.version}`, { absent: true }) !== null || await api(`/releases/tags/${release.version}`, { absent: true }) !== null) throw new Error('The official Git tag or release already exists.');
  // Check the source tree through GitHub, not a hand-written sourceCommit field alone.
  const acceptedCommit = await api(`/git/commits/${candidate.sourceCommit}`);
  if (acceptedCommit.sha !== candidate.sourceCommit || acceptedCommit.tree?.sha !== candidate.sourceTree) throw new Error('GitHub source commit/tree differs from the accepted candidate.');
  const defaultRef = await api(`/git/ref/heads/${encodeURIComponent(environment.GITHUB_REF.slice('refs/heads/'.length))}`);
  if (defaultRef.object?.type !== 'commit' || typeof defaultRef.object.sha !== 'string' || !/^[a-f0-9]{40}$/.test(defaultRef.object.sha)) throw new Error('Cannot verify the current default-branch commit.');
  if (defaultRef.object.sha !== candidate.sourceCommit) {
    const currentDefault = await api(`/git/commits/${defaultRef.object.sha}`);
    const acceptedTree = await api(`/git/trees/${candidate.sourceTree}?recursive=1`);
    const currentTree = await api(`/git/trees/${currentDefault.tree?.sha}?recursive=1`);
    const workflowTree = result => !result.truncated && Array.isArray(result.tree) ? result.tree.find(item => item.path === '.github/workflows' && item.type === 'tree')?.sha : undefined;
    if (!workflowTree(acceptedTree) || workflowTree(acceptedTree) !== workflowTree(currentTree)) throw new Error('Accepted/default workflow trees differ; review GitHub workflow-write requirements before publication. No broader credential is assumed.');
  }

  // Creating the new ref is an atomic reservation. A partial failure is left for
  // explicit operator recovery; this code never deletes or overwrites anything.
  const createdRef = await api('/git/refs', { method: 'POST', body: { ref: `refs/tags/${release.version}`, sha: candidate.sourceCommit } });
  if (createdRef.object?.sha !== candidate.sourceCommit || createdRef.ref !== `refs/tags/${release.version}`) throw new Error('Created tag readback differs from the accepted source.');
  await docker(['login', 'ghcr.io', '--username', RELEASE_OWNER, '--password-stdin'], environment.GITHUB_TOKEN + '\n');
  for (const [name, repository] of Object.entries(IMAGE_REPOSITORIES)) {
    // One existing index input, without annotations/platform filtering, is a carbon copy.
    await docker(['buildx', 'imagetools', 'create', '--tag', `${repository}:${release.version}`, candidate.images[name].reference]);
    const published = await readers[name]('manifests', release.version);
    if (`${repository}@sha256:${sha256(published)}` !== candidate.images[name].reference) throw new Error('Promoted image bytes differ; stop and inspect the partial publication.');
  }
  const draft = await api('/releases', { method: 'POST', body: {
    tag_name: release.version, target_commitish: candidate.sourceCommit, name: release.version, draft: true, prerelease: false,
    body: `Owner-approved Homepage Studio ${release.version}\n\nSource: ${candidate.sourceCommit}\nCandidate artifact set: ${candidate.artifactSetSha256}\nRelease artifact set: ${authorization.releaseArtifactSetSha256}\n\nInstall with the digest-pinned Portainer Compose or Swarm asset and set the dashboard origin. Both image digests and corresponding source are preserved from the accepted candidate. Upgrade manually and retain the previous image pair and matching data backup for rollback.\n`,
  } });
  if (!Number.isSafeInteger(draft.id) || draft.draft !== true || draft.tag_name !== release.version) throw new Error('Draft release creation did not return the expected identity.');
  const uploadAsset = upload || (async (name, bytes) => {
    const response = await fetcher(`https://uploads.github.com/repos/${RELEASE_REPOSITORY}/releases/${draft.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { authorization: `Bearer ${environment.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, body: bytes,
    });
    if (!response.ok) throw new Error(`Release asset upload failed (${response.status}); keep the release draft for explicit recovery.`);
    return JSON.parse((await boundedResponse(response)).toString('utf8'));
  });
  for (const name of expectedAssetNames) {
    const asset = await uploadAsset(name, assets[name], draft.id);
    if (asset.name !== name || asset.state !== 'uploaded' || asset.size !== assets[name].length || asset.digest !== `sha256:${sha256(assets[name])}`) throw new Error('Uploaded asset identity differs; the release remains a draft.');
  }
  // A slow upload may cross the Chicago date boundary. Recheck live approval,
  // publication date and the reserved source ref before making the draft public.
  await verifyTrustedApproval(candidate, release, { environment, request: api, now: now || new Date() });
  const reservedRef = await api(`/git/ref/tags/${release.version}`);
  if (reservedRef.object?.sha !== candidate.sourceCommit) throw new Error('Reserved tag changed before publication; leave the release draft.');
  const published = await api(`/releases/${draft.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'false' } });
  // GitHub ignores target_commitish when the tag already exists. The actual Git
  // ref, checked before and after publication, is the authoritative source binding.
  if (published.draft !== false || published.tag_name !== release.version) throw new Error('Published release readback differs from the approved date tag.');
  const finalAssets = await api(`/releases/${draft.id}/assets?per_page=100`);
  if (!Array.isArray(finalAssets) || finalAssets.length !== expectedAssetNames.length || expectedAssetNames.some(name => finalAssets.filter(asset => asset.name === name && asset.digest === `sha256:${sha256(assets[name])}` && asset.size === assets[name].length).length !== 1)) throw new Error('Published asset readback differs from the approved artifact set.');
  const finalRef = await api(`/git/ref/tags/${release.version}`);
  if (finalRef.object?.sha !== candidate.sourceCommit) throw new Error('Final tag readback differs from the accepted source.');
  return { ...authorization, candidateRunId: qualification.runId, releaseId: draft.id, releaseUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${release.version}`, githubImmutable: published.immutable === true, images: Object.fromEntries(Object.entries(candidate.images).map(([name, value]) => [name, value.reference])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [candidateFile, releaseFile, candidateDirectory, acceptedSource, outputDirectory, ...extra] = process.argv.slice(2);
    if (!outputDirectory || extra.length) throw new Error('Usage: node scripts/promote-release.mjs <candidate-manifest.json> <release-manifest.json> <candidate-input-directory> <accepted-source-directory> <new-release-output-directory>');
    const candidate = JSON.parse(await regularFile(candidateFile));
    const release = JSON.parse(await regularFile(releaseFile));
    // A direct CLI invocation outside the approved workflow fails before even materializing assets.
    await verifyTrustedApproval(candidate, release);
    const qualifiedBundle = await loadQualifiedCandidateBundle(candidateDirectory);
    const assets = await prepareOfficialAssets(candidate, release, candidateDirectory, acceptedSource, outputDirectory);
    const templateSources = Object.fromEntries(await Promise.all(Object.keys(candidate.templates).map(async name => [name, await regularFile(path.join(acceptedSource, name))])));
    console.log(JSON.stringify(await promoteRelease(candidate, release, assets, { templateSources, qualifiedBundle })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
