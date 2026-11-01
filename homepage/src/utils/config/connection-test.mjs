import { AsyncLocalStorage } from "node:async_hooks";

// Test connection (Studio widget dialog): while a test runs, the native
// proxy reads the widget being tested instead of services.yaml, so the
// widget's own request runs with the address and key in the dialog.
export const connectionTest = new AsyncLocalStorage();

export const TEST_GROUP = "\u0000studio-connection-test";

// A plain reason for what a test found, never the service's own response.
const TRANSPORT = [
  [/ENOTFOUND|EAI_AGAIN/, "unreachable", "Studio can't find that host name. Check the address."],
  [
    /ECONNREFUSED/,
    "unreachable",
    "Nothing answered at that address and port. Check the address and that the app is running.",
  ],
  [/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i, "unreachable", "The address didn't answer in time."],
  [
    /ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE/,
    "unreachable",
    "The connection to that address was cut off or can't be reached from Studio.",
  ],
  [
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS|certificate/i,
    "certificate",
    "The address's certificate isn't trusted by Studio.",
  ],
];

export function connectionTestResult({ status, body, ms }) {
  const error = body && typeof body === "object" ? body.error : null;
  const outer = error && typeof error === "object" ? error : {};
  // httpProxy's own failure (nothing answered) arrives as data.error.rawError.
  const inner = outer.data && typeof outer.data === "object" && outer.data.error ? outer.data.error : outer;
  const transport = inner.rawError && typeof inner.rawError === "object" ? inner.rawError : null;
  if (outer.code === "WIDGET_NOT_SET_UP")
    return { ok: false, kind: "address", message: "Add the service address first." };
  if (transport) {
    const codes = [transport.code, transport.causeCode].filter((part) => typeof part === "string").join(" ");
    for (const [pattern, kind, message] of TRANSPORT) if (pattern.test(codes)) return { ok: false, kind, message };
    return { ok: false, kind: "unreachable", message: "Studio couldn't reach that address." };
  }
  if (status < 400 && !error)
    return { ok: true, kind: "ok", message: `Connected in ${Math.max(1, Math.round(ms))} ms.` };
  if (status === 401) return { ok: false, kind: "key", message: "The service refused the key or login. Check them." };
  if (status === 403)
    return {
      ok: false,
      kind: "permission",
      message: "The key or login works but has no permission for this. Give it read access in the app.",
    };
  if (status === 404)
    return {
      ok: false,
      kind: "address",
      message: "The address answered, but not where this widget expects. Check the address and the app's version.",
    };
  if (status >= 500)
    return {
      ok: false,
      kind: "service",
      message: `The service had an error (${status}). Try again, or check the app.`,
    };
  return {
    ok: false,
    kind: "unknown",
    message: "The test didn't get the answer this widget expects. Check the address and key.",
  };
}
