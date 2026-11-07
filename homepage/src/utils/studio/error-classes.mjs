// One list of error classes, shared by cards, Test connection, monitors and
// the log explorer (observability plan 5.2), so they all say the same thing.
// Plain ESM with no imports: the controller loads it too (Dockerfile COPY).

export const ERROR_CLASSES = [
  "auth",
  "permission",
  "not-found",
  "dns",
  "refused",
  "timeout",
  "tls-untrusted",
  "tls-expired",
  "tls-name",
  "http-status",
  "bad-response",
  "assertion",
  "unreachable",
  "internal",
];

// What each class means, in the words cards already use.
export const CLASS_SENTENCES = {
  auth: "The API key or password was refused",
  permission: "The account is missing a permission",
  "not-found": "The address or API path wasn’t found",
  dns: "Name not found · check the address",
  refused: "Connection refused · check the address and port",
  timeout: "No answer in time",
  "tls-untrusted": "The certificate isn’t trusted",
  "tls-expired": "The certificate has expired",
  "tls-name": "The certificate is for a different name",
  "http-status": "The service answered with an error",
  "bad-response": "The service didn’t answer as expected",
  assertion: "The answer didn’t match what was expected",
  unreachable: "The network or host can’t be reached",
  internal: "Studio couldn’t run the check",
};

const STATUS_CLASS = { 401: "auth", 407: "auth", 403: "permission", 404: "not-found", 410: "not-found" };

// Classifies an error from its code, HTTP status or message. Returns one of
// ERROR_CLASSES, or null when nothing is known.
export function classifyError({ code, status, message } = {}) {
  const text = `${code ?? ""} ${message ?? ""}`;
  const httpStatus = Number(status) || Number(/\b([45]\d\d)\b/.exec(String(message ?? ""))?.[1]) || 0;
  if (STATUS_CLASS[httpStatus]) return STATUS_CLASS[httpStatus];
  if (/CERT_HAS_EXPIRED|certificate has expired/i.test(text)) return "tls-expired";
  if (/ERR_TLS_CERT_ALTNAME_INVALID|Hostname\/IP does not match|altnames/i.test(text)) return "tls-name";
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|DEPTH_ZERO|CERT_UNTRUSTED|certificate|SSL|TLS/i.test(text))
    return "tls-untrusted";
  if (/ECONNREFUSED|refused/i.test(text)) return "refused";
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME|ENODATA|NXDOMAIN|SERVFAIL|name not found/i.test(text)) return "dns";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|TimeoutError|timed? ?out|AbortError/i.test(text)) return "timeout";
  if (/EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN|unreachable/i.test(text)) return "unreachable";
  if (/ECONNRESET|EPIPE|socket hang up|EPROTO|Parse Error|Invalid JSON|Unexpected token/i.test(text))
    return "bad-response";
  if (httpStatus >= 400) return "http-status";
  return null;
}

// Words added to the search index so plain words find coded errors:
// "refused" finds ECONNREFUSED, "unauthorized" finds a 401 (plan 7.7).
export const ERROR_WORDS = {
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset",
  ETIMEDOUT: "timed out timeout",
  ENOTFOUND: "name not found dns",
  EAI_AGAIN: "name lookup dns",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  CERT_HAS_EXPIRED: "certificate expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "self signed certificate",
  SELF_SIGNED_CERT_IN_CHAIN: "self signed certificate",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificate untrusted",
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  500: "server error",
  502: "bad gateway",
  503: "unavailable",
  504: "gateway timeout",
};
