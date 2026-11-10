import { X509Certificate, createHash } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import { BlockList, isIP } from "node:net";
import tls from "node:tls";

// Missing intermediate certificates (owner decision, 10 Nov 2026). A server
// that sends only its own certificate can't be checked against a root
// authority alone; browsers then fetch the missing intermediate from the
// address in the certificate (Authority Information Access, "CA Issuers"),
// and so does Studio, with limits:
// - plain http only (as the addresses are; https here could loop), GET, no
//   redirects, no cookies or credentials, at most 16 KB, 4 seconds;
// - a fetched certificate is used only when it is an authority, in date,
//   signed the certificate below it, and itself chains to a certificate
//   Studio already trusts (public authorities or Administration › Trusted
//   certificates), at most three steps up. A server can't make Studio trust
//   anything new: the fetch only fills a gap between a trusted authority
//   and the server's own certificate;
// - answers are remembered (12 hours when good, 10 minutes when not), so a
//   broken service doesn't cause a fetch on every refresh.
// Nothing fetched is shown to anyone; only whether the chain completed.
export const AIA_LIMITS = Object.freeze({
  bytes: 16 * 1024,
  timeoutMs: 4000,
  depth: 3,
  goodMs: 12 * 60 * 60 * 1000,
  badMs: 10 * 60 * 1000,
  remembered: 64,
  urlsPerCertificate: 2,
});

// The errors that mean "a certificate between the server's and a trusted
// one is missing", not "untrusted" or "wrong name".
export const MISSING_ISSUER = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
]);

export function missingIssuer(error) {
  return MISSING_ISSUER.has(error?.code) || MISSING_ISSUER.has(error?.cause?.code);
}

const BLOCK = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+?-----END CERTIFICATE-----/g;

function parse(source) {
  try {
    return new X509Certificate(source);
  } catch {
    return null;
  }
}

// The http "CA Issuers" addresses in a certificate, at most two.
export function issuerUrls(certificate) {
  const access = String(certificate?.infoAccess ?? "");
  const urls = [];
  for (const line of access.split("\n")) {
    const match = /^CA Issuers - URI:(\S+)$/.exec(line.trim());
    if (!match) continue;
    let url;
    try {
      url = new URL(match[1]);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" || url.username || url.password) continue;
    urls.push(url.href);
    if (urls.length >= AIA_LIMITS.urlsPerCertificate) break;
  }
  return urls;
}

// DER (as CA Issuers addresses usually serve) or PEM.
export function readCertificate(buffer) {
  if (!buffer?.length) return null;
  const text = buffer.toString("latin1");
  if (text.includes("-----BEGIN CERTIFICATE-----")) {
    const first = text.match(BLOCK)?.[0];
    return first ? parse(first) : null;
  }
  return parse(buffer);
}

function inDate(certificate, now = Date.now()) {
  const from = Date.parse(certificate.validFrom);
  const to = Date.parse(certificate.validTo);
  return Number.isFinite(from) && Number.isFinite(to) && from <= now && now <= to;
}

// Whether `parent` is an authority, in date, and signed `child`.
export function signedBy(child, parent) {
  if (!child || !parent || parent.ca !== true || !inDate(parent)) return false;
  try {
    return child.checkIssued(parent) && child.verify(parent.publicKey);
  } catch {
    return false;
  }
}

// Minimal DER reading for the extensions OpenSSL stops enforcing on a
// certificate once something below it is a trust anchor (security review
// M1): name constraints, a path length, policy constraints, inhibit any
// policy. A chain that needs any of them is never learned.
function derItems(buffer, start = 0, end = buffer.length) {
  const items = [];
  let at = start;
  while (at < end) {
    const tag = buffer[at];
    let length = buffer[at + 1];
    let header = 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      if (count < 1 || count > 4) return null;
      length = 0;
      for (let i = 0; i < count; i += 1) length = length * 256 + buffer[at + 2 + i];
      header += count;
    }
    const body = at + header;
    if (body + length > end) return null;
    items.push({ tag, start: body, end: body + length });
    at = body + length;
  }
  return items;
}
const OID = {
  nameConstraints: "551d1e",
  basicConstraints: "551d13",
  policyConstraints: "551d24",
  inhibitAnyPolicy: "551d36",
};
export function hasNameConstraints(certificate) {
  return hasConstraints(certificate, { only: [OID.nameConstraints, OID.policyConstraints, OID.inhibitAnyPolicy] });
}
export function hasConstraints(certificate, { only } = {}) {
  try {
    const der = certificate.raw;
    const [outer] = derItems(der) ?? [];
    const [tbs] = derItems(der, outer.start, outer.end) ?? [];
    const fields = derItems(der, tbs.start, tbs.end) ?? [];
    const wrapper = fields.find((item) => item.tag === 0xa3);
    if (!wrapper) return false;
    const [list] = derItems(der, wrapper.start, wrapper.end) ?? [];
    for (const extension of derItems(der, list.start, list.end) ?? []) {
      const parts = derItems(der, extension.start, extension.end) ?? [];
      const oid = der.subarray(parts[0].start, parts[0].end).toString("hex");
      if (oid === OID.nameConstraints || oid === OID.policyConstraints || oid === OID.inhibitAnyPolicy) return true;
      if (oid === OID.basicConstraints && !only) {
        const value = parts.find((part) => part.tag === 0x04);
        const [sequence] = derItems(der, value.start, value.end) ?? [];
        if ((derItems(der, sequence.start, sequence.end) ?? []).some((item) => item.tag === 0x02)) return true;
      }
    }
    return false;
  } catch {
    // Unreadable: treat as constrained, so nothing is learned from it.
    return true;
  }
}

// Addresses an issuer fetch never goes to (security review L2): this
// machine and link-local (cloud metadata services live there). Private
// networks stay allowed: an owner's own CA usually publishes there.
let refused;
function refusedList() {
  if (!refused) {
    refused = new BlockList();
    refused.addSubnet("127.0.0.0", 8, "ipv4");
    refused.addSubnet("0.0.0.0", 8, "ipv4");
    refused.addSubnet("169.254.0.0", 16, "ipv4");
    refused.addAddress("::1", "ipv6");
    refused.addAddress("::", "ipv6");
    refused.addSubnet("fe80::", 10, "ipv6");
  }
  return refused;
}
let refuseLocal = true;
export function refusedAddress(address) {
  if (!refuseLocal) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const value = mapped ?? address;
  const family = isIP(value);
  if (!family) return true;
  return refusedList().check(value, family === 6 ? "ipv6" : "ipv4");
}
// Tests serve issuer certificates from this machine.
export function allowLocalIssuersForTests(allow) {
  refuseLocal = !allow;
}
function guardedLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    lookup(hostname, { ...(typeof options === "object" ? options : {}), all: true }, (error, addresses) => {
      if (error) return done(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }];
      if (!list.length || list.some((entry) => refusedAddress(entry.address)))
        return done(Object.assign(new Error("Refused issuer address"), { code: "EAI_REFUSED" }));
      if (options?.all) return done(null, list);
      return done(null, list[0].address, list[0].family);
    });
  };
}

// The certificates Studio trusts, parsed once per set.
let anchorsFor = { key: null, list: [] };
export function trustedCertificates(pems) {
  const key = createHash("sha256").update(pems.join("\n")).digest("hex");
  if (anchorsFor.key !== key) {
    const list = [];
    for (const pem of pems)
      for (const block of String(pem).match(BLOCK) ?? []) {
        const certificate = parse(block);
        if (certificate) list.push(certificate);
      }
    anchorsFor = { key, list };
  }
  return anchorsFor.list;
}

const remembered = new Map(); // url → { certificate, until }
function remember(url, certificate) {
  if (remembered.size >= AIA_LIMITS.remembered) remembered.delete(remembered.keys().next().value);
  remembered.set(url, { certificate, until: Date.now() + (certificate ? AIA_LIMITS.goodMs : AIA_LIMITS.badMs) });
}

// One plain GET, capped in size and time. Resolves a certificate or null.
export function fetchIssuer(url, { get = http.get, lookup } = {}) {
  const known = remembered.get(url);
  if (known && known.until > Date.now()) return Promise.resolve(known.certificate);
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return Promise.resolve(null);
  }
  if (isIP(host) && refusedAddress(host)) {
    remember(url, null);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    let request;
    const finish = (certificate) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        request?.destroy();
      } catch {
        // already closed
      }
      remember(url, certificate);
      resolve(certificate);
    };
    const timer = setTimeout(() => finish(null), AIA_LIMITS.timeoutMs);
    try {
      request = get(
        url,
        {
          agent: false,
          headers: { accept: "application/pkix-cert, application/x-x509-ca-cert, */*" },
          lookup: guardedLookup(lookup),
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            finish(null);
            return;
          }
          const declared = Number(response.headers["content-length"]);
          if (Number.isFinite(declared) && declared > AIA_LIMITS.bytes) {
            finish(null);
            return;
          }
          const parts = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > AIA_LIMITS.bytes) finish(null);
            else parts.push(chunk);
          });
          response.on("end", () => finish(readCertificate(Buffer.concat(parts))));
          response.on("error", () => finish(null));
        },
      );
      request.on("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}

// The intermediates that join `leaf` to a trusted certificate, fetched and
// checked one step at a time; [] when there is no such path.
export async function completeChain(leaf, anchors, { fetch = fetchIssuer, lookup } = {}) {
  const chain = [];
  let current = leaf;
  for (let step = 0; step <= AIA_LIMITS.depth; step += 1) {
    if (step > 0) {
      const anchor = anchors.find((candidate) => signedBy(current, candidate));
      if (anchor) {
        // Each learned certificate becomes a trust anchor, so the checks
        // OpenSSL would make against the certificates above it are skipped.
        // Learn nothing when any of those carries a constraint (review M1);
        // the lowest one's own path length still binds nothing below it
        // that this server could add.
        const above = [anchor, ...chain.slice(1)];
        if (above.some(hasConstraints)) return [];
        if (chain[0] && hasNameConstraints(chain[0])) return [];
        return chain;
      }
    }
    if (step === AIA_LIMITS.depth) break;
    let next = null;
    for (const url of issuerUrls(current)) {
      const candidate = await fetch(url, { lookup });
      if (candidate && signedBy(current, candidate)) {
        next = candidate;
        break;
      }
    }
    // A fetched certificate that signs itself is a root: only one already
    // trusted counts, and that was checked above.
    if (!next || next.checkIssued(next)) break;
    chain.push(next);
    current = next;
  }
  return [];
}

// The certificate an https address sends, read without trusting it; nothing
// is sent to the address. Resolves null when it can't be read in time.
export function serverCertificate({ host, port, servername }, { connect = tls.connect, lookup } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let socket;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // already closed
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), AIA_LIMITS.timeoutMs);
    try {
      socket = connect(
        {
          host,
          port,
          servername: servername ?? (isIP(host) ? undefined : host),
          rejectUnauthorized: false,
          ...(lookup ? { lookup } : {}),
        },
        () => finish(socket.getPeerX509Certificate?.() ?? null),
      );
      socket.on("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}

// Intermediates learned so far (PEM), for the agents' trusted list. Each is
// proven to chain to a trusted certificate before it is added here. The
// generation changes with every addition or removal, so agents and trusted
// lists keyed by it are rebuilt (security review L4).
const learned = new Map(); // fingerprint → pem
let generation = 0;
export function learnedIntermediates() {
  return [...learned.values()];
}
export function learnedGeneration() {
  return generation;
}

// Per host:port, a completion in progress (shared) or one that recently
// found nothing (not tried again for a while; review L3).
const attempts = new Map(); // key → { promise } | { until }
function attemptKey(url) {
  return `${url.hostname}:${url.port || 443}`;
}

// Tries to complete the chain for one https address. Resolves true when it
// learned an intermediate that wasn't known before (worth one more try).
export function learnIntermediates(address, anchorPems, options = {}) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return Promise.resolve(false);
  }
  if (url.protocol !== "https:") return Promise.resolve(false);
  const key = attemptKey(url);
  const known = attempts.get(key);
  if (known?.promise) return known.promise;
  if (known && known.until > Date.now()) return Promise.resolve(false);
  const promise = (async () => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const leaf = await serverCertificate({ host, port: Number(url.port) || 443 }, options);
    const chain = leaf ? await completeChain(leaf, trustedCertificates(anchorPems), options) : [];
    let added = false;
    for (const certificate of chain) {
      if (learned.has(certificate.fingerprint256)) continue;
      if (learned.size >= AIA_LIMITS.remembered) learned.delete(learned.keys().next().value);
      learned.set(certificate.fingerprint256, certificate.toString());
      added = true;
    }
    if (added) generation += 1;
    return added;
  })()
    .catch(() => false)
    .then((added) => {
      if (attempts.size >= AIA_LIMITS.remembered) attempts.delete(attempts.keys().next().value);
      attempts.set(key, { until: Date.now() + (added ? 0 : AIA_LIMITS.badMs) });
      return added;
    });
  attempts.set(key, { promise });
  return promise;
}

// When the trusted list changes, everything learned against the old one is
// dropped (security review M2): an intermediate is only good while the
// certificate it led to is still trusted.
export function forgetIntermediates() {
  if (learned.size) generation += 1;
  learned.clear();
  remembered.clear();
  attempts.clear();
  anchorsFor = { key: null, list: [] };
}
