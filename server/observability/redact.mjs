// Redaction before anything is stored (observability plan 7.4). Pattern masks
// catch credentials by their shape; exact-value masks replace the values of
// saved connection keys and Studio's own secrets wherever they appear.

const PATTERNS = [
  // PEM private keys.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  // Authorization, Cookie and similar header values.
  [/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key)(\s*[:=]\s*)("?)[^\r\n"]+/gi, '$1$2$3[redacted]'],
  // Bearer and Basic tokens anywhere.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // JWT-shaped strings.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[token]'],
  // URL user info (https://user:pass@host).
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[redacted]@'],
  // key=value pairs in query strings, forms and logs.
  [/\b((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|pass|key|sig|signature)=)[^&\s"'<>]+/gi, '$1[redacted]'],
  // "password": "…" style JSON fields.
  [/("(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|key|authorization)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2'],
];

// ANSI colour and cursor codes, then other control characters except tab
// and newline.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function stripControl(text) {
  return String(text).replace(ANSI, '').replace(CONTROL, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

// secrets: Map of value → label. Values shorter than 6 characters are not
// matched by substring (too many false hits) but are still caught by the
// patterns above when they appear as key=value.
export function createRedactor() {
  let secrets = [];
  return {
    setSecrets(map) {
      const list = [];
      for (const [value, label] of map) if (typeof value === 'string' && value.length >= 6) list.push([value, label]);
      // Longest first, so a secret containing another is masked whole.
      secrets = list.sort((a, b) => b[0].length - a[0].length);
    },
    get secretCount() { return secrets.length; },
    text(value, limit = 8192) {
      let text = stripControl(value ?? '');
      for (const [secret, label] of secrets) if (text.includes(secret)) text = text.split(secret).join(`[secret: ${label}]`);
      for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
      if (text.length > limit) text = text.slice(0, limit - 1) + '…';
      return text;
    },
  };
}
