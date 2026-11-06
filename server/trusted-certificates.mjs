// Trusted certificates (owner decision, 6 Nov 2026): certificate authorities
// an administrator adds so widgets, Test connection and status checks can
// reach services whose certificates come from the owner's own CA (for
// example behind a local reverse proxy). Studio never trusts a certificate
// just because a service presents it.
//
// Two sources, used together:
// - certificates added in Administration → Trusted certificates, kept in the
//   state volume (so backups carry them);
// - a PEM file named by STUDIO_TRUSTED_CERTIFICATES_FILE (for example a
//   Docker secret), read-only in the app.
// Both are written to one bundle the dashboard workers load through Node's
// NODE_EXTRA_CA_CERTS, alongside the usual public authorities. Workers start
// again after a change, because Node reads that file once at start.
import { X509Certificate, createHash } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const TRUSTED_FILE = 'trusted-certificates.json';
export const TRUSTED_BUNDLE = 'trusted-certificates.pem';
export const MAX_TRUSTED = 20;
const MAX_PEM_BYTES = 64 * 1024;
const BLOCK = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+?-----END CERTIFICATE-----/g;

export class TrustError extends Error {
  constructor(message, code = 'INVALID_CERTIFICATE', status = 400) {
    super(message); this.name = 'TrustError'; this.code = code; this.status = status;
  }
}

const field = (dn, key) => (String(dn || '').split('\n').find(line => line.startsWith(`${key}=`)) || '').slice(key.length + 1);

// What the page shows about a certificate; never the PEM itself.
export function describe(pem) {
  const cert = new X509Certificate(pem);
  return {
    fingerprint: cert.fingerprint256,
    name: field(cert.subject, 'CN') || field(cert.subject, 'O') || 'Unnamed certificate',
    issuer: field(cert.issuer, 'CN') || field(cert.issuer, 'O') || '',
    authority: cert.ca === true,
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
  };
}

// The certificates in a pasted or uploaded PEM. Anything else in the text
// (a private key above all) is refused rather than ignored.
export function parsePem(text) {
  if (typeof text !== 'string' || !text.trim()) throw new TrustError('Paste or choose a certificate in PEM format.');
  if (Buffer.byteLength(text, 'utf8') > MAX_PEM_BYTES) throw new TrustError('That file is too large for a certificate.');
  if (/PRIVATE KEY-----/.test(text)) throw new TrustError('That file holds a private key. Studio only needs the certificate: never share the key.', 'PRIVATE_KEY_REFUSED');
  const blocks = text.match(BLOCK) || [];
  if (!blocks.length) throw new TrustError('No certificate found. It should start with -----BEGIN CERTIFICATE-----.');
  return blocks.map((block) => {
    const pem = block.replace(/\r\n/g, '\n');
    try { return { pem: `${pem}\n`, ...describe(pem) }; }
    catch { throw new TrustError('One of those certificates could not be read.'); }
  });
}

export function createTrustedCertificates({ stateRoot, deploymentFile = process.env.STUDIO_TRUSTED_CERTIFICATES_FILE, onChange } = {}) {
  const file = join(stateRoot, TRUSTED_FILE);
  const bundle = join(stateRoot, TRUSTED_BUNDLE);
  let queue = Promise.resolve();
  const serial = (task) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };

  async function readAdded() {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      return Array.isArray(value?.certificates) ? value.certificates.filter(entry => typeof entry?.pem === 'string') : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async function readDeployment() {
    if (!deploymentFile) return { certificates: [] };
    try { return { certificates: parsePem(await fs.readFile(deploymentFile, 'utf8')) }; }
    catch (error) { return { certificates: [], error: error instanceof TrustError ? error.message : 'The file named by STUDIO_TRUSTED_CERTIFICATES_FILE could not be read.' }; }
  }
  const publicEntry = (entry, source) => ({ id: entry.id ?? entry.fingerprint, source, name: entry.name, issuer: entry.issuer, authority: entry.authority, fingerprint: entry.fingerprint, notBefore: entry.notBefore, notAfter: entry.notAfter, ...(entry.addedAt ? { addedAt: entry.addedAt } : {}), ...(entry.addedBy ? { addedBy: entry.addedBy } : {}) });

  async function writeBundle(added, deployment) {
    const pems = [...added, ...deployment.certificates].map(entry => entry.pem);
    if (!pems.length) { await fs.rm(bundle, { force: true }); return false; }
    const temp = `${bundle}.${process.pid}.tmp`;
    await fs.writeFile(temp, pems.join(''), { mode: 0o600 });
    await fs.rename(temp, bundle);
    return true;
  }

  async function list() {
    const [added, deployment] = await Promise.all([readAdded(), readDeployment()]);
    return {
      certificates: [...added.map(entry => publicEntry(entry, 'added')), ...deployment.certificates.map(entry => publicEntry(entry, 'deployment'))],
      ...(deploymentFile ? { deploymentFile: true } : {}),
      ...(deployment.error ? { deploymentError: deployment.error } : {}),
      max: MAX_TRUSTED,
    };
  }

  async function save(added) {
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify({ certificates: added }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
    // onChange runs inside the add or remove task, so it is told whether the
    // bundle has anything in it rather than asking prepare(), which would
    // wait on this same queue for ever.
    const hasBundle = await writeBundle(added, await readDeployment());
    await onChange?.({ hasBundle });
  }

  return {
    bundlePath: bundle,
    list,
    // Writes the bundle from what is stored, at start (the deployment file
    // can change between starts). Returns whether there is anything in it.
    async prepare() {
      return serial(async () => {
        return writeBundle(await readAdded(), await readDeployment());
      });
    },
    // For controller-side code that makes its own TLS connections (for
    // example the monitoring workstream): the public authorities plus every
    // trusted certificate, as Node's `ca` option, e.g. new https.Agent(await
    // trusted.caOptions()).
    async caOptions() {
      const [added, deployment] = await Promise.all([readAdded(), readDeployment()]);
      return { ca: [...rootCertificates, ...added.map(entry => entry.pem), ...deployment.certificates.map(entry => entry.pem)] };
    },
    async add(text, by) {
      return serial(async () => {
        const parsed = parsePem(text);
        const added = await readAdded();
        const known = new Set(added.map(entry => entry.fingerprint));
        const fresh = parsed.filter(entry => !known.has(entry.fingerprint) && known.add(entry.fingerprint));
        if (!fresh.length) throw new TrustError('That certificate is already trusted.', 'CERTIFICATE_EXISTS');
        if (added.length + fresh.length > MAX_TRUSTED) throw new TrustError(`Studio keeps at most ${MAX_TRUSTED} trusted certificates.`, 'TOO_MANY_CERTIFICATES');
        const addedAt = new Date().toISOString();
        const next = [...added, ...fresh.map(entry => ({ ...entry, id: createHash('sha256').update(entry.pem).digest('hex').slice(0, 16), addedAt, ...(by ? { addedBy: String(by).slice(0, 120) } : {}) }))];
        await save(next);
        return list();
      });
    },
    async remove(id) {
      return serial(async () => {
        const added = await readAdded();
        const next = added.filter(entry => entry.id !== id);
        if (next.length === added.length) throw new TrustError('That certificate is no longer trusted.', 'CERTIFICATE_NOT_FOUND', 404);
        await save(next);
        return list();
      });
    },
  };
}
