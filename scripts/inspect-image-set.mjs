#!/usr/bin/env node
// Inspect exact OCI/Docker manifest bytes. This neither runs images nor publishes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';
import { IMAGE_REPOSITORIES, PLATFORMS, sha256, isCommit, isHash } from './candidate-manifest.mjs';

const indexes = new Set(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json']);
const manifests = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json']);
const configs = new Set(['application/vnd.oci.image.config.v1+json', 'application/vnd.docker.container.image.v1+json']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validDigest = value => typeof value === 'string' && value.startsWith('sha256:') && isHash(value.slice(7));
const parse = bytes => {
  if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024) throw new Error('Image metadata must be bounded raw bytes.');
  return JSON.parse(bytes.toString('utf8'));
};

async function readDescriptor(descriptor, readBlob) {
  if (!object(descriptor) || !validDigest(descriptor.digest) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 4 * 1024 * 1024) throw new Error('Invalid image metadata descriptor.');
  const bytes = await readBlob(descriptor.digest);
  if (!Buffer.isBuffer(bytes) || bytes.length !== descriptor.size || `sha256:${sha256(bytes)}` !== descriptor.digest) throw new Error('Image metadata bytes do not match their immutable descriptor.');
  return parse(bytes);
}

async function inspectRuntime(child, readBlob, { imageName, sourceCommit, platform }) {
  if (!Object.hasOwn(IMAGE_REPOSITORIES, imageName) || !isCommit(sourceCommit) || !PLATFORMS.includes(platform)) throw new Error('Unknown runtime image, source or platform.');
  if (!object(child) || child.schemaVersion !== 2 || !manifests.has(child.mediaType) || !object(child.config) || !Array.isArray(child.layers) || !configs.has(child.config.mediaType)) throw new Error('Invalid architecture manifest or image configuration media type.');
  const config = await readDescriptor(child.config, readBlob);
  const [os, architecture] = platform.split('/');
  if (!object(config) || config.os !== os || config.architecture !== architecture || !object(config.config)) throw new Error('Image configuration and platform descriptor disagree.');
  const labels = config.config.Labels;
  if (!object(labels) || labels['org.opencontainers.image.source'] !== 'https://github.com/TheUncleBen/Homepage-Studio' || labels['org.opencontainers.image.revision'] !== sourceCommit || labels['org.opencontainers.image.licenses'] !== 'AGPL-3.0-or-later') throw new Error('Image source, revision or license labels do not match the accepted build.');
  if (!Array.isArray(config.config.Env) || config.config.Env.filter(value => typeof value === 'string' && value.startsWith('STUDIO_BUILD_REVISION=')).join() !== `STUDIO_BUILD_REVISION=${sourceCommit}`) throw new Error('Runtime build identity does not match the accepted source.');
  if (labels['io.homepage-studio.upstream'] !== UPSTREAM_COMMIT) throw new Error('Native renderer upstream label differs from the reviewed pin.');
  if (child.layers.some(layer => !object(layer) || !validDigest(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0)) throw new Error('Invalid image layer descriptor.');
  return child.config.digest;
}

export async function inspectArchitectureManifest(bytes, readBlob, options) {
  const child = parse(bytes);
  return { digest: `sha256:${sha256(bytes)}`, configDigest: await inspectRuntime(child, readBlob, options) };
}

export async function inspectImageIndex(indexBytes, readBlob, { imageName, sourceCommit }) {
  if (!Object.hasOwn(IMAGE_REPOSITORIES, imageName) || !isCommit(sourceCommit)) throw new Error('Inspect a known image and an exact source commit.');
  const index = parse(indexBytes);
  if (!object(index) || index.schemaVersion !== 2 || !indexes.has(index.mediaType) || !Array.isArray(index.manifests) || index.manifests.length < 2 || index.manifests.length > 32) throw new Error('An application image requires complete multiarchitecture image indexes.');
  const found = {};
  const auxiliary = [];
  for (const descriptor of index.manifests) {
    if (!object(descriptor) || !object(descriptor.platform) || !manifests.has(descriptor.mediaType)) throw new Error('Unexpected image-index child.');
    const platform = `${descriptor.platform.os}/${descriptor.platform.architecture}`;
    const child = await readDescriptor(descriptor, readBlob);
    if (!object(child) || child.schemaVersion !== 2 || child.mediaType !== descriptor.mediaType || !object(child.config) || !Array.isArray(child.layers)) throw new Error('Invalid architecture manifest.');
    if (platform === 'unknown/unknown' && descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
      auxiliary.push(descriptor);
      continue;
    }
    if (!PLATFORMS.includes(platform) || Object.hasOwn(found, platform) || (descriptor.platform.variant && !(platform === 'linux/arm64' && descriptor.platform.variant === 'v8'))) throw new Error('Each advertised architecture must occur exactly once; unexpected runtime targets are rejected.');
    found[platform] = { digest: descriptor.digest, configDigest: await inspectRuntime(child, readBlob, { imageName, sourceCommit, platform }) };
  }
  if (Object.keys(found).sort().join(',') !== PLATFORMS.join(',')) throw new Error('The index is missing a required architecture.');
  for (const descriptor of auxiliary) if (!Object.values(found).some(value => value.digest === descriptor.annotations['vnd.docker.reference.digest'])) throw new Error('Attestation does not identify a runtime manifest in this index.');
  return {
    reference: `${IMAGE_REPOSITORIES[imageName]}@sha256:${sha256(indexBytes)}`,
    buildRevision: sourceCommit,
    platforms: [...PLATFORMS],
    manifests: Object.fromEntries(PLATFORMS.map(platform => [platform, found[platform]])),
  };
}

export async function inspectImageDirectory(indexFile, blobDirectory, options) {
  const readFile = async filename => {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Image metadata must be a bounded regular file, not a link.');
    return fs.readFile(filename);
  };
  return inspectImageIndex(await readFile(indexFile), value => {
    // readDescriptor validates the digest before this path is constructed.
    return readFile(path.join(blobDirectory, value.slice(7)));
  }, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [indexFile, blobDirectory, imageName, sourceCommit, ...extra] = process.argv.slice(2);
    if (!sourceCommit || extra.length) throw new Error('Usage: node scripts/inspect-image-set.mjs <raw-index.json> <sha256-blob-directory> <studio> <build-commit>');
    console.log(JSON.stringify(await inspectImageDirectory(indexFile, blobDirectory, { imageName, sourceCommit }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
