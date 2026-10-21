// Anonymous readback is intentional: official assets must be pullable without credentials.
import { IMAGE_REPOSITORIES, STAGING_REPOSITORIES } from './candidate-manifest.mjs';
import { boundedResponse } from './release-guard.mjs';

const mediaTypes = [
  'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json',
];

export function publicRegistry(imageName, fetcher = fetch) {
  if (!Object.hasOwn(IMAGE_REPOSITORIES, imageName)) throw new Error('Unknown registry image.');
  return registryReader(IMAGE_REPOSITORIES[imageName], { fetcher });
}

export function registryReader(imageRepository, { fetcher = fetch, credential } = {}) {
  if (![...Object.values(IMAGE_REPOSITORIES), ...Object.values(STAGING_REPOSITORIES)].includes(imageRepository)) throw new Error('Unknown registry repository.');
  const repository = imageRepository.slice('ghcr.io/'.length);
  let token;
  return async function read(kind, reference, { absent = false } = {}) {
    if (!['manifests', 'blobs'].includes(kind) || !/^(?:sha256:[a-f0-9]{64}|\d{4}\.\d{2}\.\d{2}|build-[a-f0-9]{40}-[1-9][0-9]*(?:-(?:amd64|arm64|index))?)$/.test(reference)) throw new Error('Only immutable digests or exact official/build identities may be read.');
    const url = `https://ghcr.io/v2/${repository}/${kind}/${reference}`;
    const get = () => fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { accept: mediaTypes.join(', '), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    let response = await get();
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate') || '';
      if (!/^Bearer\s/i.test(challenge) || !challenge.includes('realm="https://ghcr.io/token"') || !challenge.includes('service="ghcr.io"') || !challenge.includes(`scope="repository:${repository}:pull"`)) throw new Error('Unexpected GHCR authentication challenge.');
      const tokenUrl = new URL('https://ghcr.io/token');
      tokenUrl.search = new URLSearchParams({ service: 'ghcr.io', scope: `repository:${repository}:pull` }).toString();
      const granted = await fetcher(tokenUrl.href, { redirect: 'error', signal: AbortSignal.timeout(20000), ...(credential ? { headers: { authorization: `Basic ${Buffer.from(`TheUncleBen:${credential}`).toString('base64')}` } } : {}) });
      if (!granted.ok) throw new Error('The candidate is not readable from GHCR through the requested access path; verify the explicitly chosen package permissions.');
      const payload = JSON.parse((await boundedResponse(granted)).toString('utf8'));
      token = payload.token || payload.access_token;
      if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('GHCR did not provide a valid anonymous pull token.');
      response = await get();
    }
    if (absent && response.status === 404) return null;
    // Blob delivery may use GitHub's storage CDN. Never forward the pull token.
    if (kind === 'blobs' && [302, 307].includes(response.status)) {
      const target = new URL(response.headers.get('location') || '');
      if (target.protocol !== 'https:' || target.username || target.password || !/(?:^|\.)(?:githubusercontent\.com|blob\.core\.windows\.net)$/.test(target.hostname)) throw new Error('Unexpected registry blob redirect.');
      response = await fetcher(target.href, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    }
    if (!response.ok) throw new Error(`GHCR readback failed (${response.status}); registry errors are not evidence that a tag is absent.`);
    return boundedResponse(response);
  };
}
