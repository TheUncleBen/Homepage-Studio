# Sign-in and access control

Studio has its own sign-in. People get accounts, and each dashboard is shared
with the people or groups who should see it. Single sign-on through Authentik
or any other OpenID Connect provider works alongside local accounts or
replaces them.

Sign-in is **on by default**. It needs an `https://` address. Turn it off
(`STUDIO_AUTH=off`) only when something in front of Studio already decides
who may open it, such as forward authentication in your reverse proxy.

## Contents

- [What people can do](#what-people-can-do)
- [First start: the administrator](#first-start-the-administrator)
- [Inviting people and sharing dashboards](#inviting-people-and-sharing-dashboards)
- [Signing in](#signing-in)
- [Session policies](#session-policies)
- [Single sign-on with Authentik or another provider](#single-sign-on-with-authentik-or-another-provider)
- [Email](#email)
- [Settings reference](#settings-reference)
- [Lost access: command-line recovery](#lost-access-command-line-recovery)
- [Activity log](#activity-log)
- [How it is protected](#how-it-is-protected)
- [Turning sign-in off](#turning-sign-in-off)

## What people can do

There are two roles, and each dashboard is shared at one of two levels.

| | Can do |
| --- | --- |
| **Administrator** | Everything: every dashboard, widget and integration settings, the raw configuration files, custom CSS and JavaScript, imports, exports and snapshots, other dashboards, people, groups, sharing and sign-in settings |
| **Member, Can view** | Open the dashboard and use its widgets |
| **Member, Can arrange** | Also move, resize and stack tiles, hide or show discovered services, and change the dashboard's appearance (dark, light or device, and the accent color) |
| **Member, not shared** | Nothing. The dashboard looks exactly like an address that doesn't exist |

Widget and integration settings are deliberately administrator-only. A
widget's settings can refer to any secret given to the container
(`{{HOMEPAGE_VAR_...}}` and `{{HOMEPAGE_FILE_...}}`), and custom JavaScript
runs for everyone who opens the dashboard, so the ability to change either is
the ability to read every secret or act as every viewer.

Studio checks every request on the server. The dashboard also hides the
controls a person can't use, but hiding is only a convenience.

## First start: the administrator

Until an administrator exists, every dashboard is locked. There are two ways
to make the first one.

### Prepared by the deployment (recommended)

Set `STUDIO_ADMIN_USERNAME` (and optionally `STUDIO_ADMIN_EMAIL`) in the
stack, and put the password in the `studio_admin_password` Docker secret
([DEPLOY.md step 5](DEPLOY.md#5-docker-secrets)). On its first start, Studio
creates that administrator account, and the open setup page below never
appears.

1. Open the dashboard's address and sign in with that username and password.
2. Studio asks for a second step straight away: a **passkey**, an
   **authenticator app**, or both. Until you add one, the password gets you no
   further than that page.
3. Save the ten **backup codes**.

Studio uses the seed **once**. As soon as any account exists, it ignores
`STUDIO_ADMIN_USERNAME`, `STUDIO_ADMIN_EMAIL` and the secret on every start
(the log says so), so changing your password or email in Studio, or linking
the account to Authentik, never clashes with what the deployment says. A
password that's too short or too common, or a username without a password,
stops Studio from starting, with the reason in the log.

The intended setup is that this local administrator is then **linked to your
Authentik administrator account** ([Linking](#linking-a-local-account-and-a-provider-account)):
day to day you sign in with Authentik, and the local account is the way in
when Authentik is down.

### Created in the browser

Without a seed (`studio_admin_password` says `off`), the first person to open
a fresh deployment (or one updated from a version without sign-in) is asked
to create the administrator. Every address leads to the setup page until
that's done.

1. Open the dashboard's address. You land on **Create the administrator**.
2. Choose a username and a password of at least 12 characters.
3. Add a second step: a **passkey** (fingerprint, face or device PIN), an
   **authenticator app**, or both.
4. Save the ten **backup codes**. Each signs you in once if you lose your
   passkey or phone. They aren't shown again.

**Do this straight after deploying.** Whoever completes the setup page first
becomes the administrator, and there is no setup code. While one browser is
part-way through setup, another can't start it for 30 minutes. The browser
that started can reload the page and carry on where it left off. Restarting
Studio also cancels a setup that was started but not finished.

## Inviting people and sharing dashboards

Open **Administration** (from the account button in the dashboard's top bar,
then **Administration**, or `/__studio/admin`).

- **People → Invite a person.** Enter a username, optionally a display name
  and email, and choose Member or Administrator. Studio makes a one-time
  link that's valid for 72 hours. Send it privately; whoever opens it first
  claims the account. With email set up, Studio can send it for you.
- The invited person opens the link, chooses a password and adds a passkey or
  authenticator app, the same as the administrator did.
- **Dashboard access.** For each dashboard, add people or groups and choose
  **Can view** or **Can arrange**, then **Save access**. Administrators always
  have access.
- **Groups** share a dashboard or apply a session policy to several people at
  once. Groups from your identity provider appear automatically.
- When you duplicate a dashboard (**Dashboard settings → Manage dashboards**),
  tick **Share it with the same people and groups** to copy its access list.

Under **People → Manage** you can change someone's role, groups and session
policy, disable the account (which signs them out at once), sign them out
everywhere, reset their sign-in (which removes their password, passkeys,
authenticator and backup codes and makes a new one-time link), or delete them.
Studio always keeps at least one active administrator.

## Signing in

A local account signs in with either:

- **a passkey** on its own, because a passkey with a fingerprint, face or PIN
  is already two factors; or
- **a password plus a second step**: an authenticator code, a passkey, a
  backup code or, if the administrator allows it, an emailed code.

A password alone never signs anyone in. Failed attempts slow down sign-in
from that address and for that account (after five failures, waits double
up to 15 minutes); they never lock the real owner out for good.

Everyone can manage their own sign-in under **My account**
(`/__studio/account`): change the password, add or remove passkeys and the
authenticator app, make new backup codes, see where they're signed in and sign
other devices out. Studio insists on keeping a passkey, or a password with an
authenticator app, so no one locks themselves out by accident.

Changing sign-in methods, the email address, people, sharing or settings, and
administrator actions such as raw file saves, imports, exports and restores
ask you to **confirm it's you** if you signed in more than a short while ago
(15 minutes by default). In the dashboard editor, the confirmation opens in a
new tab so unsaved changes stay put; confirm there, come back and save again.

Dashboards shown inside another site's frame (`STUDIO_FRAME_ANCESTORS`) need
the viewer signed in. That only carries into the frame when both sites share a
domain; see [framing with sign-in on](REVERSE-PROXY.md#framing-with-sign-in-on).

## Session policies

**Administration → Session policies** decides how long people stay signed in.

| Setting | Default | Range |
| --- | --- | --- |
| Sign out after inactivity | 7 days | 5 minutes to 90 days, or never |
| Maximum session length | 30 days | 1 hour to 365 days, or no limit |
| Stay signed in after the browser closes | Allowed | When people tick **Keep me signed in** |
| Confirm it's you after | 15 minutes | 5 to 60 minutes |
| Devices at once | Unlimited | 1 to 50; one more ends the oldest |

A policy chosen for a person wins. Otherwise the **strictest** value of each
setting across their groups' policies applies; otherwise the default policy.

## Single sign-on with Authentik or another provider

Studio is an OpenID Connect relying party. It uses the authorization code flow
with PKCE, checks state and nonce, and verifies the provider's signed tokens.

### Setting it up

1. Create a confidential OpenID Connect client at the provider with the
   redirect URI `https://<your Studio address>/__studio/auth/oidc/callback`,
   and the scopes `openid`, `email`, `profile` and `offline_access`.
   [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md) has every Authentik field;
   [IDP-OTHERS.md](IDP-OTHERS.md) covers other providers.
2. Put the client secret in the `studio_oidc_client_secret` Docker secret
   ([DEPLOY.md step 5](DEPLOY.md#5-docker-secrets)).
3. Set the issuer and client ID in the stack's environment:

```env
STUDIO_OIDC_ISSUER=https://authentik.example.test/application/o/<application-slug>/
STUDIO_OIDC_CLIENT_ID=<client ID>
```

Studio reads the provider's settings from
`<issuer>/.well-known/openid-configuration` when someone first signs in with
it. Since Authentik 2024.2, the provider issues a refresh token only when the
client asks for `offline_access` and the provider has that scope mapping
selected. Without a refresh token, Studio can't check groups while someone is
signed in, so provider sessions end at the first check (15 minutes by default)
and people sign in again. The optional back-channel logout URI
(`/__studio/auth/oidc/backchannel-logout`) lets signing out of the provider
end Studio sessions too.

### In Studio

**Administration → Sign-in settings:**

- **Administrator groups**: people in these provider groups become
  administrators. Provider accounts outside them are members. The role is
  checked again at every sign-in and every 15 minutes while signed in
  (`STUDIO_OIDC_REFRESH_MINUTES`), using the provider's refresh token. If the
  last provider sign-in returned no refresh token, this page says so. If the
  provider is unreachable at a check, Studio tries again each minute; after
  one more full interval without an answer, the session ends. If the provider
  refuses the refresh token, the session ends at once.
  While administrator groups are set, they alone decide the role of provider
  accounts. Without administrator groups, you set provider accounts' roles on
  the People page.
- **Allowed groups**: if set, only people in one of these groups (or an
  administrator group) may sign in. Removing someone from the group in the
  provider ends their Studio session at the next check.
- **Create a Studio account the first time someone signs in**: on by default,
  but only for people in an allowed group or an administrator group. While
  both lists are empty, nobody new is created, so fill in at least one of them
  before anyone else signs in for the first time. Accounts that already exist
  and linked accounts still sign in. Anyone else is told to ask an
  administrator. Turn the setting off to require an invitation for everyone;
  the invited person links their provider account from **My account**.

**Set by the deployment.** `STUDIO_OIDC_ADMIN_GROUPS` and
`STUDIO_OIDC_ALLOWED_GROUPS` (comma-separated) fill in the two lists from the
stack. While one is set, it's shown read-only here and only the deployment
changes it, so the stack and Studio can't disagree. Unset, the list is edited
on this page; it keeps the last value the deployment gave it.

**Sharing before anyone signs in.** A provider group appears under
**Administration → Groups** when someone in it signs in, and every group named
in the two lists is there from the start. Add any other provider group by its
exact name with **Add Authentik group**. Share dashboards with these groups
under **Dashboard access**, and people get them at their first sign-in, with
the role their groups give them.

### Linking a local account and a provider account

Accounts are matched by the provider's issuer and subject identifier only,
never by email or username, so a matching email at the provider can't take
over a local account, and nothing is ever linked automatically. A person links
their **own** two accounts, and has to prove both in the same browser within
5 minutes:

- **Signed in locally:** **My account → Link Authentik account**. If you
  signed in more than 5 minutes ago, confirm it's you first.
- **Signed in through the provider:** **My account → Link a local account**,
  then sign in to the local account there (its password and second step, or
  its passkey).

Either way Studio then sends you to the provider with a request to sign in
again (`prompt=login`, `max_age=300`) and refuses an ID token whose sign-in is
older than 5 minutes. Back in Studio, a confirmation shows both accounts and
what will change; nothing changes until you click **Link accounts**:

- Either account signs you in to the same Studio account from then on. The
  local password, passkeys, authenticator and backup codes stay exactly as
  they were.
- The local email takes the provider's **verified** email, and follows it at
  every provider sign-in; it's read-only in Studio while linked. An email the
  provider doesn't mark as verified is never used (see
  [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md#email-addresses)), and **Sign-in
  settings** warns when the last sign-in sent one.
- If Studio already made a separate account for that provider identity (you
  signed in with the provider before linking), it's **merged** into the local
  account: its dashboard shares and local groups move over and it's removed.
- Other signed-in devices of both accounts are signed out, and a security
  alert goes to the old and the new email address.

Nobody, administrators included, can link someone else's accounts.
**Unlink** on the same page (or **More actions → Unlink** for an administrator
on the People page) removes the link and ends the provider sessions; the
email becomes editable again. An administrator's **Reset sign-in** also
removes it.

A linked local account is an administrator through provider groups only
while it's signed in through the provider. Signed in locally, it has the role
set on the People page.

### Turning local sign-in off

Once single sign-on works, you can make it the only way in: **Sign-in settings
→ Allow local sign-in**. Studio lets you do this only while you're signed in
through the provider as someone in an administrator group, which proves the
provider works before local access goes away. Turning it off ends local
sessions. [Command-line recovery](#lost-access-command-line-recovery) still
works if the provider breaks.

### Other providers

Any provider that supports OpenID Connect discovery and the authorization code
flow should work: set `STUDIO_OIDC_NAME` to the name shown on the sign-in
button. If your provider names the groups claim differently, set
`STUDIO_OIDC_GROUPS_CLAIM`. [IDP-OTHERS.md](IDP-OTHERS.md) has the checklist
and notes for Keycloak, Authelia and others; only Authentik's behaviour is
modelled in Studio's tests.

## Email

Email is optional. With it, Studio can send invitations, password-reset links,
security alerts (for example when a passkey is added or a backup code is
used) and, if an administrator allows it, sign-in codes. Without it,
administrators send invitation links themselves and reset accounts from
**People**.

```env
STUDIO_SMTP_HOST=smtp.example.test
STUDIO_SMTP_PORT=587                  # 465 uses TLS from the start; other ports must offer STARTTLS
STUDIO_SMTP_USER=studio@example.test
STUDIO_SMTP_FROM_ADDRESS=studio@example.test   # a sender your mail provider has verified
STUDIO_SMTP_FROM_NAME=Homepage Studio           # the name people see; this is the default
```

The sender's name and address are separate, so mail shows the name rather
than the bare address. Most mail providers refuse a sender address they
haven't verified for your account. When a message can't be sent, Studio
records it in **Administration → Activity** as *email failed*, with the mail
server's answer (for example *550 Sender address is not verified*), and an
invitation or reset you started shows the same answer so you can share the
link yourself.

The password goes in the `studio_smtp_password` Docker secret
([DEPLOY.md step 5](DEPLOY.md#5-docker-secrets)), or `off` if the mail server
needs none.

Studio always requires TLS to the mail server. **Emailed sign-in codes** are
off until an administrator turns them on in **Sign-in settings**, and they're
labelled as weaker: anyone who can read the mailbox can use them.

Password resets by email still need the account's authenticator app, passkey
or a backup code, so a mailbox alone can't take over an account.

## Settings reference

| Variable | Default | Notes |
| --- | --- | --- |
| `STUDIO_AUTH` | `on` | `on` or `off` |
| `STUDIO_PUBLIC_ORIGIN` | (required) | Must be `https://` while sign-in is on. `http://localhost:<port>` is accepted for testing. With plain HTTP on any other address Studio starts but shows only a page explaining the fix |
| `STUDIO_AUTH_KEY_FILE` | `/run/secrets/studio_auth_key` in the templates | The file holding the encryption key: long random text that encrypts authenticator secrets and single sign-on tokens in the state volume. The templates read it from the `studio_auth_key` Docker secret, which must not be empty or `off`. Keep a copy: if it's lost or changed, authenticator apps must be set up again and provider sessions end. Without a key, **Sign-in settings** warns that these are stored unencrypted |
| `STUDIO_TRUSTED_PROXIES` | (unset) | Comma-separated IP addresses or CIDR ranges of your reverse proxies. Studio then takes the client address from `X-Forwarded-For` for sign-in throttling and the activity log. Without it, every request seems to come from the proxy |
| `STUDIO_OIDC_ISSUER` | (unset) | The provider's issuer URL, `https://` |
| `STUDIO_OIDC_CLIENT_ID` | (unset) | |
| `STUDIO_OIDC_CLIENT_SECRET_FILE` | `/run/secrets/studio_oidc_client_secret` in the templates | The file holding the client secret, from the `studio_oidc_client_secret` Docker secret. The word `off` (or an empty file) means unused. Issuer, client ID and client secret go together |
| `STUDIO_OIDC_NAME` | `Authentik` | The name on the sign-in button |
| `STUDIO_OIDC_SCOPES` | `openid profile email offline_access` | Keep `offline_access`, so groups can be checked while people are signed in |
| `STUDIO_OIDC_GROUPS_CLAIM` | `groups` | |
| `STUDIO_OIDC_REFRESH_MINUTES` | `15` | How often a signed-in provider account's groups are checked again, 1 to 1440 |
| `STUDIO_OIDC_ADMIN_GROUPS` | (unset) | Comma-separated provider groups whose members are administrators. While set, it decides **Administrator groups** and that list is read-only in Studio |
| `STUDIO_OIDC_ALLOWED_GROUPS` | (unset) | Comma-separated provider groups whose members may sign in. While set, it decides **Allowed groups** and that list is read-only in Studio |
| `STUDIO_ADMIN_USERNAME` | (unset) | The first administrator's username, created once on the first start. Ignored once any account exists. See [First start](#first-start-the-administrator) |
| `STUDIO_ADMIN_EMAIL` | (unset) | That administrator's email, optional |
| `STUDIO_ADMIN_PASSWORD_FILE` | `/run/secrets/studio_admin_password` in the templates | The file holding that administrator's password, from the `studio_admin_password` Docker secret. `off` (or an empty file) means no seed; then leave `STUDIO_ADMIN_USERNAME` unset too |
| `STUDIO_OIDC_ALLOW_HTTP` | (unset) | Testing only. `true` accepts a plain `http://` issuer; leave it unset in use, because tokens and the client secret would cross the network unencrypted |
| `STUDIO_SMTP_HOST` | (unset) | The mail server. Setting it turns email on. See [Email](#email) |
| `STUDIO_SMTP_PORT` | `587` | |
| `STUDIO_SMTP_SECURE` | `true` on port 465, otherwise `false` | `true` for TLS from the start, `false` for STARTTLS. TLS is required either way |
| `STUDIO_SMTP_USER` | (unset) | |
| `STUDIO_SMTP_PASSWORD_FILE` | `/run/secrets/studio_smtp_password` in the templates | The file holding the mail password, from the `studio_smtp_password` Docker secret. `off` (or an empty file) means no password |
| `STUDIO_SMTP_FROM_ADDRESS` | (unset) | The sender address, required with `STUDIO_SMTP_HOST`. A plain address, such as `studio@example.test` |
| `STUDIO_SMTP_FROM_NAME` | `Homepage Studio` | The sender name people see. Needs `STUDIO_SMTP_FROM_ADDRESS` |
| `STUDIO_SMTP_FROM` | (unset) | The older single setting (an address, or `Name <address>`), still accepted instead of the two above. Not both |

**Secrets as plain variables (not recommended).** Outside the templates, the
four secrets can also be given directly as `STUDIO_AUTH_KEY`,
`STUDIO_OIDC_CLIENT_SECRET`, `STUDIO_SMTP_PASSWORD` and `STUDIO_ADMIN_PASSWORD`, for example
`STUDIO_AUTH_KEY=<long random text>` when running the image by hand for a
test. The templates don't pass these: a plain variable shows up in the stack's
environment, Portainer's stack view and `docker inspect`, and a `_FILE`
setting takes precedence over it anyway. Use the Docker secrets.

## Lost access: command-line recovery

If no administrator can sign in (lost passkeys and codes, or single sign-on
broken while local sign-in is off), anyone with shell access to the container
can make a one-time recovery link:

```bash
# Swarm: find the container on the node first with docker ps
docker exec -it <studio container> node server/auth/cli.mjs list
docker exec -it <studio container> node server/auth/cli.mjs recover <username> --promote
```

The link is valid for 15 minutes and works once. It signs in as that person
for one browser session, even with local sign-in off. `--promote` also makes
them an administrator. It refuses a single sign-on account while
administrator groups are set, because the provider's groups decide that
account's role; recover a local account instead. From there, add a new passkey or authenticator, or fix
the single sign-on settings. Every use is recorded in the activity log.

## Activity log

**Administration → Activity** lists the latest 500 sign-in and administration
events: sign-ins and failures, setups, invitations, changes to people,
groups, policies, sharing and settings, recovery and sign-outs. Each event is
also written to the container log as a line starting with `studio-auth`, so
tools such as fail2ban or CrowdSec can act on repeated failures. The log
never contains passwords, codes, tokens or secrets.

## How it is protected

- **Passwords** are hashed with scrypt (N=2^17, r=8, p=1), 12 to 128
  characters. A short list of the most common choices is refused.
- **Sessions** are random tokens held in an `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie named `__Host-studio_session`. Studio stores only a
  hash of each token, so a copy of the state volume can't be replayed as a
  session. The token changes whenever someone confirms it's them. The session
  cookie is never passed to the dashboard workers.
- **Passkeys** require user verification, are bound to your Studio address,
  and use no attestation (no device details are collected).
- **Authenticator codes** follow RFC 6238 (6 digits, 30 seconds); a code
  can't be used twice. **Backup codes** are stored hashed and work once.
- **One-time links** (invitations, resets, recovery) carry their token after
  `#`, which browsers never send to servers or proxies, and the page removes
  it from the address bar as soon as it's read.
- **Requests from other sites** can't act for you: every change needs Studio's
  request header and a same-origin `Origin`, and Fetch Metadata is checked.
  Sign-in pages can't be framed.
- **Unreadable sign-in data fails closed**: if `/app/state/auth` can't be read,
  Studio answers `503` instead of opening up.
- **Homepage's MCP endpoint** (`/api/mcp`) is turned off while sign-in is on,
  because it has its own separate access model.

Sign-in data lives in `/app/state/auth/` (`auth.json`, `sessions.json`,
`audit.jsonl`). It's part of the state volume, so the usual
[volume backups](OPERATIONS.md#backups) include it. Treat those backups as
sensitive.

## Turning sign-in off

`STUDIO_AUTH=off` returns to the earlier model: anyone who can reach the page
can view and change every dashboard, so access control must come from your
reverse proxy ([REVERSE-PROXY.md](REVERSE-PROXY.md#access-control)). Accounts
and sharing are kept in the state volume and come back if you turn sign-in on
again.
