// Anonymous readback is intentional: official assets must be pullable without credentials.
import { createHash } from 'node:crypto';
import { IMAGE_REPOSITORIES } from './candidate-manifest.mjs';
import { boundedResponse } from './release-guard.mjs';

const mediaTypes = [
  'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json',
];

export class RegistryAccessError extends Error {
  constructor(status, anonymous) {
    super(`GHCR ${anonymous ? 'anonymous' : 'authenticated'} access denied (${status}).`);
    this.name = 'RegistryAccessError';
    this.status = status;
    this.anonymous = anonymous;
  }
}

export function publicRegistry(imageName, fetcher = fetch) {
  if (!Object.hasOwn(IMAGE_REPOSITORIES, imageName)) throw new Error('Unknown registry image.');
  return registryReader(IMAGE_REPOSITORIES[imageName], { fetcher });
}

export function registryReader(imageRepository, { fetcher = fetch, credential } = {}) {
  if (!Object.values(IMAGE_REPOSITORIES).includes(imageRepository)) throw new Error('Unknown registry repository.');
  const repository = imageRepository.slice('ghcr.io/'.length);
  let token;
  async function responseFor(kind, reference, { absent = false, timeout = 20000 } = {}) {
    if (!['manifests', 'blobs'].includes(kind) || !/^(?:sha256:[a-f0-9]{64}|\d{4}\.\d{2}\.\d{2}|build-[a-f0-9]{40}-[1-9][0-9]*(?:-(?:amd64|arm64|index))?)$/.test(reference)) throw new Error('Only immutable digests or exact official/build identities may be read.');
    const url = `https://ghcr.io/v2/${repository}/${kind}/${reference}`;
    const get = () => fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { accept: mediaTypes.join(', '), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    let response = await get();
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate') || '';
      if (!/^Bearer\s/i.test(challenge) || !challenge.includes('realm="https://ghcr.io/token"') || !challenge.includes('service="ghcr.io"') || !challenge.includes(`scope="repository:${repository}:pull"`)) throw new Error('Unexpected GHCR authentication challenge.');
      const tokenUrl = new URL('https://ghcr.io/token');
      tokenUrl.search = new URLSearchParams({ service: 'ghcr.io', scope: `repository:${repository}:pull` }).toString();
      const granted = await fetcher(tokenUrl.href, { redirect: 'error', signal: AbortSignal.timeout(20000), ...(credential ? { headers: { authorization: `Basic ${Buffer.from(`TheUncleBen:${credential}`).toString('base64')}` } } : {}) });
      if ([401, 403].includes(granted.status)) throw new RegistryAccessError(granted.status, !credential);
      if (!granted.ok) throw new Error(`GHCR pull-token request failed (${granted.status}); package visibility was not determined.`);
      const payload = JSON.parse((await boundedResponse(granted)).toString('utf8'));
      token = payload.token || payload.access_token;
      if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('GHCR did not provide a valid anonymous pull token.');
      response = await get();
    }
    if (absent && response.status === 404) return null;
    // Blob delivery may use GitHub's storage CDN. Never forward the pull token.
    let redirected = false;
    if (kind === 'blobs' && [302, 307].includes(response.status)) {
      const target = new URL(response.headers.get('location') || '');
      if (target.protocol !== 'https:' || target.username || target.password || !/(?:^|\.)(?:githubusercontent\.com|blob\.core\.windows\.net)$/.test(target.hostname)) throw new Error('Unexpected registry blob redirect.');
      redirected = true;
      response = await fetcher(target.href, { redirect: 'error', signal: AbortSignal.timeout(timeout) });
    }
    if (!redirected && [401, 403].includes(response.status)) throw new RegistryAccessError(response.status, !credential);
    if (!response.ok) throw new Error(`GHCR readback failed (${response.status}); registry errors are not evidence that a tag is absent.`);
    return response;
  }

  async function read(kind, reference, options) {
    const response = await responseFor(kind, reference, options);
    return response === null ? null : boundedResponse(response);
  }

  // Layer bytes can be much larger than metadata. Verify them as a stream,
  // bounded by the manifest descriptor, without Docker's local layer cache.
  read.verifyBlob = async function verifyBlob(reference, expectedSize) {
    if (!/^sha256:[a-f0-9]{64}$/.test(reference) || !Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new Error('Layer verification requires an exact SHA-256 digest and a bounded descriptor size.');
    const response = await responseFor('blobs', reference, { timeout: 180000 });
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) !== expectedSize)) {
      await response.body?.cancel();
      throw new Error('Registry layer Content-Length differs from its manifest descriptor.');
    }
    const hash = createHash('sha256');
    let size = 0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > expectedSize) throw new Error('Registry layer exceeds its manifest descriptor size.');
      hash.update(chunk);
    }
    if (size !== expectedSize || `sha256:${hash.digest('hex')}` !== reference) throw new Error('Registry layer bytes differ from their manifest digest or size.');
    return { digest: reference, size };
  };
  return read;
}
