// Status checks fetch a missing intermediate certificate the same way the
// dashboards do (owner decision, 10 Nov 2026), and only ever trust it when
// it chains to a certificate the deployment already trusts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHttp, runTls } from './checks.mjs';
import { forgetIntermediates } from '../../homepage/src/utils/proxy/aia.mjs';

const dir = mkdtempSync(join(tmpdir(), 'studio-aia-checks-'));
const ssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
const read = name => readFileSync(join(dir, name), 'utf8');
const CA = 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n';

let issuers, base;
const servers = [];
const ports = {};

test.before(async () => {
  issuers = http.createServer((req, res) => {
    const file = { '/int.der': 'int.der', '/rogueint.der': 'rogueint.der' }[req.url];
    if (!file) { res.statusCode = 404; res.end(); return; }
    res.end(readFileSync(join(dir, file)));
  });
  await new Promise(resolve => issuers.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${issuers.address().port}`;
  for (const [root, int, srv, cn] of [['root', 'int', 'srv', 'Check'], ['rogue', 'rogueint', 'roguesrv', 'Rogue']]) {
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', `${root}.key`, '-out', `${root}.pem`, '-subj', `/CN=${cn} Root`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${int}.key`, '-out', `${int}.csr`, '-subj', `/CN=${cn} Intermediate`);
    writeFileSync(join(dir, `${int}.ext`), CA);
    ssl('x509', '-req', '-in', `${int}.csr`, '-CA', `${root}.pem`, '-CAkey', `${root}.key`, '-CAcreateserial', '-days', '2', '-out', `${int}.pem`, '-extfile', `${int}.ext`);
    ssl('x509', '-in', `${int}.pem`, '-outform', 'DER', '-out', `${int}.der`);
    ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${srv}.key`, '-out', `${srv}.csr`, '-subj', '/CN=localhost');
    writeFileSync(join(dir, `${srv}.ext`), `subjectAltName=DNS:localhost,IP:127.0.0.1\nauthorityInfoAccess=caIssuers;URI:${base}/${int}.der\n`);
    ssl('x509', '-req', '-in', `${srv}.csr`, '-CA', `${int}.pem`, '-CAkey', `${int}.key`, '-CAcreateserial', '-days', '2', '-out', `${srv}.pem`, '-extfile', `${srv}.ext`);
    const server = https.createServer({ key: read(`${srv}.key`), cert: read(`${srv}.pem`) }, (req, res) => res.end('ok'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    ports[srv] = server.address().port;
    servers.push(server);
  }
});
test.after(() => { servers.forEach(server => server.close()); issuers.close(); });
test.beforeEach(() => forgetIntermediates());

const trusted = () => [...rootCertificates, read('root.pem')];

test('an http check reaches a server that leaves out its intermediate when the root is trusted', async () => {
  const result = await runHttp({ url: `https://127.0.0.1:${ports.srv}/` }, { timeoutMs: 5000, ca: trusted() });
  assert.equal(result.ok, true, result.message);
});

test('an http check still fails for a server whose authority is not trusted', async () => {
  const result = await runHttp({ url: `https://127.0.0.1:${ports.roguesrv}/` }, { timeoutMs: 5000, ca: trusted() });
  assert.equal(result.ok, false);
  assert.equal(result.cls, 'tls-untrusted');
});

test('a certificate check completes the chain the same way, and refuses the rogue one', async () => {
  const good = await runTls({ host: '127.0.0.1', port: ports.srv }, { timeoutMs: 5000, ca: trusted() });
  assert.equal(good.ok, true, good.message);
  assert.equal('authorizationError' in good, false);
  const bad = await runTls({ host: '127.0.0.1', port: ports.roguesrv }, { timeoutMs: 5000, ca: trusted() });
  assert.equal(bad.ok, false);
  assert.equal('authorizationError' in bad, false);
});
