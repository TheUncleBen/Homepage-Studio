import { Cookie, CookieJar } from "tough-cookie";

const cookieJar = new CookieJar();

export function setCookieHeader(url, params, { overwrite = false } = {}) {
  // add cookie header, if we have one in the jar
  const existingCookie = cookieJar.getCookieStringSync(url.toString());
  if (existingCookie) {
    params.headers = params.headers ?? {};
    const requestedHeader = params.cookieHeader ?? "Cookie";
    const cookieHeader =
      Object.keys(params.headers).find((name) => name.toLowerCase() === requestedHeader.toLowerCase()) ??
      requestedHeader;
    if (overwrite || !params.headers[cookieHeader]) {
      params.headers[cookieHeader] = existingCookie;
      return true;
    }
  }
  return false;
}

export function addCookieToJar(url, headers) {
  let cookieHeader = headers["set-cookie"];
  if (headers instanceof Headers) {
    cookieHeader = headers.getSetCookie();
  }

  if (!cookieHeader || cookieHeader.length === 0) return;

  for (const value of Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]) {
    const cookie = Cookie.parse(value);
    if (!cookie) continue;
    // Bound session retention without reviving expired or explicitly deleted cookies.
    if (cookie.TTL() > 60 * 60 * 1000) cookie.setMaxAge(60 * 60);
    cookieJar.setCookieSync(cookie, url.toString(), { ignoreError: true });
  }
}
