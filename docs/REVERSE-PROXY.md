# Putting a reverse proxy in front

Studio speaks plain HTTP on port 3000 and has no login. A reverse proxy in
front of it gives it an `https://` address on your domain and, more
importantly, decides **who may open it at all**. Studio doesn't manage DNS,
TLS certificates, proxy configuration or sign-in; those stay with you.

No proxy configuration is shipped or tested with Studio. The requirements
below come from what the controller does, and CI exercises them by talking to
the container directly.

## Access control belongs here

Anyone who reaches the page can view and edit every dashboard on the host,
read the configuration, including secrets written into the files, export it,
and create or archive dashboards. Dashboard addresses such as `/admin` don't
change that: they're addresses, not permissions.

So put the whole hostname behind whatever your proxy offers: forward
authentication to your identity provider, an identity-aware proxy, a VPN, or
an IP allowlist. Protect the **whole** origin, not selected paths: the editor
API (`/__studio/...`), the native widget API (`/api/...` and
`/<dashboard>/api/...`) and the shared assets all live on it.

## What every proxy needs

| Requirement | Why |
| --- | --- |
| Serve Studio at the **root** of its own hostname (`https://homepage.example.test/`), not under a path | Dashboards are the first path segment, and the shared assets and `/__studio/` endpoints are absolute. `STUDIO_PUBLIC_ORIGIN` can't have a path |
| **Pass the original `Host` header**, matching `STUDIO_PUBLIC_ORIGIN` | Studio answers only that exact host (and port). Anything else gets `403` *This dashboard address is not in HOMEPAGE_ALLOWED_HOSTS.* |
| Pass the full path and query unchanged | Don't strip or rewrite the dashboard segment. Studio picks the dashboard from the path alone, never from cookies, `Referer` or forwarded headers |
| Route the **entire** hostname to Studio | Including `/_next/static/`, `/__studio/` and the icons and images at the root |
| Allow request bodies of at least **40 MiB** if you'll import dashboards | See [request limits](#request-limits). Everyday saves need far less |
| Don't compress what's already compressed | Studio serves pre-compressed Brotli/gzip build files with `Vary: Accept-Encoding`. Respect `Content-Encoding` and `Vary`; don't add a second encoding |
| A valid certificate | Your choice; Studio doesn't care, but browsers do |

What it doesn't need: sticky sessions (there's one replica) or
`X-Forwarded-*` headers (Studio doesn't use them).

## Request limits

These limits are built in and can't be changed. A proxy with a **lower** body
limit rejects a request before Studio sees it, usually with its own `413`.

| Request | Limit | When it's exceeded |
| --- | --- | --- |
| Editor saves and other configuration requests (JSON) | 2 MiB, escaping included | `413` *This request exceeds the 2 MiB configuration limit.* |
| Importing a complete dashboard (**Import dashboard**) | 40 MiB; each file and the layout inside it still at most 2 MiB | `413` *... 40 MiB dashboard import limit.* |
| Bodies sent to native widget routes (`/api/...`, `/<dashboard>/api/...`) | 1 MiB, arriving within 30 seconds; 32 MiB across all such bodies in flight at once | `413` if larger (at once when `Content-Length` says so), `408` if too slow, `503` with `Retry-After` when the shared budget is full; the connection is closed |

The controller limit matches Homepage's own native body limit (Next.js's
`1mb` default, read as 1 MiB).

## Framing

By default, only pages on the same origin can show a dashboard in a frame.
Every page and response carries:

- `Content-Security-Policy: frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`.

The native runtime doesn't send `X-Powered-By`, and Studio removes it from
native responses anyway. A native widget response can't replace or loosen
these headers. Don't strip them at the proxy.

To show a dashboard inside another site, for example a Home Assistant panel,
set `STUDIO_FRAME_ANCESTORS` to the allowed origins, **separated by spaces,
not commas**. Each entry is `'self'` or an exact `http://` or `https://`
origin with an optional port, and no path, query, wildcard or credentials.
The list replaces the default, so include `'self'` to keep same-origin
framing. In a `.env` file or a shell, put double quotes around the whole
value so the spaces and the single quotes survive (a bare `self` is also
accepted):

```sh
STUDIO_FRAME_ANCESTORS="'self' https://ha.example.test:8123"
```

With a value set, `X-Frame-Options` is left out, because it can't name more
than one origin. Empty or unset keeps the default. An invalid entry stops the
container at startup with a message naming the variable.

A site allowed to frame the dashboard can trigger the dashboard's widget
actions, so allow only sites you trust as much as the dashboard itself.

## Checking it

From outside, through the proxy:

```bash
curl -sI https://homepage.example.test/ | grep -i -E 'frame|nosniff|referrer'
# content-security-policy: frame-ancestors 'self'
# x-frame-options: SAMEORIGIN
# x-content-type-options: nosniff
# referrer-policy: same-origin

curl -s https://homepage.example.test/__studio/application-ready
# {"status":"ready", ...}
```

And check your access control does what you mean: from a browser or network
that shouldn't get in, the page must not open.
