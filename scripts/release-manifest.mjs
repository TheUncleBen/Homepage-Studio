#!/usr/bin/env node
// Offline consistency checks and digest-pinned template generation only.
// This tool cannot authenticate owner approval and has no publication commands.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const fullHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
const imageNames = { studio: 'ghcr.io/theuncleben/homepage-studio' };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function artifactFingerprint(manifest) {
  return hash(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    upstreamCommit: manifest.upstreamCommit,
    images: Object.fromEntries(Object.keys(imageNames).map(name => [name, {
      reference: manifest.images?.[name]?.reference,
      buildRevision: manifest.images?.[name]?.buildRevision,
      platforms: [...(manifest.images?.[name]?.platforms || [])].sort(),
    }])),
    verification: {
      automated: manifest.verification?.automated,
      human: manifest.verification?.human,
      reportSha256: manifest.verification?.reportSha256,
      humanAcceptanceSha256: manifest.verification?.humanAcceptanceSha256,
    },
  }));
}

export function validateReleaseManifest(manifest) {
  if (!object(manifest) || manifest.schemaVersion !== 1 || manifest.status !== 'owner-approved') throw new Error('Only a recorded, owner-approved exact artifact set can be materialized.');
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit || '') || /^0+$/.test(manifest.sourceCommit)) throw new Error('The full accepted source commit is required.');
  if (manifest.upstreamCommit !== UPSTREAM_COMMIT) throw new Error('The native upstream pin does not match this build definition.');
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(manifest.version || '')) throw new Error('Official version tags use exactly YYYY.MM.DD.');
  const [year, month, day] = manifest.version.split('.').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error('The version must be a valid calendar date.');
  if (!object(manifest.images) || Object.keys(manifest.images).sort().join(',') !== 'studio') throw new Error('Only the complete application image is required.');
  for (const [name, expectedName] of Object.entries(imageNames)) {
    const image = manifest.images[name];
    if (!object(image) || !image.reference?.startsWith(`${expectedName}@sha256:`) || !fullHash(image.reference.slice(`${expectedName}@sha256:`.length))) throw new Error('Images must use the expected GHCR repository and an exact digest.');
    if (image.buildRevision !== manifest.sourceCommit) throw new Error('Image build revisions must match the accepted source commit.');
    if (!Array.isArray(image.platforms) || [...image.platforms].sort().join(',') !== 'linux/amd64,linux/arm64') throw new Error('The accepted image set must include amd64 and arm64.');
  }
  const verification = manifest.verification;
  if (!object(verification) || verification.automated !== 'passed' || verification.human !== 'passed' || !fullHash(verification.reportSha256) || !fullHash(verification.humanAcceptanceSha256)) throw new Error('Automated and human acceptance evidence must identify this artifact set.');
  const approval = manifest.approval;
  if (!object(approval) || approval.actor !== 'TheUncleBen' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(approval.approvedAt || '')) throw new Error('Record the owner and a timezone-qualified approval timestamp.');
  const when = new Date(approval.approvedAt);
  if (!Number.isFinite(when.getTime())) throw new Error('The approval timestamp is invalid.');
  const [stampYear, stampMonth, stampDay] = approval.approvedAt.slice(0, 10).split('-').map(Number);
  const stampCalendar = new Date(Date.UTC(stampYear, stampMonth - 1, stampDay));
  if (stampCalendar.getUTCFullYear() !== stampYear || stampCalendar.getUTCMonth() !== stampMonth - 1 || stampCalendar.getUTCDate() !== stampDay) throw new Error('The approval timestamp contains an invalid calendar date.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(when);
  const values = Object.fromEntries(parts.map(item => [item.type, item.value]));
  if (manifest.version !== `${values.year}.${values.month}.${values.day}`) throw new Error('The official date must match owner approval in America/Chicago.');
  const fingerprint = artifactFingerprint(manifest);
  if (approval.artifactSetSha256 !== fingerprint) throw new Error('Approval does not identify this exact source, image, version and verification set.');
  return { version: manifest.version, artifactSetSha256: fingerprint };
}

export async function materializeRelease(manifest, outputDirectory, sourceRoot = root) {
  const result = validateReleaseManifest(manifest);
  const output = path.resolve(outputDirectory);
  try { await fs.lstat(output); throw new Error('Release output already exists; official artifacts are not overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = await fs.mkdtemp(path.join(path.dirname(output), '.studio-release-'));
  try {
    for (const name of ['portainer-compose.yml', 'portainer-swarm.yml']) {
      let contents = await fs.readFile(path.join(sourceRoot, name), 'utf8');
      for (const [variable, imageName] of [['STUDIO_IMAGE', 'studio']]) {
        const expression = new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`, 'g');
        if ([...contents.matchAll(expression)].length !== 1) throw new Error('The reviewed deployment template has changed; review its image substitution.');
        contents = contents.replace(expression, manifest.images[imageName].reference);
      }
      await fs.writeFile(path.join(temporary, name), contents, { mode: 0o644 });
    }
    await fs.writeFile(path.join(temporary, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
    await fs.writeFile(path.join(temporary, 'portainer.env.example'), '# Set the dashboard address; image digests are already in the release templates.\nSTUDIO_PUBLIC_ORIGIN=http://homepage.example.test:3000\nSTUDIO_PORT=3000\n# Swarm only: exact node hostname holding the named volumes.\nSTUDIO_NODE=<docker-node-hostname>\n# Optional, default 25.\nSTUDIO_BACKUP_RETENTION=25\nSTUDIO_RENDERER_MAX_WORKERS=8\nSTUDIO_RENDERER_IDLE_SECONDS=600\nSTUDIO_RENDERER_STARTUP_SECONDS=30\n', { mode: 0o644 });
    await fs.rename(temporary, output);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, filename, destination] = process.argv.slice(2);
    if (!['validate', 'materialize'].includes(command) || !filename || (command === 'materialize' && !destination)) throw new Error('Usage: node scripts/release-manifest.mjs validate <manifest.json> | materialize <manifest.json> <new-output-directory>');
    const manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
    const result = command === 'validate' ? validateReleaseManifest(manifest) : await materializeRelease(manifest, destination);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
