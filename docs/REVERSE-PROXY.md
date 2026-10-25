# Reverse proxy reference

Studio speaks plain HTTP on port 3000 and has no published port. A reverse
proxy on a shared Docker network gives it the `https://` address that Studio
sign-in needs, and is the only way in. Studio doesn't manage DNS, TLS
certificates or proxy configuration; those stay with you.

[DEPLOY.md](DEPLOY.md) walks through the default setup with Nginx Proxy
Manager (step 2 for the network, step 8 for the proxy host). This page is the
reference behind it: what any proxy must do, examples for
[Caddy](#caddy), [Traefik](#traefik) and [plain nginx](#nginx), and what to do
if your proxy can't join a Docker network.

No proxy configuration, NPM included, runs in CI. The requirements below
follow from what Studio's controller does, and CI checks them by talking to
the container directly. Check the examples against your proxy's
documentation.

## Access control

With sign-in on (the default), Studio decides who may open each dashboard
([AUTHENTICATION.md](AUTHENTICATION.md)). Your proxy only needs to provide
HTTPS. Set `STUDIO_TRUSTED_PROXIES` to the proxy's address so sign-in
throttling and the activity log see the real client address.

Extra protection in the proxy, such as a VPN or an IP allowlist, still helps.
If you use forward authentication in the proxy instead, set `STUDIO_AUTH=off`.
Then anyone who passes the proxy can view and edit every dashboard on the
host, read the configuration, including secrets written into the files,
export it, and create or archive dashboards. Dashboard addresses such as
`/admin` don't change that: they're addresses, not permissions. Protect the
**whole** origin, not selected paths: the editor API (`/studio/...`), the
native widget API (`/api/...` and `/<dashboard>/api/...`) and the shared
assets all live on it.

## What every proxy needs

| Requirement | Why |
| --- | --- |
| Serve Studio at the **root** of its own hostname (`https://homepage.example.test/`), not under a path | Dashboards are the first path segment, and the shared assets and `/studio/` endpoints are absolute. `STUDIO_PUBLIC_ORIGIN` can't have a path |
| **Pass the original `Host` header**, matching `STUDIO_PUBLIC_ORIGIN` | Studio answers only that exact host (and port). Anything else gets `403` *This dashboard address is not in HOMEPAGE_ALLOWED_HOSTS.* |
| Pass the full path and query unchanged | Don't strip or rewrite the dashboard segment. Studio picks the dashboard from the path alone, never from cookies, `Referer` or forwarded headers |
| Route the **entire** hostname to Studio | Including `/_next/static/`, `/studio/` and the icons and images at the root |
| Allow request bodies of at least **40 MiB** if you'll import dashboards | See [request limits](#request-limits). Everyday saves need far less |
| Don't compress what's already compressed | Studio serves pre-compressed Brotli/gzip build files with `Vary: Accept-Encoding`. Respect `Content-Encoding` and `Vary`; don't add a second encoding |
| A valid certificate | Your choice; Studio doesn't care, but browsers do |
| No websocket support needed | Studio has no websocket endpoints and refuses upgrade requests |

What it doesn't need: sticky sessions (there's one replica). Studio reads
`X-Forwarded-For` only from the addresses in `STUDIO_TRUSTED_PROXIES`, and
only for the client address in sign-in throttling and the activity log.

## How the proxy reaches Studio

The templates join an existing network, `homepage-studio` by default
(`STUDIO_NETWORK_NAME`), and publish no port. Your proxy joins the same network
and forwards to Studio by name:

| Deployment | Forward to |
| --- | --- |
| Swarm stack named `homepage` | `http://homepage_studio:3000` (stack name, underscore, `studio`) |
| Docker Compose | `http://homepage_studio:3000` (a fixed alias in the Compose file) |

Use the name, not a container IP address: addresses change when the container
restarts. On a Swarm the network must be an overlay network created with
`--attachable` (so a proxy started outside the stack can join it), and
preferably `--opt encrypted` ([DEPLOY.md step 2](DEPLOY.md#2-shared-proxy-network-once)).
A Swarm proxy service on the same overlay reaches Studio from any node. The
health check runs inside the container and doesn't need a port.

**`STUDIO_TRUSTED_PROXIES`.** Studio sees the proxy's address on that network
as the caller. Container addresses change when containers restart, so give
the network's subnet rather than one address:

```bash
docker network inspect homepage-studio --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
# for example 10.0.10.0/24  ->  STUDIO_TRUSTED_PROXIES=10.0.10.0/24
```

Every container on that network is then trusted to report the client address
in `X-Forwarded-For`, so keep the network to the proxy and the services behind
it. Make sure the proxy sets `X-Forwarded-For` (most do by default). To check,
sign in and open **Administration → Activity**: the Address column should show
your own device's address, not the proxy's.

### If the proxy can't join a Docker network

A proxy on the host itself, or on another machine, needs a published port.
Add one in your copy of the template. On a Swarm, publish it in host mode on
Studio's node:

```yaml
services:
  studio:
    # ...everything else unchanged...
    ports:
      - target: 3000
        published: 3000
        protocol: tcp
        mode: host
```

Swarm can't bind a host-mode port to one address, so it listens on every
interface of that node: limit who can reach it with a host firewall. With
Compose, bind it to one address instead, for example `"127.0.0.1:3000:3000"`
for a proxy on the same host ([DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md#no-proxy-in-docker)).
The templates still join the network from step 2, so it must exist. Point the
proxy at the node's address and port, and set `STUDIO_TRUSTED_PROXIES` to the
proxy's address.

## Caddy

Caddy keeps the original `Host` header, sets `X-Forwarded-For` and has no
request body limit by default, so a site block needs only the address. With
Caddy in Docker on the `homepage-studio` network:

```caddyfile
homepage.example.test {
	reverse_proxy homepage_studio:3000
}
```

Caddy gets and renews the certificate itself.

## Traefik

With Traefik's Swarm provider, the routing goes on the Studio service as
labels under `deploy:` (Swarm reads service labels only there), in your copy
of the stack. The entry point and certificate resolver names are the ones
from your Traefik configuration:

```yaml
services:
  studio:
    # ...everything else unchanged...
    deploy:
      # ...replicas, placement and the rest unchanged...
      labels:
        - traefik.enable=true
        - traefik.http.routers.homepage-studio.rule=Host(`homepage.example.test`)
        - traefik.http.routers.homepage-studio.entrypoints=websecure
        - traefik.http.routers.homepage-studio.tls.certresolver=letsencrypt
        - traefik.http.services.homepage-studio.loadbalancer.server.port=3000
        - traefik.swarm.network=homepage-studio
```

`traefik.swarm.network` is the Traefik v3 Swarm provider's label; Traefik v2
calls it `traefik.docker.network`. Traefik passes the original `Host` header
by default and has no body limit unless you add one.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name homepage.example.test;
    ssl_certificate     /etc/nginx/certs/homepage.example.test.crt;
    ssl_certificate_key /etc/nginx/certs/homepage.example.test.key;

    client_max_body_size 40m;            # Import dashboard sends up to 40 MiB

    location / {
        proxy_pass http://homepage_studio:3000;
        proxy_set_header Host $http_host;   # the exact host (and port) the browser used
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

nginx looks up `homepage_studio` when it starts, so start it after the network
exists and Studio's service is created. On a Swarm the service name stands for
a fixed virtual address, so a restarted Studio task is still reached.

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

Framing means showing a Studio dashboard inside another site's page, in an
`<iframe>`: a dashboard as a panel in Home Assistant, or as a tab in a start
page. Studio decides which sites may do it; the other site only needs a way
to show a web page.

| Who | Needs |
| --- | --- |
| Studio | The other site's origin (scheme, host and port, such as `https://ha.example.test:8123`) in `STUDIO_FRAME_ANCESTORS`, below |
| The other site | The dashboard's address, such as `https://dashboard.example.test/kitchen`. If the other site is HTTPS, Studio must be HTTPS too, or the browser blocks the frame. If the other site sends its own `Content-Security-Policy`, its `frame-src` must allow Studio's address |
| The viewer, with sign-in on | A browser that sends Studio's sign-in cookie into the frame, which needs both sites on one domain ([Framing with sign-in on](#framing-with-sign-in-on)) |

**General example.** Any page can frame a dashboard with one element, once
Studio allows that page's origin:

```html
<iframe src="https://dashboard.example.test/kitchen" title="Kitchen" style="border:0;width:100%;height:100vh"></iframe>
```

**Home Assistant.** Add a **Webpage** dashboard (**Settings → Dashboards →
Add dashboard**) or a **Webpage** card on an existing dashboard, with the
dashboard's address as its URL. Then allow Home Assistant's origin:
`STUDIO_FRAME_ANCESTORS="'self' https://ha.example.test"`. (Menu names are
Home Assistant's at the time of writing; Studio's tests don't cover them.)

**Start pages and portals** that show other sites as framed tabs work the
same way: the dashboard's address in the tab, the portal's origin in
`STUDIO_FRAME_ANCESTORS`.

### Allowing a site

By default, only pages on the same origin can show a dashboard in a frame.
Every page and response carries:

- `Content-Security-Policy: frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`.

The native runtime doesn't send `X-Powered-By`, and Studio removes it from
native responses anyway. A native widget response can't replace or loosen
these headers. Don't strip them at the proxy.

To let another site frame a dashboard, set `STUDIO_FRAME_ANCESTORS` to the
allowed origins, **separated by spaces,
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

### Framing with sign-in on

The sign-in pages never load inside a frame, so they can't be used for
clickjacking. A framed dashboard whose viewer isn't signed in shows a short
page instead: **Sign in in a new tab**, then **Reload** the frame.

Whether the frame then shows the dashboard depends on the browser sending
Studio's sign-in cookie inside the frame:

- **Same site: works.** Both addresses use HTTPS and share a registered
  domain, for example `https://ha.example.test` framing
  `https://dashboard.example.test`. Ports and subdomains don't matter.
- **Different sites: doesn't keep you signed in.** Examples are a Home
  Assistant reached by IP address (`http://192.168.1.10:8123`) or on another
  domain. Browsers don't send the cookie (`SameSite=Lax`) to a frame from
  another site, and many block such cookies anyway, so the frame keeps
  showing the sign-in page.
- **App built-in browsers.** An app's built-in browser, such as a phone
  app's dashboard view, may not share sign-in with your normal browser. If
  it opens the sign-in tab in another browser, the frame stays signed out.

To frame across sites, serve the framing site and Studio under one domain
behind the same HTTPS proxy. Alternatively, set `STUDIO_AUTH=off` and let the
proxy decide who can open Studio.

## Checking it

From outside, through the proxy:

```bash
curl -sI https://homepage.example.test/ | grep -i -E 'frame|nosniff|referrer'
# content-security-policy: frame-ancestors 'self'
# x-frame-options: SAMEORIGIN
# x-content-type-options: nosniff
# referrer-policy: same-origin

curl -s https://homepage.example.test/studio/application-ready
# {"status":"ready"}
```

And check your access control does what you mean: from a browser or network
that shouldn't get in, the page must not open.
