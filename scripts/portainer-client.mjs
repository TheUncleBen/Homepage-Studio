// Disposable qualification client, not part of either production image.
// Contract: Portainer CE 2.45.2, source 6981dc67c177ab64d12bd74e1ccc02abf19bb057.
// https://github.com/portainer/portainer/blob/2.45.2/api/docs/swagger.yaml
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const PORTAINER_VERSION = '2.45.2';
export const PORTAINER_IMAGE = 'portainer/portainer-ce:2.45.2@sha256:03f94a406496dc84d37b552795fc424ccad8d0d7200353b6a82915f6e8f73ab0';
export const REGISTRY_IMAGE = 'registry:3.1.2@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8';

export async function readSwarmClusterId(docker) {
  // Docker has no `swarm inspect` command. The manager's system-info response
  // exposes the cluster ID separately from the current node ID.
  const swarm = JSON.parse(await docker(['info', '--format', '{{json .Swarm}}']));
  assert.equal(swarm?.LocalNodeState, 'active', 'The disposable node must belong to an active Swarm');
  assert.equal(swarm.ControlAvailable, true, 'The disposable node must be a Swarm manager');
  assert.equal(typeof swarm.Cluster?.ID, 'string', 'Docker info must provide the Swarm cluster ID');
  assert.ok(swarm.Cluster.ID.trim(), 'Docker info must provide a nonempty Swarm cluster ID');
  return swarm.Cluster.ID;
}

export async function inspectFixtureManifest({ repository, expectedConfig, architecture }, { fetchImpl = fetch } = {}) {
  assert.match(repository, /^studio-(writer|renderer)(-replacement)?$/);
  assert.ok(['amd64', 'arm64'].includes(architecture));
  const origin = 'http://127.0.0.1:15000';
  const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
  const read = async reference => {
    const response = await fetchImpl(`${origin}/v2/${repository}/manifests/${reference}`, { headers: { accept }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    assert.equal(response.status, 200, 'The loopback fixture registry must return the pushed manifest');
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(response.headers.get('docker-content-digest'), digest, 'Registry manifest bytes must match their advertised digest');
    if (reference.startsWith('sha256:')) assert.equal(digest, reference);
    return { digest, manifest: JSON.parse(bytes) };
  };
  const root = await read('source');
  let image = root.manifest;
  if (image.manifests) {
    const selected = image.manifests.filter(item => item.platform?.os === 'linux' && item.platform?.architecture === architecture);
    assert.equal(selected.length, 1, 'The fixture index must identify exactly one current-platform image');
    image = (await read(selected[0].digest)).manifest;
  }
  assert.equal(image.config?.digest, expectedConfig, 'A fixture registry transfer must preserve the already-built image config identity');
  return { reference: `127.0.0.1:15000/${repository}@${root.digest}`, manifestDigest: root.digest, configDigest: image.config.digest };
}

export function stackPayload({ name, template, environment, swarmId }) {
  assert.match(name, /^[a-z][a-z0-9-]+$/, 'Use a disposable lowercase stack name');
  assert.equal(typeof template, 'string');
  assert.ok(template.trim(), 'The exact deployment template is required');
  const keys = ['STUDIO_IMAGE', 'HOMEPAGE_IMAGE', 'STUDIO_PUBLIC_ORIGIN', 'STUDIO_PORT', 'STUDIO_BACKUP_RETENTION'];
  if (swarmId !== undefined) {
    assert.equal(typeof swarmId, 'string');
    assert.ok(swarmId, 'An explicit Swarm ID is required');
    keys.push('STUDIO_NODE');
  }
  const Env = keys.map(key => {
    assert.equal(typeof environment[key], 'string', `Provide ${key} explicitly`);
    assert.ok(environment[key].trim(), `Provide ${key} explicitly`);
    return { name: key, value: environment[key] };
  });
  return { Name: name, StackFileContent: template, Env, ...(swarmId === undefined ? {} : { SwarmID: swarmId }) };
}

export class PortainerClient {
  #token;
  #secrets = [];

  constructor(origin, { fetchImpl = fetch, sleep = delay, now = Date.now } = {}) {
    const url = new URL(origin);
    assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
      'Qualification may use only an explicit loopback Portainer origin');
    this.origin = url.origin;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.now = now;
  }

  redact(value) {
    let text = String(value);
    for (const secret of this.#secrets) text = text.split(secret).join('[redacted]');
    return text;
  }

  async request(method, route, { json, form, timeout = 30000 } = {}) {
    assert.ok(route.startsWith('/') && !route.startsWith('//'), 'Use a Portainer API route');
    const headers = { origin: this.origin };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;
    if (json !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await this.fetch(`${this.origin}/api${route}`, {
        method, headers, body: json === undefined ? form : JSON.stringify(json),
        signal: AbortSignal.timeout(timeout), redirect: 'error',
      });
    } catch {
      // Never attach the request, credentials, token or untrusted response to an error.
      throw new Error(`Portainer ${method} ${route.split('?')[0]} request failed`);
    }
    if (!response.ok) throw new Error(`Portainer ${method} ${route.split('?')[0]}: HTTP ${response.status}`);
    if (response.status === 204) return undefined;
    try { return await response.json(); }
    catch { throw new Error(`Portainer ${method} ${route.split('?')[0]} returned invalid JSON`); }
  }

  async initialize() {
    const status = await this.request('GET', '/system/status');
    assert.equal(status.Version, PORTAINER_VERSION, 'The running Portainer version must match its pinned contract');
    const credentials = { Username: 'studio-qualification', Password: randomBytes(32).toString('hex') };
    this.#secrets.push(credentials.Password);
    await this.request('POST', '/users/admin/init', { json: credentials });
    const auth = await this.request('POST', '/auth', { json: credentials });
    assert.ok(typeof auth.jwt === 'string' && auth.jwt.length > 20, 'Portainer must return a usable JWT');
    this.#token = auth.jwt;
    this.#secrets.push(auth.jwt);
    const form = new FormData();
    form.set('Name', 'Disposable local Docker');
    form.set('EndpointCreationType', '1');
    form.set('ContainerEngine', 'docker');
    // The documented omitted URL selects the socket mounted only in the test container.
    const endpoint = await this.request('POST', '/endpoints', { form });
    assert.ok(Number.isInteger(endpoint.Id) && endpoint.Id > 0);
    return endpoint.Id;
  }

  async createStack(endpointId, payload) {
    const kind = payload.SwarmID === undefined ? 'standalone' : 'swarm';
    const stack = await this.request('POST', `/stacks/create/${kind}/string?endpointId=${endpointId}`, { json: payload });
    assert.ok(Number.isInteger(stack.Id) && stack.Id > 0, 'Portainer must return a stack identity');
    assert.equal(stack.Name, payload.Name);
    assert.equal(stack.EndpointId, endpointId);
    assert.equal(stack.Type, kind === 'swarm' ? 1 : 2);
    return stack.Id; // Creation is asynchronous; the caller must await waitForStack.
  }

  async waitForStack(id, { timeout = 180000, interval = 1000 } = {}) {
    const deadline = this.now() + timeout;
    while (this.now() < deadline) {
      const stack = await this.request('GET', `/stacks/${id}`);
      assert.equal(stack.Id, id);
      if (stack.Status === 1) return stack;
      if (stack.Status === 4) {
        const messages = (stack.DeploymentStatus || []).filter(item => item.Status === 4).map(item => item.Message).filter(Boolean).join('; ');
        throw new Error(`Portainer stack ${id} deployment failed: ${this.redact(messages).slice(-3000)}`);
      }
      assert.equal(stack.Status, 3, `Portainer stack ${id} entered an unexpected non-deploying state`);
      await this.sleep(interval);
    }
    throw new Error(`Portainer stack ${id} deployment exceeded ${timeout}ms`);
  }

  async verifyStoredStack(id, endpointId, payload) {
    const stack = await this.waitForStack(id);
    assert.equal(stack.Name, payload.Name);
    assert.equal(stack.EndpointId, endpointId);
    assert.equal(stack.Type, payload.SwarmID === undefined ? 2 : 1);
    if (payload.SwarmID !== undefined) assert.equal(stack.SwarmId, payload.SwarmID);
    assert.deepEqual(stack.Env, payload.Env, 'Portainer must persist all explicit deployment values');
    const file = await this.request('GET', `/stacks/${id}/file`);
    assert.equal(file.StackFileContent, payload.StackFileContent, 'Portainer must store the provided template unchanged');
    return stack;
  }

  async updateStack(id, endpointId, payload, { repull = false } = {}) {
    assert.equal(typeof repull, 'boolean');
    await this.request('PUT', `/stacks/${id}?endpointId=${endpointId}`, {
      json: { StackFileContent: payload.StackFileContent, Env: payload.Env, Prune: true, RepullImageAndRedeploy: repull },
    });
    return this.verifyStoredStack(id, endpointId, payload);
  }

  async deleteStack(id, endpointId) {
    await this.request('DELETE', `/stacks/${id}?endpointId=${endpointId}`, { timeout: 120000 });
  }
}

export async function cleanupPortainerStack(stack, { portainer, endpointId, docker, eventually }) {
  const selector = `${stack.swarm ? 'com.docker.stack.namespace' : 'com.docker.compose.project'}=${stack.name}`;
  const failures = [];
  const attempt = async operation => { try { return await operation(); } catch (error) { failures.push(error); return undefined; } };
  const fallback = () => stack.swarm ? docker(['stack', 'rm', stack.name]) : docker(['compose', '--project-name', stack.name, '--file', 'portainer-compose.yml', 'down', '--remove-orphans']);
  await attempt(async () => {
    if (stack.id === undefined) return fallback();
    try { await portainer.deleteStack(stack.id, endpointId); }
    catch (error) { await attempt(fallback); throw error; }
  });
  await attempt(() => eventually(async () => {
    assert.equal(await docker(['ps', '--all', '--quiet', '--filter', `label=${selector}`]), '');
    assert.equal(await docker(['network', 'ls', '--quiet', '--filter', `label=${selector}`]), '');
  }, `Portainer ${stack.name} task and network removal`, 60000));
  const listed = await attempt(() => docker(['volume', 'ls', '--quiet']));
  const volumes = listed === undefined ? undefined : new Set(listed.split('\n'));
  for (const suffix of ['config', 'state']) {
    const name = `${stack.name}_${suffix}`;
    if (!volumes || volumes.has(name)) await attempt(() => docker(['volume', 'rm', name]));
  }
  await attempt(async () => {
    const remaining = new Set((await docker(['volume', 'ls', '--quiet'])).split('\n'));
    assert.ok(!remaining.has(`${stack.name}_config`) && !remaining.has(`${stack.name}_state`));
    assert.equal(await docker(['ps', '--all', '--quiet', '--filter', `label=${selector}`]), '');
    assert.equal(await docker(['network', 'ls', '--quiet', '--filter', `label=${selector}`]), '');
    stack.removed = true;
  });
  if (failures.length) throw new AggregateError(failures, `Portainer stack ${stack.name} cleanup failed: ${failures.map(error => error.message).join('; ')}`);
}

