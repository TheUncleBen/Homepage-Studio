import { timingSafeEqual } from "crypto";

// Renderer endpoints only the Studio controller may call (Test connection,
// chart history) check this token. The controller drops every x-studio-*
// header a browser sends before proxying, so only it can send one.
export function fromController(header, token = process.env.STUDIO_INTERNAL_TOKEN) {
  if (!token || typeof header !== "string") return false;
  const sent = Buffer.from(header);
  const expected = Buffer.from(token);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

// A stand-in response that keeps what a native handler answers.
export function captureResponse() {
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
