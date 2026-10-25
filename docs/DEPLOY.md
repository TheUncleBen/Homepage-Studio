# Deploying Homepage Studio on Docker Swarm

This guide takes you from nothing to a working Studio, top to bottom. You end
up with one Swarm stack with one service, `studio`, that:

- runs one replica on a node you pick, with its data on that node;
- reads its keys and passwords from **Docker secrets**, never from the stack's
  environment variables;
- has **no published port**: your reverse proxy reaches it over a shared,
  encrypted overlay network and is the only way in;
- has **its own sign-in** built in (accounts, passkeys, authenticator apps).
  Single sign-on through any **OpenID Connect identity provider** is an
  optional add-on.

Nothing is built on your machines. The stack pulls an image that CI has
already built and tested.

You need a Docker Swarm, an HTTPS reverse proxy, and optionally an identity
provider. The steps say what each one has to do, then show it in one common
tool as an example:

- **Deploying:** Portainer. Every Portainer step also has a command-line
  version; see [Without Portainer](#without-portainer). No Swarm, just one
  machine? [DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md) does the same with Docker
  Compose.
- **Reverse proxy:** step 8 lists what any proxy must do, with Nginx Proxy
  Manager as the example. Caddy, Traefik and plain nginx are in
  [REVERSE-PROXY.md](REVERSE-PROXY.md).
- **Identity provider:** step 4 is optional. It lists what any OpenID Connect
  provider must be set up with, with Authentik as the example. Keycloak,
  Authelia, Pocket ID and others are in [IDP-OTHERS.md](IDP-OTHERS.md).

The steps are in the order you need them. **The only place a secret ever goes
is a Docker secret.**

| Step | What you do | Where |
| --- | --- | --- |
| [1](#1-get-the-bundle) | Download the bundle | your computer |
| [2](#2-shared-proxy-network-once) | Create the network Studio shares with your reverse proxy | a Swarm manager |
| [3](#3-node-and-storage) | Pick the node and the storage | a Swarm manager |
| [4](#4-identity-provider-optional) | Optional: register Studio with your identity provider | your identity provider |
| [5](#5-docker-secrets) | Create four Docker secrets, including the administrator's password | Portainer or a Swarm manager |
| [6](#6-fill-in-the-environment-file) | Fill in the environment file | your computer |
| [7](#7-deploy-the-stack-in-portainer) | Deploy the stack | Portainer |
| [8](#8-reverse-proxy) | Add the proxy host | your reverse proxy |
| [9](#9-first-sign-in-and-checks) | Sign in as the administrator and check it works | your browser |
| [10](#10-finish-single-sign-on-in-studio-optional) | Optional: finish single sign-on and link your account | Studio |

Placeholders used below:

| Placeholder | Means |
| --- | --- |
| `homepage.example.test` | Studio's public hostname |
| `idp.example.test` | your identity provider's public hostname |
| `swarm-node-1` | the Swarm node that keeps Studio's data |
| `homepage` | the stack name. The service becomes `homepage_studio` and the volumes `homepage_config` and `homepage_state` |

## 1. Get the bundle

Download a candidate bundle or an official release and check it, as in
[VERSIONS.md](VERSIONS.md#checking-a-bundle). From the bundle you need two
files:

- `portainer-swarm.yml`, the stack. You use it **unchanged**: its `image:`
  line is already the exact digest, for example
  `ghcr.io/theuncleben/homepage-studio@sha256:...`.
- `portainer.env.example`, the settings you fill in at step 6.

If `delivery-receipt.json` says `package-access-pending`, the image can't be
pulled anonymously yet; see [VERSIONS.md](VERSIONS.md#checking-a-bundle).

Don't use `portainer-swarm.yml` from the repository itself. It has no image in
it, only `STUDIO_IMAGE` for CI to fill in.

## 2. Shared proxy network (once)

Studio has no published port. Your reverse proxy reaches it over an overlay
network that both of them join. The stack doesn't create that network, it joins it by
name, so create it first. On a Swarm manager:

```bash
docker network create --driver overlay --attachable --opt encrypted homepage-studio
docker network ls --filter name=homepage-studio   # one overlay network, scope swarm
```

What the options do:

- `--attachable` lets a proxy that runs as a plain container (not a Swarm
  service) join the network. A proxy that is a Swarm service works either
  way. You can't add this to an existing network later.
- `--opt encrypted` encrypts traffic between nodes on this network. The proxy
  ends HTTPS and talks plain HTTP to Studio, so without it sign-in cookies and
  passwords cross your LAN unencrypted whenever the proxy and Studio run on
  different nodes. The nodes must let IPsec ESP (IP protocol 50) through to
  each other, besides the usual Swarm ports (TCP 2377, TCP/UDP 7946, UDP
  4789). If the proxy can't reach Studio across nodes after this, a firewall
  dropping ESP is the likely cause. On a single-node Swarm the traffic never
  leaves the host, so the option isn't needed there.

Network names are case-sensitive. If you already have a network for your
proxy, you can use it instead: set `STUDIO_NETWORK_NAME` in step 6 to its exact
name.

**Note the network's subnet.** Studio needs it in step 6 to see each
visitor's real address behind the proxy:

```bash
docker network inspect homepage-studio --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
# for example 10.0.10.0/24
```

**Add the network to your reverse proxy.** In the proxy's own stack (or
Compose file), attach the proxy service to the network and declare it as
external. For example, for a proxy service called `proxy`:

```yaml
services:
  proxy:                      # your reverse proxy service, whatever it's called
    networks:
      - homepage-studio
networks:
  homepage-studio:
    external: true
```

Redeploy the proxy's stack. Keep this network to the proxy and the services
behind it: Studio trusts what the proxy reports about the client address
(step 6), so anything else on the network could pretend to be the proxy.

## 3. Node and storage

Studio keeps its data in two directories: `/app/config` (the dashboards) and
`/app/state` (snapshot history, accounts, sessions and the activity log). By
default they're two Docker named volumes, and a named volume lives on one
node, so the stack pins Studio to one node by hostname.

```bash
docker node ls          # the HOSTNAME column; pick one, for example swarm-node-1
```

- Use a node with local disk for Docker's volumes.
- The service runs as UID/GID 1000. New named volumes take that ownership from
  the image, so there's nothing to `chown`.
- There must only ever be one Studio writing the data: never scale the service
  above one replica. Moving to another node later means moving both volumes
  ([OPERATIONS.md](OPERATIONS.md#moving-to-another-node)).

### Host directories instead of named volumes

Set `STUDIO_CONFIG_PATH` and `STUDIO_STATE_PATH` in step 6 to absolute paths
on the node, and the stack bind mounts those instead. Use both or neither.
Create them first: Swarm refuses to start the task if a bind path doesn't
exist, and nothing in the container can fix ownership. On the node:

```bash
sudo mkdir -p /srv/homepage-studio/config /srv/homepage-studio/state
sudo chown 1000:1000 /srv/homepage-studio/config /srv/homepage-studio/state
sudo chmod 750 /srv/homepage-studio/config
sudo chmod 700 /srv/homepage-studio/state
```

If UID 1000 can't write either directory, Studio doesn't become healthy and
reports that application storage is unavailable or not writable.

### Shared storage (CephFS)

The two directories can live on a CephFS mount that every node sees. Studio
writes each file to a temporary name, flushes it with `fsync`, renames it into
place and flushes the directory. CephFS provides those ordinary POSIX
operations, and Studio uses no database or SQLite file. CI doesn't test on
CephFS, so treat it as supported by design rather than by test.

What Studio doesn't have is a lock that works across hosts. Two copies of
Studio on the same directories would overwrite each other's changes (a revoked
session coming back, or a dashboard edit disappearing). So:

- **Keep the node pin.** With shared storage, moving Studio is just changing
  `STUDIO_NODE` and updating the stack. Updates are safe as they are:
  `stop-first` stops the old task before the new one starts.
- **Don't remove the pin for automatic failover.** If a node loses contact
  with the managers but keeps running, Swarm starts a replacement elsewhere
  while the old container may still be writing.
- Make sure the CephFS mount is up before Docker starts on each node, or
  Studio writes into the empty mount point on the local disk.

## 4. Identity provider (optional)

Studio has its own accounts, so you can skip this step. You can add single
sign-on any time later: do this step, replace the `studio_oidc_client_secret`
secret (step 5) and set the identity-provider lines in step 6.

Any OpenID Connect provider works. Register Studio with it like this:

| Setting | Value |
| --- | --- |
| Client type | **Confidential**, with a client secret (authorization code flow) |
| Redirect URI | exactly `https://homepage.example.test/studio/auth/oidc/callback` |
| Scopes | `openid`, `email`, `profile` and `offline_access`. Without `offline_access` (refresh tokens) people signed in through the provider are signed out of Studio after about 15 minutes |
| Subject | a stable, per-person identifier. Never change it once people have signed in |
| Groups | Optional but recommended: a `groups` claim listing the person's group names, so Studio can make administrators and decide who may sign in |
| Email | Optional: an `email` claim marked `email_verified: true`. Studio ignores unverified addresses |

Note the provider's **issuer URL** and the **client ID**. Leave the **client
secret** where it is for now; it goes straight into a Docker secret in step 5.
Create two groups in the provider, one for Studio administrators and one for
everyone else who may sign in, and add yourself to the administrators group.

The examples below use the group names `Homepage Studio Admins` and
`Homepage Studio Users`; use any names you like.

### Example: Authentik

The short version. Every field, what it does, and what to do when sign-in
fails are in [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md). For other providers, see
[IDP-OTHERS.md](IDP-OTHERS.md). In the Authentik admin interface:

1. **Directory → Groups → Create** two groups: `Homepage Studio Admins`
   (people who administer Studio) and `Homepage Studio Users` (everyone else
   who may sign in). Add yourself to the admins group.
2. **Applications → Providers → Create → OAuth2/OpenID Provider**:
   - Name: `Homepage Studio`.
   - Authorization flow: `default-provider-authorization-implicit-consent`.
   - Client type: **Confidential**.
   - Redirect URIs: one entry, matching mode **Strict**,
     `https://homepage.example.test/studio/auth/oidc/callback`.
   - Signing key: `authentik Self-signed Certificate` (or another certificate
     you manage). Don't leave it empty.
   - **Advanced protocol settings → Scopes**: `openid`, `email`, `profile`
     **and** `offline_access` (the built-in `authentik default OAuth Mapping:
     OpenID '…'` mappings).
   - Subject mode: **Based on the User's hashed ID** (the default). Keep it.
   - Optional: so Studio uses people's Authentik email addresses, replace the
     `email` mapping with one that marks them verified
     ([IDP-AUTHENTIK.md section 4](IDP-AUTHENTIK.md#email-addresses)). Since
     Authentik 2025.10 the built-in mapping says they aren't, and Studio then
     ignores them.
   - Note the **Client ID**.
3. **Applications → Applications → Create**: name `Homepage Studio`, slug
   `homepage-studio`, provider `Homepage Studio`, launch URL
   `https://homepage.example.test/`. Then, on the application, **Policy /
   Group / User Bindings → Bind existing policy/group/user**: bind both groups.
   Only people in a bound group get past Authentik.
4. Open the provider again and copy the **OpenID Configuration Issuer**. With
   slug `homepage-studio` it's
   `https://idp.example.test/application/o/homepage-studio/`.

## 5. Docker secrets

The stack expects four Swarm secrets with exactly these names. Each must
exist before you deploy, so a feature you don't use gets the word `off`.

| Secret name | What goes in it |
| --- | --- |
| `studio_auth_key` | Long random text that encrypts authenticator-app secrets and single sign-on tokens in Studio's state. **Keep a copy** in your password manager. If it's lost or changed, everyone sets up their authenticator app again and single sign-on sessions end |
| `studio_oidc_client_secret` | The **client secret** from your identity provider (step 4), or the word `off` if you don't use single sign-on |
| `studio_smtp_password` | Your mail server password, or the word `off` if you don't use email (or your mail server needs no password) |
| `studio_admin_password` | The password for the first administrator account, at least 12 characters. Studio creates that account once, on the first start, with the username you set in step 6, and never reads this secret again. Put `off` to create the administrator in the browser instead (step 9) |

Make random values on your own machine when you need them. They go only into
the secret, never into the stack's environment variables, a file you keep
around, or a chat. Pick one of the two ways below.

### Option A: in Portainer

1. On any machine with `openssl` (Linux, macOS, WSL or Git Bash), make the
   encryption key:

   ```bash
   openssl rand -base64 48
   ```

2. In Portainer, pick your Swarm environment, then **Secrets → Add secret**.
3. Name `studio_auth_key`, paste the key into **Secret**, leave **Encode
   secret** on (the default), and click **Create the secret**. Save the key in
   your password manager now.
4. Do the same for `studio_oidc_client_secret` (paste the client secret
   straight from your identity provider, or type `off`), `studio_smtp_password` (the mail
   password, or `off`) and `studio_admin_password` (a password you choose for
   the administrator, saved in your password manager, or `off`).
5. Clear your terminal (`clear`) so the key isn't left on screen.

### Option B: on a Swarm manager

This creates the same four secrets, each only if it doesn't exist yet, so
it's safe to run again. Nothing is written to disk or your shell history.

```bash
# Runs the rest of the line only when the secret named first doesn't exist yet.
missing() { if docker secret inspect "$1" >/dev/null 2>&1; then echo "$1 already exists"; false; fi; }

# 1. studio_auth_key. Prints the key once so you can save a copy, then creates the secret.
missing studio_auth_key && openssl rand -base64 48 | tee /dev/stderr | docker secret create studio_auth_key -

# 2. studio_oidc_client_secret. Paste the identity provider's client secret (or type off)
#    at the silent prompt and press Enter.
missing studio_oidc_client_secret && read -rs S && printf %s "$S" | docker secret create studio_oidc_client_secret - ; unset S

# 3. studio_smtp_password. Type the mail password (or off) and press Enter.
missing studio_smtp_password && read -rs S && printf %s "$S" | docker secret create studio_smtp_password - ; unset S

# 4. studio_admin_password. Type the administrator's password (or off) and press Enter.
missing studio_admin_password && read -rs S && printf %s "$S" | docker secret create studio_admin_password - ; unset S
```

Either way, Portainer's **Secrets** page (or `docker secret ls`) now lists all
four. Studio ignores a trailing newline in a secret.

**Changing a secret later.** Swarm secrets can't be edited. Remove the stack
(your volumes stay), delete the secret, create it again with the same name and
the new value, and deploy the stack again. That's how you add single sign-on
or email later: replace `off` with the real value. Don't change `studio_auth_key`
unless you mean to: it resets everyone's authenticator app.
`studio_admin_password` never needs changing: once any account exists Studio
ignores it, and you change your password under **My account**.

## 6. Fill in the environment file

Copy the bundle's `portainer.env.example` to a file on your computer, say
`homepage.env`, and change the lines marked `REQUIRED`. The comments in the
file explain every other line; everything not listed here can stay at its
default. **No secret values go in this file.**

| Variable | What to put |
| --- | --- |
| `STUDIO_PUBLIC_ORIGIN` | The address people will type, `https://homepage.example.test`. Scheme and hostname only, no path. It must be the hostname you give your reverse proxy in step 8 |
| `STUDIO_NODE` | The node from step 3, exactly as `docker node ls` shows it |
| `STUDIO_TRUSTED_PROXIES` | Recommended: the subnet from step 2, for example `10.0.10.0/24`. Remove the `# ` in front of the line |
| `STUDIO_NETWORK_NAME` | Only if your network isn't called `homepage-studio` |
| `STUDIO_CONFIG_PATH`, `STUDIO_STATE_PATH` | Only for host directories (step 3) |
| `STUDIO_ADMIN_USERNAME` | Recommended: the first administrator's username, for example `admin`. Its password is the `studio_admin_password` secret. Leave it unset if that secret says `off` |
| `STUDIO_ADMIN_EMAIL` | Optional: that administrator's email. Once you link the account to your identity provider (step 10) it follows the provider's email |

With single sign-on (step 4), also uncomment and fill in:

| Variable | What to put |
| --- | --- |
| `STUDIO_OIDC_ISSUER` | The issuer URL from step 4, for example `https://idp.example.test/application/o/homepage-studio/` with Authentik |
| `STUDIO_OIDC_CLIENT_ID` | The client ID from step 4 |
| `STUDIO_OIDC_NAME` | Optional: the provider's name on the sign-in button, for example `Authentik` (default `Single sign-on`) |
| `STUDIO_OIDC_ADMIN_GROUPS` | Recommended: your administrators group, for example `Homepage Studio Admins`. Members are Studio administrators from their first single sign-on |
| `STUDIO_OIDC_ALLOWED_GROUPS` | Recommended: your users group, for example `Homepage Studio Users`. Only members of these groups (and the admin groups) may sign in through the provider |

The two group lists are comma-separated and spelled exactly as the provider
sends them.
Set here, Studio shows them read-only; leave them unset to fill them in under
**Administration → Sign-in settings** instead (step 10).

The client secret is already in the `studio_oidc_client_secret` secret. For
email, fill in the `STUDIO_SMTP_…` lines; the password is already in
`studio_smtp_password`.

`STUDIO_PUBLIC_ORIGIN` matters more than it looks. Studio answers only
requests for exactly that host, and the browser's address must match it, so
`https://homepage.example.test` through your proxy works and anything else (an
IP address, another hostname) is refused. Sign-in needs `https://`.

## 7. Deploy the stack in Portainer

1. **Stacks → Add stack**, name it `homepage`. (The service names in these
   guides assume that name. With another name the service is
   `<name>_studio`.)
2. **Build method: Web editor**. Paste the bundle's `portainer-swarm.yml`
   unchanged. You don't need to edit it: everything you set lives in the
   environment variables.
3. Under **Environment variables**, either click **Load variables from .env
   file** and pick `homepage.env`, or switch to **Advanced mode** and paste the
   file's contents. Check the list Portainer shows: each variable once, with
   the value you expect. There's no `STUDIO_IMAGE` to set; the stack already
   has the image.
4. Click **Deploy the stack**.

The first start takes up to a couple of minutes (the health check allows 120
seconds). It's up when the `homepage_studio` service's task is running and
its container reports `healthy`. To watch it from a manager:

```bash
docker service ps homepage_studio
docker service logs --tail 50 homepage_studio
```

If the task doesn't start, `docker service ps --no-trunc homepage_studio`
shows why. The usual causes are a secret or the network that doesn't exist
yet, or a host directory that doesn't exist. See
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#the-container-doesnt-start).

What the stack does, so you don't have to:

| In the stack | Why |
| --- | --- |
| Three external secrets, read from `/run/secrets/...` | Keys and passwords never appear in the stack's environment, Portainer's stack view or `docker inspect` |
| No `ports:`, joins the external network | Nothing reaches Studio except through the proxy on that network |
| One replica, `node.hostname == STUDIO_NODE` | One writer, on the node that holds the data |
| `order: stop-first` for updates and rollbacks, `failure_action: rollback`, 180-second monitor | The old container stops before the new one starts on the same volumes; a new version that doesn't become healthy is rolled back |
| `stop_grace_period: 30s` | Time to finish saves and stop workers cleanly |
| `init: true` | A small init process reaps stopped worker processes |
| `cap_drop: [ALL]` | The application runs as UID 1000 and needs no Linux capabilities |

`docker stack deploy` ignores `security_opt`, so the stack can't set
`no-new-privileges`; the image contains no setuid or file-capability programs
instead. A read-only root filesystem isn't tested yet, so the stack doesn't
set one. If you add memory or CPU limits, leave room for the number of workers
you allow ([OPERATIONS.md](OPERATIONS.md#workers-and-limits)).

### Without Portainer

On a Swarm manager, in the folder with the bundle. `docker stack deploy`
doesn't read `.env` files, so load the file into the shell first:

```bash
cp portainer.env.example homepage.env    # then edit the REQUIRED lines
set -a; . ./homepage.env; set +a         # exports every line that isn't a comment
docker stack deploy --compose-file portainer-swarm.yml homepage
docker service ps homepage_studio        # wait for Running
```

### Updating

[UPGRADING.md](UPGRADING.md) has the steps. In short: **Stacks → homepage →
Editor**, replace the whole text with the new bundle's `portainer-swarm.yml`,
keep your environment variables, **Update the stack**. Your secrets, network
and volumes stay as they are.

## 8. Reverse proxy

Add one proxy host for Studio. Whatever the proxy, it must:

| What | Value |
| --- | --- |
| Hostname | `homepage.example.test`, the hostname in `STUDIO_PUBLIC_ORIGIN` |
| Forward to | `http://homepage_studio:3000`: the full Swarm service name (stack name, underscore, `studio`), which resolves on the network from step 2. Not an IP address, which changes when the task restarts |
| HTTPS | A certificate for the hostname, with plain HTTP redirected to HTTPS. HSTS is recommended |
| Headers | Pass the original `Host` header and the full path, and set `X-Forwarded-For` |
| Request size | Allow request bodies of at least 40 MiB, for **Import dashboard** |
| WebSockets | Not needed. Studio has no websocket endpoints and refuses upgrade requests |
| Access rules | None needed: Studio's sign-in decides who gets in. An allow list (for example your LAN only) still works as an extra layer |

The full list, and complete examples for Caddy, Traefik and plain nginx, are in
[REVERSE-PROXY.md](REVERSE-PROXY.md#what-every-proxy-needs). That's the only
thing you expose: one proxy host serves every dashboard (`/home`, `/kitchen`
and so on), the Dashboards page, the editor and the sign-in pages.

### Example: Nginx Proxy Manager

**Hosts → Proxy Hosts → Add Proxy Host**:

**Details tab**

| Field | Value |
| --- | --- |
| Domain Names | `homepage.example.test` |
| Scheme | `http` |
| Forward Hostname / IP | `homepage_studio` |
| Forward Port | `3000` |
| Websockets Support | off |
| Access List | none needed |

**SSL tab:** request a Let's Encrypt certificate (or pick yours), and turn on
**Force SSL**, **HTTP/2 Support** and **HSTS Enabled**. HSTS makes browsers
refuse plain-HTTP visits from then on. Turn on **HSTS Subdomains** only if
every subdomain of the domain serves HTTPS.

**Advanced tab**, custom Nginx configuration:

```nginx
client_max_body_size 40m;
```

An import over the proxy's limit fails with `413`; nginx's default is 1 MiB.
Nginx Proxy Manager's defaults cover the headers.

### Checking the proxy

**A `502 Bad Gateway`** from the proxy means it can't reach Studio. Check
that the proxy's stack has the network from step 2 (exact name) and was
redeployed after you added it, and that the forward hostname is right. From
the node running the proxy:

```bash
docker exec <proxy container> curl -s -H 'Host: homepage.example.test' http://homepage_studio:3000/studio/application-ready
# {"status":"ready"}
```

If the proxy's image has no `curl`, use `wget -qO- --header 'Host: homepage.example.test' ...`
instead. The `Host` header is needed because Studio answers only its own
hostname. Without it you get *This dashboard address is not in
HOMEPAGE_ALLOWED_HOSTS*, which still proves the proxy can reach Studio.

## 9. First sign-in and checks

From any machine:

```bash
curl -s https://homepage.example.test/studio/application-ready
# {"status":"ready"}
```

Then open `https://homepage.example.test/` in a browser.

**With `STUDIO_ADMIN_USERNAME` and the `studio_admin_password` secret** (the
recommended setup), Studio created that administrator on its first start and
the open setup page is off:

1. Sign in with that username and password.
2. Studio asks for a second step before anything else: add a **passkey**, an
   **authenticator app**, or both. Keep the backup codes Studio shows you
   somewhere safe.
3. You land on **Administration**. From then on the bare address,
   `https://homepage.example.test/`, opens **Dashboards**: the list of
   dashboards, where you open, edit and set up each one. The first dashboard
   is at `/home`.

The password alone gets nobody further than step 2, but finish it now anyway.
Studio never reads the secret again, so changing it later changes nothing.

**Without them** (the secret says `off`), a fresh Studio asks the first visitor
to create the administrator account, so do it **straight away**, before anyone
else can: pick a username and password, add a passkey or authenticator app, and
keep the backup codes.

Then check two things under **Administration**:

- **Sign-in settings** shows no warning that `STUDIO_AUTH_KEY` is not set. If
  it does, the `studio_auth_key` secret isn't reaching Studio.
- **Activity** shows your own device's address in the Address column, not
  the proxy's. If it shows the proxy's, `STUDIO_TRUSTED_PROXIES` doesn't match
  the network's subnet (step 2).

Inviting people, sharing dashboards and session policies are in
[AUTHENTICATION.md](AUTHENTICATION.md). If something's off, start with
`docker service logs --tail 100 homepage_studio` and
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 10. Finish single sign-on in Studio (optional)

Only if you set up an identity provider in step 4. Signed in as the
administrator, open **Administration → Sign-in settings**. The single sign-on
section (named after `STUDIO_OIDC_NAME`) shows the redirect URI Studio
expects; it must match the one registered with the provider exactly. The
group names below are the examples from step 4.

1. **Groups.** If you set `STUDIO_OIDC_ADMIN_GROUPS` and
   `STUDIO_OIDC_ALLOWED_GROUPS` in step 6, they're already filled in and
   locked. Otherwise enter your administrators group (`Homepage Studio
   Admins`) under **Administrator groups** and your users group (`Homepage
   Studio Users`) under **Allowed groups**. Leave **Create a Studio account
   the first time someone signs in** on, and click **Save single sign-on
   settings**.
2. **Share dashboards before anyone signs in.** The listed groups appear under
   **Administration → Groups** straight away; add any other provider group
   there by its exact name. Then share dashboards with those groups under
   **Dashboard access**, and give each group a default dashboard under
   **Groups → Manage**. People get them at their very first sign-in.
3. **Link your administrator account to the provider**, so either one signs
   you in and the local account is your way in when the provider is down:
   **My account → Link** (the button names your provider), sign in there, and
   confirm on the page that follows. Your local password stays as it is, and
   the account's email changes to the provider's email and follows it from
   then on. Signed in through the provider already? Use **My account → Link a
   local account** instead; the separate account Studio made for you is merged
   into the local one.
4. In a private window, open Studio and choose single sign-on. Sign in as
   someone in your users group: you should land on that group's default
   dashboard, or on **Dashboards** listing the dashboards shared with it.

Once single sign-on works, you can make it the only way in (**Allow local
sign-in** off). [AUTHENTICATION.md](AUTHENTICATION.md) explains each setting
and linking; [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md#7-finish-in-studio) and
[IDP-OTHERS.md](IDP-OTHERS.md) cover what to check when the sign-in fails.

## Widget API keys as Docker secrets

Homepage's own ways of keeping secrets out of the dashboard files work here:
`{{HOMEPAGE_FILE_NAME}}` in a widget's settings reads the file named by the
container's environment variable `HOMEPAGE_FILE_NAME`, and
`{{HOMEPAGE_VAR_NAME}}` takes the value of the variable `HOMEPAGE_VAR_NAME`.
Use the file form with a Docker secret for API keys and passwords: a value
written straight into a widget stays in the snapshot history after you change
it ([OPERATIONS.md](OPERATIONS.md#snapshots-and-secrets)).

The names are yours, so the stack doesn't have them. To add one, for example
a Proxmox token:

1. Create the secret (Portainer **Secrets → Add secret**, or
   `read -rs S && printf %s "$S" | docker secret create homepage_proxmox_token - ; unset S`).
2. In the stack editor, add it next to the other secrets, both at the top level
   and on the service, and point a variable at it:

   ```yaml
   secrets:
     # ...the three Studio secrets...
     homepage_proxmox_token:
       external: true
   services:
     studio:
       secrets:
         # ...the three Studio secrets...
         - homepage_proxmox_token
       environment:
         # ...
         HOMEPAGE_FILE_PROXMOX_TOKEN: /run/secrets/homepage_proxmox_token
   ```

3. Update the stack, then use `{{HOMEPAGE_FILE_PROXMOX_TOKEN}}` in the
   widget's settings.

Keep your additions when you paste a new bundle's stack at an update. One
container serves every dashboard, so these values are available to all of
them; each dashboard chooses which ones it uses.

The stack mounts no Docker socket and assumes no services. For Docker
discovery or Docker widgets, configure `docker.yaml` as in Homepage's
documentation. The container runs as UID 1000 without capabilities, so a
mounted socket must be readable by that user; a Docker socket proxy reached
over the network (the `host`/`port` form in `docker.yaml`) avoids mounting the
socket at all.

## Environment reference

Everything the stack passes to Studio. `portainer.env.example` lists the same
variables with a short comment each.

| Variable | Default | Notes |
| --- | --- | --- |
| `STUDIO_PUBLIC_ORIGIN` | (required) | Exact `https://` origin, with the port when it isn't 443. No path, query, wildcard or credentials. The container won't start with anything else |
| `STUDIO_NODE` | (required) | Swarm placement: the node that keeps the data |
| `STUDIO_NETWORK_NAME` | `homepage-studio` | The existing network shared with the reverse proxy |
| `STUDIO_TRUSTED_PROXIES` | (unset) | Comma-separated IP addresses or CIDR ranges of your reverse proxy, usually the network's subnet. Studio then takes the client address from `X-Forwarded-For` for sign-in throttling and the activity log |
| `STUDIO_CONFIG_PATH`, `STUDIO_STATE_PATH` | the named volumes `config` and `state` | Absolute host directories to bind mount instead ([step 3](#host-directories-instead-of-named-volumes)) |
| `STUDIO_SECRETS_DIR` | (required for Compose) | Docker Compose only: the folder with the four secret files ([DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md)). The Swarm stack doesn't use it |
| `STUDIO_AUTH` | `on` | `off` only if your proxy already decides who may open Studio ([AUTHENTICATION.md](AUTHENTICATION.md#turning-sign-in-off)) |
| `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` | (unset) | Single sign-on with any OpenID Connect provider; both together, plus the `studio_oidc_client_secret` secret ([step 4](#4-identity-provider-optional)) |
| `STUDIO_ADMIN_USERNAME`, `STUDIO_ADMIN_EMAIL` | (unset) | The first administrator, created once with the `studio_admin_password` secret ([AUTHENTICATION.md](AUTHENTICATION.md#first-start-the-administrator)) |
| `STUDIO_OIDC_ADMIN_GROUPS`, `STUDIO_OIDC_ALLOWED_GROUPS` | (unset) | Comma-separated identity-provider groups for administrators and for who may sign in. Set here, they're read-only in Studio |
| `STUDIO_OIDC_NAME`, `STUDIO_OIDC_SCOPES`, `STUDIO_OIDC_GROUPS_CLAIM`, `STUDIO_OIDC_REFRESH_MINUTES`, `STUDIO_OIDC_ALLOW_HTTP` | see [AUTHENTICATION.md](AUTHENTICATION.md#settings-reference) | Rarely changed |
| `STUDIO_SMTP_HOST`, `STUDIO_SMTP_PORT`, `STUDIO_SMTP_SECURE`, `STUDIO_SMTP_USER`, `STUDIO_SMTP_FROM_ADDRESS`, `STUDIO_SMTP_FROM_NAME` | (unset) | Email, plus the `studio_smtp_password` secret ([AUTHENTICATION.md](AUTHENTICATION.md#email)) |
| `STUDIO_FRAME_ANCESTORS` | empty | Space-separated `'self'` and exact origins allowed to show a dashboard in a frame ([REVERSE-PROXY.md](REVERSE-PROXY.md#framing)) |
| `STUDIO_BACKUP_RETENTION` | `25` | Snapshots kept per dashboard |
| `STUDIO_RENDERER_MAX_WORKERS` | `8` | Dashboards with a running worker at once, 1 to 64 |
| `STUDIO_RENDERER_IDLE_SECONDS` | `600` | Seconds before an idle dashboard's worker stops, up to 86400 |
| `STUDIO_RENDERER_STARTUP_SECONDS` | `30` | Seconds a worker may take to start, up to 120 |

Set by the stack itself, not by you: `STUDIO_AUTH_KEY_FILE`,
`STUDIO_OIDC_CLIENT_SECRET_FILE`, `STUDIO_SMTP_PASSWORD_FILE` and
`STUDIO_ADMIN_PASSWORD_FILE` (the paths of the four secrets), and `LOG_TARGETS=stdout`. Your own `HOMEPAGE_FILE_*` and
`HOMEPAGE_VAR_*` variables are [above](#widget-api-keys-as-docker-secrets).

The image fixes the paths (`/app/config`, `/app/state`), the internal port
(3000) and the native runtime settings, and the entrypoint derives the allowed
host and the health check's host from `STUDIO_PUBLIC_ORIGIN`. Homepage's own
authentication and its configuration writes are turned off: Studio is the only
thing that writes the configuration, and Studio sign-in decides access.
