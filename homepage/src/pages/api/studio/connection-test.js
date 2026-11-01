import { timingSafeEqual } from "crypto";
import { performance } from "perf_hooks";

import { serviceProxy } from "pages/api/services/proxy";
import { withAuth } from "utils/auth";
import { connectionTest, connectionTestResult, TEST_GROUP } from "utils/config/connection-test.mjs";
import { resolveWidgetConnection } from "utils/config/studio-connections.mjs";
import widgets from "widgets/widgets";

// Test connection, asked for by the Studio controller only (it strips every
// x-studio-* header a browser sends and adds this token itself). Runs the
// widget's own first request with the dialog's address and key, and answers
// with a plain reason only: never the service's response.
// Shorter than the controller's 30-second wait, so a slow address gets its own answer.
const TEST_TIMEOUT_MS = 20_000;

export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };

function capture() {
  const result = { status: 200, body: undefined, headers: {} };
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(value) {
      result.body = value;
      return res;
    },
    send(value) {
      result.body = value;
      return res;
    },
    end() {
      return res;
    },
    setHeader(name, value) {
      result.headers[name] = value;
    },
    getHeader(name) {
      return result.headers[name];
    },
  };
  return { res, result };
}

// The first request the widget makes on its own: a mapping without segments,
// parameters or a method other than GET.
export function firstEndpoint(definition) {
  const entries = Object.entries(definition?.mappings || {});
  const simple = entries.find(
    ([, mapping]) => !mapping?.segments && !mapping?.params && (!mapping?.method || mapping.method === "GET"),
  );
  return simple?.[0];
}

export function fromController(header, token = process.env.STUDIO_INTERNAL_TOKEN) {
  if (!token || typeof header !== "string") return false;
  const sent = Buffer.from(header);
  const expected = Buffer.from(token);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

async function handler(req, res) {
  if (!fromController(req.headers["x-studio-internal"])) return res.status(404).end();
  if (req.method !== "POST") return res.status(405).end();
  const draft = req.body?.widget;
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || typeof draft.type !== "string")
    return res.status(400).json({ error: "Send the widget to test." });
  const type = draft.type === "calendar" ? "ical" : draft.type;
  const definition = widgets[type];
  if (!definition) return res.status(400).json({ error: "This widget type can't be tested." });
  const widget = resolveWidgetConnection(draft);
  const endpoint = firstEndpoint(definition);
  const { res: captured, result } = capture();
  const request = {
    method: "GET",
    headers: {},
    query: { group: TEST_GROUP, service: "Test", index: "-1", ...(endpoint ? { endpoint } : {}) },
  };
  const started = performance.now();
  let timer;
  const finished = await Promise.race([
    connectionTest.run({ widget }, () => serviceProxy(request, captured)).then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), TEST_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (!finished)
    return res.status(200).json({ ok: false, kind: "unreachable", message: "The address didn't answer in time." });
  const ms = performance.now() - started;
  return res.status(200).json(connectionTestResult({ status: result.status, body: result.body, ms }));
}

// Host check and native sign-in first, like every other route.
export default withAuth(handler);
