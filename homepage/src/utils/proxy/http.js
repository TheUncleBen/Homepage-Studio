import dns from "node:dns";
import net from "node:net";
import { createUnzip, constants as zlibConstants } from "node:zlib";

import { http, https } from "follow-redirects";
import cache from "memory-cache";

import { sanitizeErrorURL, sanitizeLogURL } from "./api-helpers";
import { addCookieToJar, setCookieHeader } from "./cookie-jar";

import createLogger from "utils/logger";

const logger = createLogger("httpProxy");

// Integration headers have arbitrary names. Forward only public HTTP metadata
// when a redirect leaves the exact origin that was configured for credentials.
const PUBLIC_REDIRECT_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-length",
  "content-type",
  "user-agent",
]);

const TRANSPORT_ERRORS = {
  ECONNREFUSED: "Connection refused",
  ECONNRESET: "Connection reset",
  ENOTFOUND: "Host not found",
  EAI_AGAIN: "Temporary DNS lookup failure",
  EHOSTUNREACH: "Host unreachable",
  ENETUNREACH: "Network unreachable",
  ETIMEDOUT: "Request timed out",
  ABORT_ERR: "Request cancelled",
  ERR_RESPONSE_WIRE_TOO_LARGE: "Upstream response exceeds the 32 MiB transfer limit",
  ERR_RESPONSE_DECODED_TOO_LARGE: "Decoded upstream response exceeds the 32 MiB limit",
  ERR_INVALID_RESPONSE_ENCODING: "Invalid compressed upstream response",
  ERR_INVALID_URL: "Invalid upstream URL",
  ERR_INVALID_CHAR: "Invalid upstream request header",
  ERR_HTTP_INVALID_HEADER_VALUE: "Invalid upstream request header",
  ERR_FR_REDIRECTION_FAILURE: "Redirected request failed",
  ERR_FR_TOO_MANY_REDIRECTS: "Too many redirects",
  ERR_FR_MAX_BODY_LENGTH_EXCEEDED: "Request body exceeds the transport limit",
  ERR_CROSS_ORIGIN_BODY: "Refusing to forward a request body to another origin",
};

function transportError(error) {
  // Error causes/options can include complete URLs, headers and login bodies.
  // Only expose known transport diagnostics, never serialize the original Error.
  const code = Object.hasOwn(TRANSPORT_ERRORS, error?.code) ? error.code : "UPSTREAM_REQUEST_FAILED";
  const causeCode = Object.hasOwn(TRANSPORT_ERRORS, error?.cause?.code) ? error.cause.code : undefined;
  return {
    code,
    message: TRANSPORT_ERRORS[code] ?? "Upstream request failed",
    ...(causeCode ? { causeCode } : {}),
  };
}

function addCookieHandler(url, params) {
  let jarCookie = setCookieHeader(url, params);
  let sourceUrl = url.toString();
  let hasBody = Boolean(params.body);
  let crossedOrigin = false;

  params.beforeRedirect = (options, responseInfo, requestInfo) => {
    const responseUrl = requestInfo?.url ?? sourceUrl;
    if (!crossedOrigin) addCookieToJar(responseUrl, responseInfo.headers);
    const changesOrigin = new URL(options.href).origin !== new URL(responseUrl).origin;
    crossedOrigin ||= changesOrigin;
    if (requestInfo?.method && requestInfo.method !== options.method && options.method === "GET") hasBody = false;
    const cookieHeader = (options.cookieHeader ?? "Cookie").toLowerCase();
    for (const name of Object.keys(options.headers ?? {})) {
      if (
        (jarCookie && name.toLowerCase() === cookieHeader) ||
        (changesOrigin && !PUBLIC_REDIRECT_HEADERS.has(name.toLowerCase()))
      ) {
        delete options.headers[name];
      }
    }
    if (changesOrigin) {
      delete options.auth;
      // 307/308 retain the request body, which can contain a login password.
      // A 301/302/303 rewritten to GET has already discarded it in follow-redirects.
      if (hasBody) {
        throw Object.assign(new Error(TRANSPORT_ERRORS.ERR_CROSS_ORIGIN_BODY), { code: "ERR_CROSS_ORIGIN_BODY" });
      }
    }
    // Cookie domains ignore ports and may cover subdomains. Once this redirect
    // chain leaves its origin, do not let the jar restore stripped credentials.
    jarCookie = !crossedOrigin && setCookieHeader(options.href, options, { overwrite: true });
    sourceUrl = options.href;
  };
  return (responseUrl, headers) => {
    // A foreign response must not poison a cookie domain shared with the source.
    if (!crossedOrigin) addCookieToJar(responseUrl, headers);
  };
}

// Integration requests are finite API/image/feed reads, not streaming tunnels.
// Keep the absolute deadline below the controller's 60-second proxy timeout.
const REQUEST_DEADLINE_MS = 45_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

function handleRequest(requestor, url, params) {
  return new Promise((resolve, reject) => {
    let request, response, responseContent, deadline;
    let settled = false;
    let wireBytes = 0;
    let decodedBytes = 0;
    const data = [];
    const signal = params.signal;
    const requestError = (code) => Object.assign(new Error(TRANSPORT_ERRORS[code]), { code });
    const cleanup = () => {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      data.length = 0;
      if (responseContent !== response) response?.unpipe(responseContent);
      responseContent?.destroy();
      response?.destroy();
      request?.destroy();
      reject([500, error]);
    };
    const abort = () => fail(requestError("ABORT_ERR"));
    const timeout =
      Number.isFinite(params.timeout) && params.timeout > 0
        ? Math.min(params.timeout, REQUEST_DEADLINE_MS)
        : REQUEST_DEADLINE_MS;

    deadline = setTimeout(() => fail(requestError("ETIMEDOUT")), timeout);
    deadline.unref?.();
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const saveResponseCookies = addCookieHandler(url, params);
      if (params?.body) {
        params.headers = params.headers ?? {};
        params.headers["content-length"] = Buffer.byteLength(params.body);
      }

      request = requestor.request(url, params, (upstreamResponse) => {
        if (settled) {
          upstreamResponse.destroy();
          return;
        }
        response = upstreamResponse;
        response.on("error", fail);
        response.once("aborted", () => fail(requestError("ECONNRESET")));
        responseContent = response;
        const contentEncoding = response.headers["content-encoding"]?.trim().toLowerCase();
        if (contentEncoding === "gzip" || contentEncoding === "deflate") {
          // Retain the native lenient flush behavior for compressed responses.
          responseContent = createUnzip({
            flush: zlibConstants.Z_SYNC_FLUSH,
            finishFlush: zlibConstants.Z_SYNC_FLUSH,
          });
          responseContent.on("error", () => fail(requestError("ERR_INVALID_RESPONSE_ENCODING")));
        }

        if (Number(response.headers["content-length"]) > MAX_RESPONSE_BYTES) {
          fail(requestError("ERR_RESPONSE_WIRE_TOO_LARGE"));
          return;
        }
        response.on("data", (chunk) => {
          wireBytes += chunk.length;
          if (wireBytes > MAX_RESPONSE_BYTES) fail(requestError("ERR_RESPONSE_WIRE_TOO_LARGE"));
        });
        responseContent.on("data", (chunk) => {
          if (settled) return;
          decodedBytes += chunk.length;
          if (decodedBytes > MAX_RESPONSE_BYTES) {
            fail(requestError("ERR_RESPONSE_DECODED_TOO_LARGE"));
            return;
          }
          data.push(chunk);
        });
        responseContent.once("end", () => {
          if (settled) return;
          try {
            saveResponseCookies(response.responseUrl ?? url, response.headers);
            const body = Buffer.concat(data, decodedBytes);
            settled = true;
            cleanup();
            data.length = 0;
            resolve([response.statusCode, response.headers["content-type"], body, response.headers]);
          } catch (error) {
            fail(error);
          }
        });
        if (responseContent !== response) response.pipe(responseContent);
      });
      request.on("error", fail);
      request.once("timeout", () => fail(requestError("ETIMEDOUT")));
      if (params?.body) request.write(params.body);
      request.end();
    } catch (error) {
      fail(error);
    }
  });
}

export function httpsRequest(url, params) {
  return handleRequest(https, url, params);
}

export function httpRequest(url, params) {
  return handleRequest(http, url, params);
}

export async function cachedRequest(url, duration = 5, ua = "homepage") {
  const cached = cache.get(url);

  if (cached) {
    return cached;
  }

  const options = {
    headers: {
      "User-Agent": ua,
      Accept: "application/json",
    },
  };
  let [, , data] = await httpProxy(url, options);
  if (Buffer.isBuffer(data)) {
    try {
      data = JSON.parse(Buffer.from(data).toString());
    } catch {
      logger.debug("Non-JSON cachedRequest response from %s; retaining text", sanitizeLogURL(url));
      data = Buffer.from(data).toString();
    }
  }
  cache.put(url, data, duration * 1000 * 60);
  return data;
}

// Custom DNS lookup that falls back to Node.js c-ares resolver (dns.resolve)
// when system getaddrinfo (dns.lookup) fails with ENOTFOUND/EAI_NONAME.
// Fixes DNS resolution issues with Alpine/musl libc in k8s
const FALLBACK_CODES = new Set(["ENOTFOUND", "EAI_NONAME"]);

function homepageDNSLookupFn() {
  const normalizeOptions = (options) => {
    if (typeof options === "number") {
      return { family: options, all: false, lookupOptions: { family: options } };
    }

    const normalized = options ?? {};
    return {
      family: normalized.family,
      all: Boolean(normalized.all),
      lookupOptions: normalized,
    };
  };

  return (hostname, options, callback) => {
    // Handle case where options is the callback (2-argument form)
    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    const { family, all, lookupOptions } = normalizeOptions(options);
    const sendResponse = (addr, fam) => {
      if (all) {
        let addresses = addr;
        if (!Array.isArray(addresses)) {
          addresses = [{ address: addresses, family: fam }];
        } else if (addresses.length && typeof addresses[0] === "string") {
          addresses = addresses.map((a) => ({ address: a, family: fam }));
        }

        callback(null, addresses);
      } else {
        callback(null, addr, fam);
      }
    };

    // If hostname is already an IP address, return it directly
    const ipVersion = net.isIP(hostname);
    if (ipVersion) {
      sendResponse(hostname, ipVersion);
      return;
    }

    // Try dns.lookup first (preserves /etc/hosts behavior)
    dns.lookup(hostname, lookupOptions, (lookupErr, address, lookupFamily) => {
      if (!lookupErr) {
        sendResponse(address, lookupFamily);
        return;
      }

      // ENOTFOUND or EAI_NONAME will try fallback, otherwise return error here
      if (!FALLBACK_CODES.has(lookupErr.code)) {
        callback(lookupErr);
        return;
      }

      const finalize = (addresses, resolvedFamily) => {
        // Finalize the resolution and call the callback
        if (!addresses || addresses.length === 0) {
          const err = new Error(`No addresses found for hostname: ${hostname}`);
          err.code = "ENOTFOUND";
          callback(err);
          return;
        }

        logger.debug("DNS fallback to c-ares resolver succeeded for %s", hostname);

        sendResponse(addresses, resolvedFamily);
      };

      const resolveOnce = (fn, resolvedFamily, onFail) => {
        // attempt resolution with a specific resolver
        fn(hostname, (err, addresses) => {
          if (!err) {
            finalize(addresses, resolvedFamily);
            return;
          }
          onFail(err);
        });
      };

      const handleFallbackFailure = (resolveErr) => {
        // handle final fallback failure with full context
        logger.debug(
          "DNS fallback failed for %s: lookup error=%s, resolve error=%s",
          hostname,
          lookupErr.code,
          resolveErr?.code,
        );
        callback(resolveErr || lookupErr);
      };

      // Fallback to c-ares (dns.resolve*). If family isn't specified, try v4 then v6.
      if (family === 6) {
        resolveOnce(dns.resolve6, 6, handleFallbackFailure);
        return;
      }

      if (family === 4) {
        resolveOnce(dns.resolve4, 4, handleFallbackFailure);
        return;
      }

      resolveOnce(dns.resolve4, 4, () => {
        resolveOnce(dns.resolve6, 6, handleFallbackFailure);
      });
    });
  };
}

const homepageLookup = homepageDNSLookupFn();
const agentCache = new Map();

function getAgent(protocol, disableIpv6) {
  const cacheKey = `${protocol}:${disableIpv6 ? "ipv4" : "auto"}`;
  const cachedAgent = agentCache.get(cacheKey);
  if (cachedAgent) {
    return cachedAgent;
  }

  const agentOptions = {
    keepAlive: true,
    ...(disableIpv6 ? { family: 4, autoSelectFamily: false } : { autoSelectFamilyAttemptTimeout: 500 }),
    lookup: homepageLookup,
  };

  const agent =
    protocol === "https:"
      ? new https.Agent({ ...agentOptions, rejectUnauthorized: false })
      : new http.Agent(agentOptions);

  agentCache.set(cacheKey, agent);
  return agent;
}

export async function httpProxy(url, params = {}) {
  const constructedUrl = new URL(url);
  const disableIpv6 = process.env.HOMEPAGE_PROXY_DISABLE_IPV6 === "true";
  let request = null;
  if (constructedUrl.protocol === "https:") {
    request = httpsRequest(constructedUrl, {
      agent: getAgent(constructedUrl.protocol, disableIpv6),
      ...params,
    });
  } else {
    request = httpRequest(constructedUrl, {
      agent: getAgent(constructedUrl.protocol, disableIpv6),
      ...params,
    });
  }

  try {
    const [status, contentType, data, responseHeaders] = await request;
    return [status, contentType, data, responseHeaders, params];
  } catch (err) {
    const rawError = Array.isArray(err) ? err[1] : err;
    const safeError = transportError(rawError);
    logger.error(
      "Error calling %s: %s (%s%s)",
      sanitizeLogURL(url),
      safeError.message,
      safeError.code,
      safeError.causeCode ? ` / ${safeError.causeCode}` : "",
    );
    return [
      500,
      "application/json",
      {
        error: {
          message: safeError.message,
          url: sanitizeErrorURL(url),
          rawError: safeError,
        },
      },
      null,
    ];
  }
}
