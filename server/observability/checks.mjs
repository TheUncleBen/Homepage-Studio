// Check runners (plan 5.2). Node built-ins only. Every check has a hard
// deadline; sockets and child processes are destroyed when it passes.
// A result is { ok, ms, code?, cls?, message?, certExpires?, warning? }.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Resolver } from 'node:dns/promises';
import { lookup } from 'node:dns';
import { spawn } from 'node:child_process';
import { classifyError, CLASS_SENTENCES } from '../../homepage/src/utils/studio/error-classes.mjs';

const MAX_BODY = 64 * 1024;
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const round = ms => Math.round(ms * 10) / 10;

export function failure(error, extra = {}) {
  const cls = extra.cls ?? classifyError({ code: error?.code, message: error?.message }) ?? 'internal';
  return { ok: false, cls, message: extra.message ?? CLASS_SENTENCES[cls], ...extra };
}

// "200-399,404" → test function.
export function acceptsStatus(spec) {
  const ranges = String(spec || '200-399').split(',').map(part => part.split('-').map(Number));
  return code => ranges.some(([low, high]) => (high ? code >= low && code <= high : code === low));
}

// A dotted path into JSON: "data.items.0.status".
export function jsonValue(value, path) {
  let current = value;
  for (const key of String(path).split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function familyOption(family) { return family === '4' ? 4 : family === '6' ? 6 : 0; }

function request(url, { method, headers, body, timeoutMs, agentOptions, family, signal }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const started = now();
    let firstByte = null;
    const options = {
      method, headers: { 'user-agent': 'HomepageStudio-Monitor', accept: '*/*', ...headers },
      timeout: timeoutMs, family: familyOption(family), signal,
      ...(target.protocol === 'https:' ? { ...agentOptions, servername: net.isIP(target.hostname) ? undefined : target.hostname, agent: false } : { agent: false }),
    };
    const req = transport.request(target, options, res => {
      firstByte = now();
      let size = 0;
      const chunks = [];
      const cert = res.socket?.getPeerCertificate?.();
      res.on('data', chunk => {
        if (size >= MAX_BODY) return;
        size += chunk.length;
        chunks.push(chunk);
        if (size >= MAX_BODY) res.destroy();
      });
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).subarray(0, MAX_BODY).toString('utf8'), ms: firstByte - started, total: now() - started, cert, authorized: res.socket?.authorized, authorizationError: res.socket?.authorizationError });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', () => finish());
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body || undefined);
  });
}

function certExpiry(cert) {
  const t = cert && cert.valid_to ? Date.parse(cert.valid_to) : NaN;
  return Number.isFinite(t) ? t : null;
}

// HTTP(S). With card: true it follows a Studio card's own rule (plan 5.9):
// HEAD, then GET when the answer is above 403; up at 403 or below;
// certificate problems are a warning, not down, unless they stop the request.
export async function runHttp(config, { timeoutMs, ca, family = 'auto' } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const verify = config.card ? false : config.verifyTls !== false;
  const agentOptions = { rejectUnauthorized: verify, ...(ca ? { ca } : {}) };
  const headers = Object.fromEntries((config.headers ?? []).map(header => [header.name, header.value]));
  const accept = config.card ? code => code <= 403 : acceptsStatus(config.accept);
  let url = config.url, method = config.card ? 'HEAD' : config.method ?? 'GET';
  try {
    let answer;
    for (let hop = 0; ; hop++) {
      answer = await request(url, { method, headers, body: method === 'POST' ? config.body : undefined, timeoutMs, agentOptions, family, signal: deadline });
      if (config.card && method === 'HEAD' && answer.status > 403) { method = 'GET'; continue; }
      const location = answer.headers.location;
      if ((config.followRedirects !== false || config.card) && answer.status >= 300 && answer.status < 400 && location && hop < 5) {
        url = new URL(location, url).href;
        if (method === 'POST') method = 'GET';
        continue;
      }
      break;
    }
    const result = { ms: round(answer.total), code: answer.status, certExpires: url.startsWith('https:') ? certExpiry(answer.cert) : null };
    if (!verify && url.startsWith('https:') && answer.authorized === false && answer.authorizationError) {
      const cls = classifyError({ code: String(answer.authorizationError) });
      result.warning = { cls, message: CLASS_SENTENCES[cls] ?? 'The certificate isn\'t trusted' };
    }
    if (!accept(answer.status)) {
      const cls = classifyError({ status: answer.status }) ?? 'http-status';
      return { ...result, ok: false, cls, message: `HTTP ${answer.status} · ${CLASS_SENTENCES[cls]}` };
    }
    if (config.keyword) {
      const found = answer.body.includes(config.keyword);
      if (found === Boolean(config.keywordAbsent)) return { ...result, ok: false, cls: 'assertion', message: config.keywordAbsent ? `Found “${config.keyword}”` : `“${config.keyword}” not found` };
    }
    if (config.jsonPath) {
      let parsed;
      try { parsed = JSON.parse(answer.body); } catch { return { ...result, ok: false, cls: 'bad-response', message: 'The answer isn\'t JSON' }; }
      const value = jsonValue(parsed, config.jsonPath);
      if (config.jsonExpect !== undefined && config.jsonExpect !== '' && String(value) !== config.jsonExpect) return { ...result, ok: false, cls: 'assertion', message: `${config.jsonPath} is ${JSON.stringify(value)?.slice(0, 60) ?? 'missing'}, expected ${config.jsonExpect}` };
      if ((config.jsonExpect === undefined || config.jsonExpect === '') && value === undefined) return { ...result, ok: false, cls: 'assertion', message: `${config.jsonPath} is missing` };
    }
    if (config.maxMs && result.ms > config.maxMs) return { ...result, ok: false, cls: 'timeout', message: `Answered in ${result.ms} ms, slower than ${config.maxMs} ms` };
    return { ...result, ok: true };
  } catch (error) {
    if (deadline.aborted || error.name === 'AbortError') return failure({ code: 'ETIMEDOUT' });
    return failure(error);
  }
}

export function runTcp({ host, port }, { timeoutMs, family = 'auto' } = {}) {
  return new Promise(resolve => {
    const started = now();
    const socket = net.connect({ host, port, family: familyOption(family), timeout: timeoutMs });
    const done = result => { socket.destroy(); resolve(result); };
    const timer = setTimeout(() => done(failure({ code: 'ETIMEDOUT' })), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); done({ ok: true, ms: round(now() - started) }); });
    socket.once('timeout', () => { clearTimeout(timer); done(failure({ code: 'ETIMEDOUT' })); });
    socket.once('error', error => { clearTimeout(timer); done(failure(error)); });
  });
}

// iputils ping, unprivileged (the image strips setuid; see Dockerfile).
// Refuses to report 0 ms for an answer it couldn't parse (owner T8).
export function parsePing(output) {
  const loss = /(\d+(?:\.\d+)?)% packet loss/.exec(output);
  const rtt = /= [\d.]+\/([\d.]+)\/[\d.]+/.exec(output) ?? /time[=<]([\d.]+) ?ms/.exec(output);
  return { loss: loss ? Number(loss[1]) : null, ms: rtt ? Number(rtt[1]) : null };
}
export function runPing({ host, count = 1 }, { timeoutMs, family = 'auto', command = 'ping' } = {}) {
  return new Promise(resolve => {
    if (!host || host.startsWith('-')) return resolve(failure(null, { cls: 'internal', message: 'Not a host name' }));
    const waitSeconds = Math.max(1, Math.floor(timeoutMs / 1000 / Math.max(1, count)));
    const args = ['-n', '-c', String(count), '-W', String(waitSeconds), ...(family === '4' ? ['-4'] : family === '6' ? ['-6'] : []), '--', host];
    let output = '';
    let child;
    try { child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { return resolve(failure(error, { cls: 'internal' })); }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 500);
    child.stdout.on('data', chunk => { if (output.length < 8192) output += chunk; });
    child.stderr.on('data', chunk => { if (output.length < 8192) output += chunk; });
    child.on('error', error => { clearTimeout(timer); resolve(failure(error, { cls: 'internal', message: 'Studio couldn\'t run ping' })); });
    child.on('close', code => {
      clearTimeout(timer);
      const parsed = parsePing(output);
      if (code === 0 && parsed.ms !== null) return resolve({ ok: true, ms: round(parsed.ms), loss: parsed.loss });
      if (/unknown host|Name or service not known|Temporary failure in name resolution/i.test(output)) return resolve(failure({ code: 'ENOTFOUND' }));
      if (/unreachable/i.test(output)) return resolve(failure({ code: 'EHOSTUNREACH' }));
      if (code === 0) return resolve(failure(null, { cls: 'bad-response', message: 'Ping answered but its time couldn\'t be read' }));
      return resolve(failure({ code: 'ETIMEDOUT' }, { message: 'No answer to ping' }));
    });
  });
}

const RESOLVE = { A: 'resolve4', AAAA: 'resolve6', CNAME: 'resolveCname', MX: 'resolveMx', TXT: 'resolveTxt', NS: 'resolveNs', SRV: 'resolveSrv', PTR: 'resolvePtr', CAA: 'resolveCaa', SOA: 'resolveSoa' };
function answerText(type, answer) {
  if (type === 'MX') return answer.map(item => `${item.priority} ${item.exchange}`);
  if (type === 'TXT') return answer.map(parts => parts.join(''));
  if (type === 'SRV') return answer.map(item => `${item.priority} ${item.weight} ${item.port} ${item.name}`);
  if (type === 'CAA') return answer.map(item => Object.entries(item).filter(([key]) => key !== 'critical').map(([key, value]) => `${key} ${value}`).join(' '));
  if (type === 'SOA') return [`${answer.nsname} ${answer.hostmaster} ${answer.serial}`];
  return answer.map(String);
}
export async function runDns({ name, recordType = 'A', resolver: server, expect }, { timeoutMs } = {}) {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (server) {
    try { resolver.setServers([server]); } catch { return failure(null, { cls: 'internal', message: 'The resolver address isn\'t usable' }); }
  }
  const started = now();
  const timer = setTimeout(() => resolver.cancel(), timeoutMs);
  try {
    const answer = answerText(recordType, await resolver[RESOLVE[recordType]](name));
    const ms = round(now() - started);
    if (expect && !answer.some(value => value === expect || value.includes(expect))) return { ok: false, ms, cls: 'assertion', message: `Answer was ${answer.slice(0, 3).join(', ') || 'empty'}`, answer };
    return { ok: true, ms, answer: answer.slice(0, 10) };
  } catch (error) {
    if (error.code === 'ECANCELLED' || error.code === 'ETIMEOUT') return failure({ code: 'ETIMEDOUT' });
    return failure(error);
  } finally { clearTimeout(timer); }
}

// Certificate expiry for any TLS endpoint, and whether its chain is trusted.
export function runTls({ host, port = 443, warnDays = 14 }, { timeoutMs, ca, family = 'auto' } = {}) {
  return new Promise(resolve => {
    const started = now();
    const socket = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, family: familyOption(family), timeout: timeoutMs, ...(ca ? { ca } : {}) });
    const done = result => { socket.destroy(); resolve(result); };
    const timer = setTimeout(() => done(failure({ code: 'ETIMEDOUT' })), timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const expires = certExpiry(cert);
      const ms = round(now() - started);
      const days = expires ? Math.floor((expires - Date.now()) / 86400e3) : null;
      const base = { ms, certExpires: expires, certIssuer: cert?.issuer?.O ?? cert?.issuer?.CN ?? null, certSubject: cert?.subject?.CN ?? null };
      if (!socket.authorized) {
        const cls = classifyError({ code: String(socket.authorizationError) }) ?? 'tls-untrusted';
        if (cls === 'tls-expired' || (days !== null && days < 0)) return done({ ...base, ok: false, cls: 'tls-expired', message: 'The certificate has expired' });
        return done({ ...base, ok: false, cls, message: CLASS_SENTENCES[cls] });
      }
      if (days !== null && days < 0) return done({ ...base, ok: false, cls: 'tls-expired', message: 'The certificate has expired' });
      if (days !== null && days <= warnDays) return done({ ...base, ok: true, warning: { cls: 'tls-expired', message: `The certificate expires in ${days} day${days === 1 ? '' : 's'}` } });
      return done({ ...base, ok: true });
    });
    socket.once('timeout', () => { clearTimeout(timer); done(failure({ code: 'ETIMEDOUT' })); });
    socket.once('error', error => { clearTimeout(timer); done(failure(error)); });
  });
}

// Resolves a host the way the monitor will connect to it, for the result
// shown with a check ("10.0.0.5").
export function resolveAddress(host, family = 'auto') {
  return new Promise(resolve => lookup(host, { family: familyOption(family) }, (error, address) => resolve(error ? null : address)));
}
