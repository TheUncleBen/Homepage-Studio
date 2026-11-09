import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import tls from "node:tls";

// Which certificate an address sends, for Test connection and Check now when
// the certificate isn't trusted (owner T43 on 53ebc3b): its names and who
// issued it, so the owner can tell a reverse proxy's certificate from an
// app's own. Only public certificate fields; nothing is sent to the address.
const TIMEOUT_MS = 5000;

const first = (value) => (Array.isArray(value) ? value[0] : value);
const clean = (value) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 120)
    : "";

export function describeCertificate(certificate) {
  if (!certificate || typeof certificate !== "object" || !Object.keys(certificate).length) return null;
  const names = String(certificate.subjectaltname || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^(DNS|IP Address):/.test(part))
    .map((part) => clean(part.replace(/^(DNS|IP Address):/, "")))
    .filter(Boolean)
    .slice(0, 4);
  const subject = clean(first(certificate.subject?.CN)) || clean(first(certificate.subject?.O));
  const issuer = clean(first(certificate.issuer?.CN)) || clean(first(certificate.issuer?.O));
  const selfSigned =
    Boolean(certificate.issuer && certificate.subject) &&
    JSON.stringify(certificate.issuer) === JSON.stringify(certificate.subject);
  const validTo = Date.parse(certificate.valid_to);
  return {
    names: names.length ? names : subject ? [subject] : [],
    issuer: issuer || null,
    selfSigned,
    expired: Number.isFinite(validTo) && validTo < Date.now(),
  };
}

// "portainer.example.lan:9443 sent a certificate for localhost, issued by
// Portainer to itself."
export function certificateSentence(host, info) {
  if (!info) return "";
  const names = info.names.length ? info.names.join(", ") : "no name";
  const by = info.selfSigned
    ? info.issuer
      ? `, issued by ${info.issuer} to itself`
      : ", signed by itself"
    : info.issuer
      ? `, issued by ${info.issuer}`
      : "";
  return `${host} sent a certificate for ${names}${by}${info.expired ? ", which has expired" : ""}.`;
}

// Reads the certificate an https address sends. Resolves null for anything
// that isn't https, or when the address can't be reached in time.
export function fetchCertificate(address, { timeoutMs = TIMEOUT_MS, connect = tls.connect } = {}) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== "https:" || url.username || url.password) return Promise.resolve(null);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port) || 443;
  return new Promise((resolve) => {
    let done = false;
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
    const timer = setTimeout(() => finish(null), timeoutMs);
    let socket;
    try {
      socket = connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false }, () =>
        finish({
          host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
          info: describeCertificate(socket.getPeerCertificate()),
        }),
      );
      socket.on("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}

// The names of the certificates Studio trusts besides the public ones
// (Administration › Trusted certificates, loaded through NODE_EXTRA_CA_CERTS).
export function trustedNames(bundle = process.env.NODE_EXTRA_CA_CERTS) {
  if (!bundle) return [];
  let text = "";
  try {
    text = readFileSync(bundle, "utf8");
  } catch {
    return [];
  }
  const names = [];
  for (const block of text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []) {
    try {
      const subject = new X509Certificate(block).subject;
      const cn = (subject.split("\n").find((line) => line.startsWith("CN=")) || "").slice(3);
      const o = (subject.split("\n").find((line) => line.startsWith("O=")) || "").slice(2);
      if (cn || o) names.push(clean(cn || o));
    } catch {
      // not a certificate Node can read
    }
  }
  return names;
}

// Whether the certificate's issuer is one Studio was told to trust: if it is
// and the check still fails, the chain or the name is the problem, not trust.
export function issuerSentence(info, names = trustedNames()) {
  if (!info?.issuer || info.selfSigned)
    return info?.selfSigned ? "Studio can only trust it if you add this exact certificate." : "";
  return names.includes(info.issuer)
    ? `${info.issuer} is one of your trusted certificates, so the address may not be sending the certificates between them, or the name may not match.`
    : `${info.issuer} isn't one of your trusted certificates.`;
}
