import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { resolveEnvironmentVariables } from '../homepage/src/utils/config/environment.mjs';
import { loadYaml } from '../homepage/src/utils/config/yaml-parser.mjs';

const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
function readEnvironmentFile(file) {
  // Operator-provided secret paths may use symbolic links (for example mounted
  // Kubernetes secrets). Follow native semantics, but never block on a pipe or
  // read an unbounded special file while calculating the public crawl policy.
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) throw new Error('Invalid settings reference');
    const bytes = Buffer.alloc(MAX_SETTINGS_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_SETTINGS_BYTES) throw new Error('Oversized settings reference');
    return bytes.subarray(0, length).toString('utf8');
  } finally { closeSync(descriptor); }
}

export function readNativeIndexingPolicy(text, environment = process.env) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_SETTINGS_BYTES) throw new Error('Invalid settings');
  const resolved = resolveEnvironmentVariables(text, Object.entries(environment), readEnvironmentFile, { maxBytes: MAX_SETTINGS_BYTES });
  if (Buffer.byteLength(resolved) > MAX_SETTINGS_BYTES) throw new Error('Oversized resolved settings');
  const settings = loadYaml(resolved) ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid settings mapping');
  return { disableIndexing: !!settings.disableIndexing };
}

const boundaryRules = (directive, slug) => [`${directive}: /${slug}$`, `${directive}: /${slug}/`, `${directive}: /${slug}?`];
export async function renderRobotsPolicy(manifest, readPolicy) {
  const entries = await Promise.all(manifest.dashboards.map(async dashboard => {
    if (dashboard.archived) return { dashboard, disabled: true };
    try { return { dashboard, disabled: !!(await readPolicy(dashboard)).disableIndexing }; }
    catch { return { dashboard, disabled: true }; }
  }));
  // The bare address is no dashboard: it leads each person to theirs.
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /studio/'];
  for (const { dashboard, disabled } of entries) {
    // Archived dashboards answer 404 at their slug, so listing them would only
    // disclose retired (possibly private) names to anyone reading robots.txt.
    // A main dashboard without an address yet isn't served anywhere.
    if (!dashboard.slug || dashboard.archived) continue;
    if (disabled) lines.push(...boundaryRules('Disallow', dashboard.slug));
    lines.push(`Disallow: /${dashboard.slug}/studio/`);
  }
  return lines.join('\n') + '\n';
}
