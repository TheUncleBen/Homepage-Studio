# Single sign-on with Authentik

Studio has its own accounts, so single sign-on is optional. With it, people
sign in to Studio with their Authentik account, and Authentik groups decide
who may sign in and who is an administrator.

This is the long version of [DEPLOY.md](DEPLOY.md) steps 4 and 10: every
Authentik object Studio needs, what to put in each field and why, the Studio
settings that finish the job, and what to check when sign-in fails. Using
another provider? See [IDP-OTHERS.md](IDP-OTHERS.md).

Placeholders:

| Placeholder | Means |
| --- | --- |
| `https://homepage.example.test` | Studio's public address, the value of `STUDIO_PUBLIC_ORIGIN` |
| `https://authentik.example.test` | your Authentik's public address |
| `Homepage Studio Admins` | the Authentik group whose members administer Studio |
| `Homepage Studio Users` | the Authentik group whose members may use Studio |

## Contents

1. [What Studio needs from Authentik](#1-what-studio-needs-from-authentik)
2. [Before you start](#2-before-you-start)
3. [Create the groups](#3-create-the-groups)
4. [Create the OAuth2/OpenID provider](#4-create-the-oauth2openid-provider)
5. [Create the application and bind the groups](#5-create-the-application-and-bind-the-groups)
6. [Give Studio the issuer, client ID and client secret](#6-give-studio-the-issuer-client-id-and-client-secret)
7. [Finish in Studio](#7-finish-in-studio)
8. [Check the sign-in](#8-check-the-sign-in)
9. [Second factor and who can join](#9-second-factor-and-who-can-join)
10. [Troubleshooting](#10-troubleshooting)
11. [What is tested](#11-what-is-tested)

## 1. What Studio needs from Authentik

This comes from Studio's sign-in code (`server/auth/oidc.mjs`,
`server/auth/config.mjs`). Each row is set up by the steps below.

| Need | What Studio does | Where it's set in Authentik |
| --- | --- | --- |
| Discovery | Loads `<STUDIO_OIDC_ISSUER>/.well-known/openid-configuration` the first time someone signs in with Authentik | The provider's **OpenID Configuration Issuer**, `https://authentik.example.test/application/o/homepage-studio/`. The slug in it is the **application's** slug |
| Sign-in flow | Authorization code with PKCE (`S256`), state and nonce. The redirect URI is `STUDIO_PUBLIC_ORIGIN` + `/studio/auth/oidc/callback` | Provider → **Redirect URIs**: `https://homepage.example.test/studio/auth/oidc/callback`, matching mode **Strict** |
| Client authentication | Sends the client ID and secret with HTTP Basic authentication to the token endpoint (`client_secret_basic`) | Provider → **Client type: Confidential**. Copy the **Client ID** and **Client Secret** |
| Scopes | Asks for `openid profile email offline_access` (`STUDIO_OIDC_SCOPES`) | Provider → **Scopes**: the built-in mappings for `openid`, `email`, `profile` and `offline_access` |
| Signed ID token | Requires an ID token and verifies its signature against the provider's published keys | Provider → **Signing Key**: a certificate, for example `authentik Self-signed Certificate` |
| Groups | Reads the `groups` claim (`STUDIO_OIDC_GROUPS_CLAIM`) from the ID token, or from the userinfo endpoint when the ID token has none | Authentik's `profile` scope mapping includes `groups` |
| Stable identity | Knows an Authentik account by the issuer and its `sub` only, never by email or username | Provider → **Subject mode**: `Based on the User's hashed ID` (the default) |
| Email | Uses the `email` claim only when `email_verified` is `true`: as the address of an Authentik account, and as the address of a local account linked to it | An `email` scope mapping that marks addresses verified ([Email addresses](#email-addresses)). The built-in mapping says `false` since Authentik 2025.10, and Studio then leaves the email alone |
| Fresh sign-in for linking | When someone links accounts, asks Authentik to sign them in again (`prompt=login`, `max_age=300`) and checks the ID token's `auth_time` | Nothing to set |
| Staying in sync | Every 15 minutes (`STUDIO_OIDC_REFRESH_MINUTES`) uses the refresh token to check the person's groups again. Someone taken out of the groups is signed out at the next check | The `offline_access` scope mapping. Without it Authentik issues no refresh token, and Authentik sessions in Studio end at the first check |
| Signing out | **Sign out** in Studio ends the Studio session and, when Authentik publishes an end-session endpoint, sends the browser there to end the Authentik session too, asking it to return to `https://homepage.example.test/studio/auth/sign-in?signedOut=1` | Nothing required. Optional: the back-channel logout URI (section 4), so signing out of Authentik also ends Studio sessions |

## 2. Before you start

- Authentik is reachable at `https://authentik.example.test` **from the
  Studio container**, with a certificate the container trusts (a public CA
  such as Let's Encrypt). Studio talks to Authentik directly for discovery,
  tokens and the group checks, not through the browser. If Authentik's
  hostname resolves to an address the Docker network can't reach, sign-in
  fails with *Authentik is not reachable right now*.
- You can open Authentik's admin interface (`/if/admin/`).
- You know Studio's final public address. The redirect URI depends on it, so
  changing it later means editing the provider.
- Authentik's default flows exist (**Flows and Stages → Flows**):
  `default-provider-authorization-implicit-consent` (or `-explicit-consent`)
  and `default-provider-invalidation-flow`.

## 3. Create the groups

**Directory → Groups → Create**, twice:

| Name | Who goes in it |
| --- | --- |
| `Homepage Studio Admins` | People who may administer Studio: change settings, invite people, edit every dashboard |
| `Homepage Studio Users` | Everyone else who may use Studio. What they can open is decided per dashboard in Studio |

Leave **Is superuser** off and **Parent** empty. Add yourself to
`Homepage Studio Admins` (**Directory → Users → your user → Groups → Add to
existing group**).

The names are yours to choose. Studio compares them character for character
with what you type in section 7, so spaces are fine but case and punctuation
have to match.

## 4. Create the OAuth2/OpenID provider

**Applications → Providers → Create → OAuth2/OpenID Provider**

| Field | Value | Why |
| --- | --- | --- |
| Name | `Homepage Studio` | Shows on Authentik's consent and user pages |
| Authorization flow | `default-provider-authorization-implicit-consent` | Signs people straight through once they're signed in to Authentik. The `-explicit-consent` flow works too; people then confirm a consent page |
| Invalidation flow | `default-provider-invalidation-flow` | Authentik requires one |
| Client type | **Confidential** | Studio holds a client secret |
| Grant types (if your Authentik shows them) | at least **Authorization Code** and **Refresh token** | Studio uses only these two. Authentik refuses a grant the provider doesn't list |
| Client ID | keep the generated value | Goes in `STUDIO_OIDC_CLIENT_ID`. It isn't a secret |
| Client Secret | keep the generated value | Goes into the Docker secret `studio_oidc_client_secret` and nowhere else |
| Redirect URIs | one entry, matching mode **Strict**, URL `https://homepage.example.test/studio/auth/oidc/callback` | Exactly `STUDIO_PUBLIC_ORIGIN` plus that path, no trailing slash. **Administration → Sign-in settings** in Studio shows the exact value to copy once single sign-on is configured |
| Signing Key | `authentik Self-signed Certificate`, or any certificate you manage | Studio needs a signed ID token it can verify. If the list is empty, make one under **System → Certificates → Generate** |
| Encryption Key | none | Studio doesn't decrypt tokens |
| Advanced protocol settings → Scopes | `authentik default OAuth Mapping: OpenID 'openid'`, `… 'email'`, `… 'profile'` and `… 'offline_access'` | `openid` gives the ID token, `email` and `profile` the name, email and `groups`, and `offline_access` the refresh token. **Don't skip `offline_access`**: Authentik says nothing, but people signed in through Authentik are signed out of Studio after 15 minutes |
| Subject mode | **Based on the User's hashed ID** (the default) | A stable, opaque `sub`. Never a username or email mode: people can change those themselves, and whoever picks up an old value would inherit that Studio account. Don't change it after the first sign-in, or everyone becomes a new account |
| Include claims in id_token | on (the default) | Studio reads the groups from the ID token, so it doesn't need an extra request |
| Issuer mode | **Each provider has a different issuer, based on the application slug** (the default) | Gives the issuer in section 6 |
| Token validity | the defaults | Studio renews Authentik's access token with the refresh token when it runs out |

Optional: **back-channel logout**. If your Authentik version offers a
back-channel logout URI on the provider, set it to
`https://homepage.example.test/studio/auth/oidc/backchannel-logout`, so
signing out of Authentik also ends Studio sessions. Studio shows this URI in
**Sign-in settings** too.

Save.

Field labels move between Authentik versions. If one isn't where this table
says, go by the meaning in the *Why* column.

### Email addresses

Optional, but needed if you want Studio to use people's Authentik email
addresses, including the local administrator's email following yours once you
link them (section 7). Studio only trusts an email the provider marks as
verified. Since Authentik 2025.10, the built-in
`authentik default OAuth Mapping: OpenID 'email'` returns
`email_verified: false`, because Authentik can't know whether an address was
checked ([Authentik: Verify email address](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/verify-email-address/)).
Studio then keeps whatever email it already has, and **Sign-in settings**
warns about it.

Only mark addresses verified if they are trustworthy: people can't change
their own email in Authentik, or your enrollment checks the address. Otherwise
someone could point Studio's security alerts at an address they own. To do it:

1. **Customization → Property Mappings → Create → Scope Mapping**.
   - Name: `Homepage Studio email (verified)`.
   - Scope name: `email`.
   - Expression:

     ```python
     return {
         "email": request.user.email,
         "email_verified": True,
     }
     ```

2. On the provider, under **Advanced protocol settings → Scopes**, select the
   new mapping and **remove** `authentik default OAuth Mapping: OpenID 'email'`.
   Two mappings for the same scope on one provider conflict.

Authentik's page linked above has a variant that reads a per-user attribute
instead of always saying `True`. This page hasn't been checked against every
Authentik version; if your mapping editor differs, follow Authentik's page.

## 5. Create the application and bind the groups

**Applications → Applications → Create**

| Field | Value | Why |
| --- | --- | --- |
| Name | `Homepage Studio` | Shows in Authentik's user portal |
| Slug | `homepage-studio` | Becomes part of the issuer URL, so pick it once |
| Provider | `Homepage Studio` (section 4) | |
| Launch URL | `https://homepage.example.test/` | Optional. The tile in Authentik's portal opens Studio |

Save, then open the application and go to **Policy / Group / User Bindings →
Bind existing policy/group/user**. Bind `Homepage Studio Admins`, then bind
`Homepage Studio Users` the same way (type **Group**, enabled).

With at least one binding, Authentik lets only members of the bound groups
through; everyone else gets Authentik's *Permission denied* page and never
reaches Studio. **With no binding at all, every Authentik account gets
through**, and Studio's allowed groups (section 7) are the only gate. Set up
both.

Authentik's **Create with Provider** wizard makes the provider and the
application in one go; the field values are the same.

## 6. Give Studio the issuer, client ID and client secret

Open **Applications → Providers → Homepage Studio**.

- **OpenID Configuration Issuer**, for example
  `https://authentik.example.test/application/o/homepage-studio/`. That's
  `STUDIO_OIDC_ISSUER`. To check it, open
  `<issuer>.well-known/openid-configuration` in a browser: it should return
  JSON whose `issuer` is that URL.
- **Client ID**. That's `STUDIO_OIDC_CLIENT_ID`.
- **Client Secret** (reveal it with the eye icon). That goes into the Docker
  secret `studio_oidc_client_secret` and nowhere else: not into the stack's
  environment variables, a file you keep, or a chat.

**The secret.** If you're deploying for the first time, create it as in
[DEPLOY.md step 5](DEPLOY.md#5-docker-secrets). If Studio is already running
with `off` in that secret, Swarm can't edit a secret in place, so:

1. Remove the stack in Portainer (**Stacks → homepage → Delete this stack**).
   The volumes, and every dashboard and account in them, stay.
2. **Secrets → studio_oidc_client_secret → Remove**, then **Add secret** with
   the same name and the Client Secret as its value.
   On the command line: `docker secret rm studio_oidc_client_secret`, then
   `read -rs S && printf %s "$S" | docker secret create studio_oidc_client_secret - ; unset S`.
3. Deploy the stack again with the two variables below added.

**The variables** (in your environment file, [DEPLOY.md step 6](DEPLOY.md#6-fill-in-the-environment-file)):

```env
STUDIO_OIDC_ISSUER=https://authentik.example.test/application/o/homepage-studio/
STUDIO_OIDC_CLIENT_ID=<client ID>
STUDIO_OIDC_NAME=Authentik
```

`STUDIO_OIDC_NAME` is the name on the sign-in button and account pages
(default `Single sign-on`). The rest can stay at their defaults:
`STUDIO_OIDC_SCOPES`, `STUDIO_OIDC_GROUPS_CLAIM` (`groups`) and
`STUDIO_OIDC_REFRESH_MINUTES` (`15`).

If the issuer or client ID is set while the secret still says `off`, Studio
doesn't start, and its log says so.

## 7. Finish in Studio

Studio starts without contacting Authentik; the first sign-in is the first
contact. Sign in with your administrator account and open **Administration →
Sign-in settings**. The **Authentik** section shows:

- **Redirect URI**: must match the provider's exactly (section 4).
- **Back-channel logout URI**: optional (section 4).

If you set `STUDIO_OIDC_ADMIN_GROUPS` and `STUDIO_OIDC_ALLOWED_GROUPS` in the
stack, the two group lists below are already filled in and read-only: change
them in the stack instead. Otherwise fill in the three settings and click
**Save single sign-on settings**:

| Setting | Value | What it does |
| --- | --- | --- |
| **Administrator groups** | `Homepage Studio Admins` | People in these Authentik groups are Studio administrators; everyone else who signs in through Authentik is a member. Checked at every sign-in and at every refresh (15 minutes). While this list is set, it alone decides the role of Authentik accounts |
| **Allowed groups** | `Homepage Studio Users` | Only people in an allowed group or an administrator group may sign in through Authentik. Someone removed from the groups in Authentik is signed out at the next check |
| **Create a Studio account the first time someone signs in with Authentik** | on | People in those groups get an account at their first sign-in. While both lists are empty, nobody new is created. Turn it off to require an invitation for everyone |

One group per line. Studio compares names exactly, so copy them from
Authentik.

**Share dashboards before anyone signs in.** Both groups are listed under
**Administration → Groups** as soon as they're in the settings. To share with
another Authentik group, add it there by its exact name (**Add Authentik
group**). Then pick the groups under **Dashboard access**. Someone signing in
with Authentik for the first time lands on exactly those dashboards, with the
role their groups give them, and nobody has to do anything in Studio.

**Link your administrator account.** The administrator from the first start
is a local account. Link it to your Authentik account, so either signs you in
and the local one still works when Authentik is down:

1. Signed in with the local account, open **My account → Link Authentik
   account**. (Signed in more than 5 minutes ago? Confirm it's you first.)
2. Authentik asks you to sign in again, even if you already were.
3. Back in Studio, check the two accounts on **Link these accounts?** and
   click **Link accounts**.

The local password stays as it was. The local email changes to your Authentik
email (if Authentik marks it verified, see [Email addresses](#email-addresses))
and follows it from then on. Signed in with Authentik first? Then Studio
already made you a separate Authentik account; use **My account → Link a
local account** from there, sign in to the local account, then to Authentik,
and confirm. The separate account is merged into the local one, dashboard
shares included.

A linked local account is an administrator through Authentik groups only
while it's signed in through Authentik; signed in locally, it keeps the role
set on the People page.

**Local sign-in off (optional).** Once Authentik sign-in works, you can make
it the only way in: **Allow local sign-in** off. Studio allows that only while
you're signed in through Authentik as someone in an administrator group,
which proves Authentik works before local access goes away. If Authentik
breaks later, [command-line recovery](AUTHENTICATION.md#lost-access-command-line-recovery)
still works.

More on roles, sharing dashboards with Authentik groups and linking accounts:
[AUTHENTICATION.md](AUTHENTICATION.md#single-sign-on-with-authentik-or-another-provider).

## 8. Check the sign-in

1. In a private window, open `https://homepage.example.test/` and choose to
   sign in with Authentik. You go to Authentik, sign in, and come back to
   Studio.
2. Signed in as someone in `Homepage Studio Admins`, you see
   **Administration**. Someone in `Homepage Studio Users` only gets the
   dashboards shared with them.
3. Try an Authentik account in neither group. Authentik shows *Permission
   denied* (section 5), or, if another binding lets it through, Studio says
   *Your Authentik account isn't in a group allowed to use this Studio.*
4. **Administration → Activity** shows the sign-ins and the refusal.
5. Leave a session open for more than 15 minutes and use Studio again. It
   should stay signed in. If **Sign-in settings** warns that the last
   Authentik sign-in didn't return a refresh token, add the `offline_access`
   mapping (section 4) and sign in again.

## 9. Second factor and who can join

Anyone who signs in through Authentik as a member of your groups gets their
Studio access, and administrators can change every dashboard and read the
secrets written into them. So the groups, and the passwords behind them, are
what protect Studio. Recommended:

- **Require a second factor in Authentik.** Studio doesn't ask for its own
  second factor after an Authentik sign-in. Give the provider an
  authentication flow whose **Authenticator Validation** stage requires TOTP
  or WebAuthn, or require it on the default authentication flow.
- **Nothing adds people to the groups by itself.** Enrollment flows,
  invitations and sources (Google, GitHub and so on) must not put anyone into
  `Homepage Studio Users` or `Homepage Studio Admins` unless the link is single
  use and expires.
- **Don't link source accounts by email for sources that don't confirm
  emails.** Otherwise anyone who registers your email address at that source
  could sign in as you.

(These are Authentik features; Studio's tests don't cover them.)

## 10. Troubleshooting

Studio's own messages are in the browser; its log
(`docker service logs homepage_studio`) adds a short reason code.

| What you see | Cause and fix |
| --- | --- |
| Authentik shows a redirect URI error right after leaving Studio | The provider's Redirect URI doesn't match. In Strict mode the scheme, host, port, path and the lack of a trailing slash all count. Copy it from **Sign-in settings** |
| Authentik shows *Permission denied* | The account isn't in a group bound to the application (section 5) |
| Studio says *Authentik is not reachable right now*; log says `Single sign-on discovery failed` | The Studio container can't reach the issuer: wrong `STUDIO_OIDC_ISSUER`, DNS, a firewall, or a certificate the container doesn't trust. Check the issuer opens in a browser and that the Docker network has a way out to Authentik |
| Studio says *Authentik sign-in didn't complete*; log says `Single sign-on callback failed` | The token exchange or the ID token check failed. Usual causes: the client secret in `studio_oidc_client_secret` is wrong (recreate it, section 6), the provider was switched to **Public**, no **Signing Key** on the provider, or the clocks of Studio's node and Authentik's differ by minutes |
| Studio says *Your Authentik account isn't in a group allowed to use this Studio* | The person's `groups` claim has none of the allowed or administrator groups. Check the spelling in **Sign-in settings**, that they're a member, and that the provider still has the `profile` mapping |
| Studio says *There is no Studio account for you yet* | **Create a Studio account the first time someone signs in** is off, or both group lists are empty. Invite them, or fill in the lists |
| People signed in through Authentik are signed out after about 15 minutes | No refresh token: add the `offline_access` mapping (section 4). **Sign-in settings** warns about this after a sign-in without one |
| Studio doesn't start; log says `STUDIO_OIDC_CLIENT_SECRET_FILE ... is empty or says off` | The issuer or client ID is set, but the secret still says `off`. Recreate the secret with the Client Secret (section 6) |
| Studio doesn't start; log says `Single sign-on needs STUDIO_OIDC_ISSUER, STUDIO_OIDC_CLIENT_ID ...` | Only one of the two variables is set. Set both, or neither |
| An administrator in Authentik is only a member in Studio | They're not in a group listed under **Administrator groups**, or they signed in locally rather than through Authentik |
| Linking ends at *At the identity provider, sign in as the same account you are using Studio with* | You started from an Authentik session but signed in to Authentik as someone else. Sign in to Authentik as the account you were using Studio with |
| Linking ends at *Single sign-on didn't complete* | The Authentik sign-in was more than 5 minutes old (Studio asks for a fresh one), or the clocks differ. Try again; if it repeats, check the time on Studio's node and on Authentik |
| The linked account's email doesn't follow Authentik; **Sign-in settings** says the email isn't marked as verified | Set up the verified email mapping ([Email addresses](#email-addresses)), then sign in with Authentik again |
| Everyone is suddenly a new account | The provider's **Subject mode** was changed, or the issuer changed (another slug or provider). Put it back; Studio matches accounts by issuer and subject only |

## 11. What is tested

- **Studio's tests** run the whole sign-in (discovery, PKCE, ID token check,
  groups, refresh, sign-out and back-channel logout) against a mock OpenID
  Connect provider modelled on Authentik 2024.2 and later, including its
  refresh-token behaviour (`server/auth/auth-oidc.test.mjs`). They also cover
  linking from either side, the forced fresh sign-in, merging, the verified
  email rule and groups set by the deployment.
- **Not tested in CI:** a real Authentik. The Authentik menu paths and field
  labels on this page are as Authentik documents them, not checked on a live
  screen for every version. If a step doesn't match what you see, please open
  an issue with your Authentik version.
