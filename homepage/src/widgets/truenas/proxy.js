import WebSocket from "ws";

import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { formatApiCall, sanitizeErrorURL } from "utils/proxy/api-helpers";
import credentialedProxyHandler from "utils/proxy/handlers/credentialed";
import validateWidgetData from "utils/proxy/validate-widget-data";
import widgets from "widgets/widgets";

const logger = createLogger("truenasProxyHandler");

// Studio: keep the WebSocket inside the shared HTTP helper's 32 MiB response
// limit (utils/proxy/http.js) instead of the ws default of 100 MiB.
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

// Only these diagnostics reach the browser. Raw errors can carry the
// configured URL, credentials or arbitrary upstream text.
const SAFE_ERRORS = {
  TRUENAS_TIMEOUT: "TrueNAS websocket wait timed out",
  TRUENAS_CLOSED: "TrueNAS websocket closed the connection",
  TRUENAS_AUTH_FAILED: "TrueNAS authentication failed",
  TRUENAS_RPC_ERROR: "TrueNAS rejected the request",
  TRUENAS_INVALID_MESSAGE: "Invalid TrueNAS websocket message",
  WS_ERR_UNSUPPORTED_MESSAGE_LENGTH: "TrueNAS websocket message exceeds the 32 MiB limit",
  ECONNREFUSED: "Connection refused",
  ECONNRESET: "Connection reset",
  ENOTFOUND: "Host not found",
  EAI_AGAIN: "Temporary DNS lookup failure",
  EHOSTUNREACH: "Host unreachable",
  ENETUNREACH: "Network unreachable",
  ETIMEDOUT: "Request timed out",
};

function truenasError(code) {
  return Object.assign(new Error(SAFE_ERRORS[code]), { code });
}

function safeError(error) {
  const code = Object.hasOwn(SAFE_ERRORS, error?.code) ? error.code : "UPSTREAM_REQUEST_FAILED";
  return { code, message: SAFE_ERRORS[code] ?? "TrueNAS websocket call failed" };
}

function waitForEvent(ws, handler, { event = "message", parseJson = true } = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(truenasError("TRUENAS_TIMEOUT"));
    }, 10000);

    const handleEvent = (payload) => {
      try {
        let parsed = payload;
        if (parseJson) {
          try {
            if (Buffer.isBuffer(payload)) {
              parsed = JSON.parse(payload.toString());
            } else if (typeof payload === "string") {
              parsed = JSON.parse(payload);
            }
          } catch {
            throw truenasError("TRUENAS_INVALID_MESSAGE");
          }
        }
        const handlerResult = handler(parsed);
        if (handlerResult !== undefined) {
          cleanup();
          if (handlerResult instanceof Error) {
            reject(handlerResult);
          } else {
            resolve(handlerResult);
          }
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const handleError = (err) => {
      cleanup();
      logger.error("TrueNAS websocket error: %s", safeError(err).code);
      reject(err);
    };

    const handleClose = () => {
      cleanup();
      logger.debug("TrueNAS websocket connection closed unexpectedly");
      reject(truenasError("TRUENAS_CLOSED"));
    };

    function cleanup() {
      clearTimeout(timeout);
      ws.off(event, handleEvent);
      ws.off("error", handleError);
      ws.off("close", handleClose);
    }

    ws.on(event, handleEvent);
    ws.on("error", handleError);
    ws.on("close", handleClose);
  });
}

let nextId = 1;
async function sendMethod(ws, method, params = []) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  ws.send(JSON.stringify(payload));

  return waitForEvent(ws, (message) => {
    if (message?.id !== id) return undefined;
    if (message?.error) {
      logger.debug("TrueNAS rejected %s", method);
      return truenasError("TRUENAS_RPC_ERROR");
    }
    return message?.result ?? message;
  });
}

async function authenticate(ws, widget) {
  if (widget?.key) {
    try {
      const apiKeyResult = await sendMethod(ws, "auth.login_with_api_key", [widget.key]);
      if (apiKeyResult === true) return;
      logger.warn("TrueNAS API key authentication failed, falling back to username/password when available.");
    } catch (err) {
      logger.error("TrueNAS API key authentication failed: %s", safeError(err).code);
    }
  }

  if (widget?.username && widget?.password) {
    const loginResult = await sendMethod(ws, "auth.login", [widget.username, widget.password]);
    if (loginResult === true) return;
    logger.warn("TrueNAS username/password authentication failed.");
  }

  throw truenasError("TRUENAS_AUTH_FAILED");
}

export default async function truenasProxyHandler(req, res, map) {
  const { group, service, endpoint, index } = req.query;
  if (!group || !service) {
    logger.debug("Invalid or missing service '%s' or group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  const widget = await getServiceWidget(group, service, index);

  if (!widget) {
    logger.debug("Invalid or missing widget for service '%s' in group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  if (!endpoint) {
    return res.status(204).end();
  }

  const version = Number(widget.version ?? 1);
  if (Number.isNaN(version) || version < 2) {
    // Use legacy REST proxy for version 1
    return credentialedProxyHandler(req, res, map);
  }

  const mappingEntry = Object.values(widgets[widget.type].mappings).find((mapping) => mapping.endpoint === endpoint);
  const wsMethod = mappingEntry.wsMethod;

  if (!wsMethod) {
    logger.debug("Missing wsMethod mapping for TrueNAS endpoint %s", endpoint);
    return res.status(500).json({ error: "Missing wsMethod mapping." });
  }

  try {
    let data;
    let ws;
    try {
      const wsUrl = new URL(formatApiCall(widgets[widget.type].wsAPI, { ...widget }));
      const useSecure = wsUrl.protocol === "https:" || Boolean(widget.key); // API key requires secure connection
      wsUrl.protocol = useSecure ? "wss:" : "ws:";
      ws = new WebSocket(wsUrl, { rejectUnauthorized: false, maxPayload: MAX_MESSAGE_BYTES });
      await waitForEvent(ws, () => true, { event: "open", parseJson: false }); // wait for open
      await authenticate(ws, widget);
      data = await sendMethod(ws, wsMethod);
    } finally {
      // Release the socket on every path, including an open-handshake timeout,
      // and keep late socket errors from becoming unhandled 'error' events.
      if (ws) {
        ws.on("error", () => {});
        if (ws.readyState === WebSocket.OPEN) ws.close();
        else if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      }
    }

    if (!validateWidgetData(widget, endpoint, data)) {
      return res.status(500).json({ error: { message: "Invalid data", url: sanitizeErrorURL(widget.url), data } });
    }

    if (map) data = map(data);

    return res.status(200).json(data);
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message });
    }
    const error = safeError(err);
    logger.error("Websocket call for TrueNAS failed: %s (%s)", error.message, error.code);
    let url;
    try {
      url = sanitizeErrorURL(widget.url);
    } catch {
      // An unparseable configured URL is reported without echoing it.
    }
    return res.status(500).json({ error: { message: error.message, ...(url ? { url } : {}), rawError: error } });
  }
}
